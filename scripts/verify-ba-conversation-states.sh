#!/usr/bin/env bash
# Business Agent 2.0, FASE 3 — verifica la migración de dulabs_ba_conversation_states contra un PostgreSQL LOCAL
# EFÍMERO (initdb en un directorio temporal; nunca contra Supabase de producción):
#   1. la migración aplica dos veces (idempotente);
#   2. el test SQL (unicidad, versión optimista, versión monotónica, clave inmutable, validación, RLS);
#   3. concurrencia REAL: dos sesiones escriben la misma versión a la vez; exactamente una gana.
# Uso: scripts/verify-ba-conversation-states.sh   (requiere binarios de PostgreSQL: initdb, pg_ctl, psql)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
trap '"$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

run_pg() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; fi

run_pg "'$PGBIN/initdb' -D '$WORK/data' -U postgres -A trust >/dev/null"
run_pg "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses=' -l '$WORK/log' start >/dev/null"
PSQL=("$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" <<'SQL'
create role service_role bypassrls; create role anon; create role authenticated;
create or replace function public.dulabs_flow_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
SQL
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261123000000_dulabs_ba_conversation_states.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261123000000_dulabs_ba_conversation_states.sql"
echo "PASS 0 migración idempotente (aplicada dos veces)"
"${PSQL[@]}" -f "$ROOT/supabase/tests/20261123000000_dulabs_ba_conversation_states.test.sql" 2>&1 | sed -n 's/.*NOTICE:  //p'

# Concurrencia real: A toma el lock de la fila (versión 1 -> 2) y espera; B intenta lo mismo con versión 1.
"${PSQL[@]}" -c "insert into dulabs_ba_conversation_states (id_tenant, phone_number_id, telefono_cliente, agent_id, status, schema_version, state)
  values ('cccccccc-0000-4000-8000-00000000000c', 'PN-C', '573005550000', 'flow-c', 'NEW', 'x', '{\"status\":\"NEW\"}');"
UPD="update dulabs_ba_conversation_states set state_version = 2, status = 'COLLECTING_INFORMATION', state = '{\"status\":\"COLLECTING_INFORMATION\"}'
  where id_tenant = 'cccccccc-0000-4000-8000-00000000000c' and phone_number_id = 'PN-C' and telefono_cliente = '573005550000' and agent_id = 'flow-c' and state_version = 1"
( "${PSQL[@]}" -t -A -c "begin; $UPD; select pg_sleep(1.5); commit;" > "$WORK/a.out" 2>&1 ) &
sleep 0.4
B="$("${PSQL[@]}" -t -A -c "$UPD returning 'B_WON';" 2>&1 || true)"
wait
FINAL="$("${PSQL[@]}" -t -A -c "select state_version from dulabs_ba_conversation_states where agent_id = 'flow-c'")"
if [ -n "$B" ]; then echo "FAIL concurrencia: la sesión B también escribió ($B)"; exit 1; fi
if [ "$FINAL" != "2" ]; then echo "FAIL concurrencia: versión final $FINAL"; exit 1; fi
echo "PASS 8 concurrencia real: dos sesiones con la misma versión esperada => una sola escritura (versión final 2)"
