#!/usr/bin/env bash
# Business Agent 2.0, FASE 4 — verifica la migración del Action Engine contra un PostgreSQL LOCAL EFÍMERO
# (initdb en un directorio temporal; nunca contra Supabase de producción):
#   1. la migración aplica dos veces (idempotente), sobre la de FASE 3;
#   2. el test SQL (claim, fencing, replay, mismatch, lease/timeout, retoma de lecturas, candado, RLS, permisos);
#   3. concurrencia REAL: N sesiones reclaman la MISMA clave a la vez => exactamente una ejecuta;
#      N sesiones toman el MISMO candado a la vez => exactamente una lo obtiene;
#      una sesión con el INSERT sin confirmar bloquea a la otra, que al continuar ve in_progress (no ejecuta).
# Uso: scripts/verify-ba-action-engine.sh   (requiere initdb, pg_ctl, psql)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54330}"
N="${WORKERS:-12}"
trap '"$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

run_pg() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; fi
run_pg "'$PGBIN/initdb' -D '$WORK/data' -U postgres -A trust >/dev/null"
run_pg "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses= -c max_connections=60' -l '$WORK/log' start >/dev/null"
PSQL=("$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" <<'SQL'
create role service_role bypassrls; create role anon; create role authenticated;
create or replace function public.dulabs_flow_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
SQL
for i in 1 2; do "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261124000000_dulabs_ba_action_engine.sql" 2>/dev/null; done
echo "PASS 0 migración idempotente (aplicada dos veces)"
"${PSQL[@]}" -f "$ROOT/supabase/tests/20261124000000_dulabs_ba_action_engine.test.sql" 2>&1 | sed -n 's/.*NOTICE:  //p'

T="cccccccc-0000-4000-8000-00000000000c"
KEY="$(printf 'f%.0s' $(seq 1 32))"
HASH="$(printf '9%.0s' $(seq 1 64))"

# 9. N workers, misma clave, al mismo tiempo (barrera: todos esperan el mismo instante).
START=$(( $(date +%s) + 2 ))
for w in $(seq 1 "$N"); do
  ( while [ "$(date +%s)" -lt "$START" ]; do :; done
    "${PSQL[@]}" -t -A -c "select outcome from dulabs_ba_action_claim('$T', 'flow-c', 'pn:c', 'crear_cita_nylas_generico', '1.0.0', '$KEY', '$HASH', 30, false)" > "$WORK/claim.$w" 2>&1 ) &
done
wait
CLAIMED=$(cat "$WORK"/claim.* | grep -c '^claimed$' || true)
INPROG=$(cat "$WORK"/claim.* | grep -c '^in_progress$' || true)
ROWS=$("${PSQL[@]}" -t -A -c "select count(*) from dulabs_ba_action_executions where id_tenant = '$T'")
if [ "$CLAIMED" != "1" ] || [ "$INPROG" != "$((N - 1))" ] || [ "$ROWS" != "1" ]; then
  echo "FAIL 9 claims concurrentes: claimed=$CLAIMED in_progress=$INPROG filas=$ROWS"; cat "$WORK"/claim.*; exit 1
fi
echo "PASS 9 concurrencia real: $N workers, misma clave => 1 claimed, $((N - 1)) in_progress, 1 fila"

# 10. N workers toman el mismo candado a la vez.
START=$(( $(date +%s) + 2 ))
for w in $(seq 1 "$N"); do
  ( while [ "$(date +%s)" -lt "$START" ]; do :; done
    "${PSQL[@]}" -t -A -c "select dulabs_ba_booking_lock_acquire('$T', 'booking:2026-10-02', 'worker-$w', 30)" > "$WORK/lock.$w" 2>&1 ) &
done
wait
GOT=$(cat "$WORK"/lock.* | grep -c '^t$' || true)
if [ "$GOT" != "1" ]; then echo "FAIL 10 candado concurrente: lo obtuvieron $GOT"; cat "$WORK"/lock.*; exit 1; fi
echo "PASS 10 concurrencia real: $N workers, mismo candado => exactamente 1 lo obtiene"

# 11. Carrera con la fila sin confirmar: A inserta y mantiene la transacción abierta; B queda bloqueado en el índice
#     único y, cuando A confirma, ve in_progress (nunca ejecuta en paralelo).
KEY2="$(printf 'e%.0s' $(seq 1 32))"
( "${PSQL[@]}" -t -A -c "begin; select outcome from dulabs_ba_action_claim('$T', 'flow-c', 'pn:c', 'crear_cita_nylas_generico', '1.0.0', '$KEY2', '$HASH', 30, false); select pg_sleep(1.5); commit;" > "$WORK/a.out" 2>&1 ) &
sleep 0.5
B=$("${PSQL[@]}" -t -A -c "select outcome from dulabs_ba_action_claim('$T', 'flow-c', 'pn:c', 'crear_cita_nylas_generico', '1.0.0', '$KEY2', '$HASH', 30, false)")
wait
A=$(grep -E '^(claimed|in_progress)$' "$WORK/a.out" || true)
if [ "$A" != "claimed" ] || [ "$B" != "in_progress" ]; then echo "FAIL 11 A=$A B=$B"; exit 1; fi
echo "PASS 11 transacción abierta: B espera y luego ve in_progress (A=claimed, B=in_progress)"
