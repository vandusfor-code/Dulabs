#!/usr/bin/env bash
# Business Agent 2.0, FASE 9 — concurrencia REAL contra un PostgreSQL LOCAL EFÍMERO (nunca producción).
#
# Aplica la cadena 20261123 → 20261129 y lanza sesiones psql EN PARALELO (procesos distintos, conexiones distintas)
# sobre las funciones que protegen la operación multi-tenant. Cada caso afirma un invariante con números exactos:
#
#   C1  8 despachadores reclaman 300 recordatorios de 30 tenants → cada uno se toma UNA vez (0 duplicados)
#   C2  10 sesiones programan el MISMO recordatorio (misma operación) → 1 fila
#   C3  5 rondas × 10 sesiones programan la MISMA cita con operaciones distintas → 1 activo y 0 errores (20261129)
#   C4  cancelar vs begin_send en carrera (50 recordatorios) → nunca se envía uno cancelado antes del envío
#   C5  40 golpes simultáneos con límite 25 → exactamente 25 permitidos
#   C6  40 registros de uso simultáneos → contador exacto (sin incrementos perdidos)
#   C7  20 escrituras del estado conversacional con la MISMA versión esperada → exactamente 1 gana
#   C8  20 guardados del borrador con la MISMA revisión → exactamente 1 gana
#   C9  10 publicaciones simultáneas con la MISMA versión esperada → exactamente 1 publica
#   C10 2 verificadores resuelven el MISMO envío desconocido → 1 resolución efectiva, estado final único
#   C11 worker "reiniciado": su lease venció y otro despacho lo marcó unknown → su cierre tardío es rechazado (fencing)
#
# (La reclamación de acciones y los candados de agenda ya tienen su prueba concurrente: verify-ba-action-engine.sh.)
#
# Uso: scripts/verify-ba-concurrency.sh   (requiere initdb, pg_ctl, psql)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54351}"
trap '"$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

run_pg() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; fi
run_pg "'$PGBIN/initdb' -D '$WORK/data' -U postgres -A trust >/dev/null"
run_pg "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses= -c max_connections=80' -l '$WORK/log' start >/dev/null"
export PGOPTIONS="-c client_min_messages=warning"
PSQL=("$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -t -A)

# Prerequisitos que YA existen en producción (mismos que verify-ba-migration-chain.sh).
awk '/^create or replace function public.dulabs_flow_publish_version\(/,/^\$\$;/' "$ROOT/supabase/migrations/20260828110000_dulabs_flow_store_critical_fixes.sql" > "$WORK/publish_fn.sql"
awk '/^create or replace function public.dulabs_flow_set_updated_at\(/,/^\$\$;/' "$ROOT/supabase/migrations/20260828100000_dulabs_flow_store.sql" > "$WORK/updated_at_fn.sql"
cat > "$WORK/prereq.sql" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create table public.dulabs_flows (tenant_id uuid not null, id uuid not null default gen_random_uuid(), slug text not null, name text not null,
  status text not null default 'draft' check (status in ('draft','published','archived')), published_version_id uuid,
  updated_at timestamptz not null default now(), primary key (tenant_id, id));
create table public.dulabs_flow_versions (tenant_id uuid not null, id uuid not null default gen_random_uuid(), flow_id uuid not null,
  version_number int not null, definition_json jsonb not null, published_at timestamptz, retired_at timestamptz,
  primary key (tenant_id, id), foreign key (tenant_id, flow_id) references public.dulabs_flows (tenant_id, id));
create table public.dulabs_business_agent_versions (tenant_id uuid not null, id uuid not null default gen_random_uuid(), flow_id uuid not null,
  flow_version_id uuid not null, validation_status text not null, primary key (tenant_id, id), unique (tenant_id, flow_version_id));
SQL
chmod 644 "$WORK"/*.sql
"${PSQL[@]}" -f "$WORK/prereq.sql" -f "$WORK/publish_fn.sql" -f "$WORK/updated_at_fn.sql" >/dev/null
for m in 20261123000000_dulabs_ba_conversation_states 20261124000000_dulabs_ba_action_engine 20261125000000_dulabs_ba_business_models \
         20261126000000_dulabs_ba_onboarding 20261127000000_dulabs_ba_reminders 20261128000000_dulabs_ba_production_hardening \
         20261129000000_dulabs_ba_reminder_schedule_lock; do
  "${PSQL[@]}" -f "$ROOT/supabase/migrations/$m.sql" >/dev/null
done
q() { "${PSQL[@]}" -c "$1"; }
fail() { echo "FAIL $*"; exit 1; }

T1=aaaaaaaa-0000-4000-8000-00000000000a
KEYHEX() { printf '%032x' "$1"; }

# C1 ------------------------------------------------------------------------------------------------------------------
q "do \$\$ declare i int; begin
  for i in 1..300 loop
    perform dulabs_ba_reminder_schedule(('00000000-0000-4000-8000-' || lpad(((i % 30) + 1)::text, 12, '0'))::uuid, 'f', 'pn:' || i, 'pn', '57300' || i, 'cita-' || i,
      now() + interval '2 hour', 'Corte', now() + interval '1 hour', 'America/Bogota', 'x', lpad(to_hex(i), 32, '0'), 'cercano');
  end loop;
  update dulabs_ba_reminders set remind_at = now() - interval '1 second';
end \$\$;" >/dev/null
for w in $(seq 1 8); do
  ( for _ in $(seq 1 12); do "${PSQL[@]}" -c "select id from dulabs_ba_reminder_claim_due(7, 60)"; done > "$WORK/c1.$w" 2>&1 ) &
done
wait
TOTAL=$(cat "$WORK"/c1.* | grep -c -E '^[0-9a-f-]{36}$' || true)
UNIQ=$(cat "$WORK"/c1.* | grep -E '^[0-9a-f-]{36}$' | sort -u | wc -l)
SENDING=$(q "select count(*) from dulabs_ba_reminders where status = 'sending' and attempts = 1")
[ "$TOTAL" = "300" ] && [ "$UNIQ" = "300" ] && [ "$SENDING" = "300" ] || fail "C1 total=$TOTAL únicos=$UNIQ sending=$SENDING"
echo "PASS C1 8 despachadores concurrentes, 300 recordatorios de 30 tenants: 300 tomas, 300 únicas, 0 duplicados"

# C2 ------------------------------------------------------------------------------------------------------------------
for w in $(seq 1 10); do
  ( "${PSQL[@]}" -c "select outcome from dulabs_ba_reminder_schedule('$T1', 'f', 'pn:c2', 'pn', '5731', 'cita-c2', now() + interval '3 hour', null, now() + interval '2 hour', 'America/Bogota', 'x', '$(KEYHEX 900001)', 'cercano')" > "$WORK/c2.$w" 2>&1 ) &
done
wait
ROWS=$(q "select count(*) from dulabs_ba_reminders where conversation_id = 'pn:c2'")
SCHED=$(cat "$WORK"/c2.* | grep -c '^scheduled$' || true)
ERRS=$(cat "$WORK"/c2.* | grep -c -i 'error' || true)
[ "$ROWS" = "1" ] && [ "$SCHED" = "1" ] && [ "$ERRS" = "0" ] || { cat "$WORK"/c2.*; fail "C2 filas=$ROWS scheduled=$SCHED errores=$ERRS"; }
echo "PASS C2 10 sesiones con la MISMA operación: 1 fila, 1 'scheduled', 9 idempotentes, 0 errores"

# C3 ------------------------------------------------------------------------------------------------------------------
# Varias rondas: una sola ronda puede "ganar" la carrera por azar (así pasó C3 en FASE 9 antes de 20261129).
for round in 1 2 3 4 5; do
  for w in $(seq 1 10); do
    ( "${PSQL[@]}" -c "select outcome from dulabs_ba_reminder_schedule('$T1', 'f', 'pn:c3-$round', 'pn', '5731', 'cita-c3', now() + interval '3 hour', null, now() + interval '2 hour' - make_interval(mins => $w), 'America/Bogota', 'x', '$(KEYHEX $((910000 + round * 100 + w)))', 'cercano')" > "$WORK/c3.$round.$w" 2>&1 ) &
  done
  wait
  ACTIVE=$(q "select count(*) from dulabs_ba_reminders where conversation_id = 'pn:c3-$round' and status in ('scheduled', 'sending')")
  ERRS=$(cat "$WORK"/c3.$round.* | grep -c -i 'error' || true)
  [ "$ACTIVE" = "1" ] && [ "$ERRS" = "0" ] || { grep -h -m2 ERROR "$WORK"/c3.$round.*; fail "C3 ronda $round: activos=$ACTIVE errores=$ERRS"; }
done
echo "PASS C3 5 rondas × 10 operaciones distintas para la MISMA cita en paralelo: siempre 1 recordatorio activo, 0 errores"

# C4 ------------------------------------------------------------------------------------------------------------------
q "do \$\$ declare i int; begin
  for i in 1..50 loop
    perform dulabs_ba_reminder_schedule('$T1', 'f', 'pn:c4-' || i, 'pn', '5732', 'cita', now() + interval '2 hour', null, now() + interval '1 hour', 'America/Bogota', 'x', lpad(to_hex(800000 + i), 32, '0'), 'cercano');
  end loop;
  update dulabs_ba_reminders set remind_at = now() - interval '1 second' where conversation_id like 'pn:c4-%';
end \$\$;" >/dev/null
q "select id || ' ' || attempts from dulabs_ba_reminder_claim_due(50, 60) where conversation_id like 'pn:c4-%'" > "$WORK/c4.claimed"
[ "$(wc -l < "$WORK/c4.claimed")" = "50" ] || fail "C4 claim"
( i=0; while read -r id att; do i=$((i + 1)); "${PSQL[@]}" -c "select '$id', dulabs_ba_reminder_begin_send('$T1', '$id', $att)"; done < "$WORK/c4.claimed" > "$WORK/c4.begin" 2>&1 ) &
( for i in $(seq 1 50); do "${PSQL[@]}" -c "select dulabs_ba_reminder_cancel('$T1', 'pn:c4-$i', null)"; done > "$WORK/c4.cancel" 2>&1 ) &
wait
GO=$(grep -c '|go$' "$WORK/c4.begin" || true)
CANC=$(grep -c '|cancelled$' "$WORK/c4.begin" || true)
# Invariante: 'cancelled' ⇒ fila cancelada; 'go' ⇒ la cancelación llegó DESPUÉS (queda marcada para no reintentarse) — nunca scheduled.
BAD=$(q "select count(*) from dulabs_ba_reminders where conversation_id like 'pn:c4-%' and not (status = 'cancelled' or (status = 'sending' and cancel_requested))")
[ $((GO + CANC)) = "50" ] && [ "$BAD" = "0" ] || { cat "$WORK/c4.begin" | head; fail "C4 go=$GO cancelled=$CANC inconsistentes=$BAD"; }
echo "PASS C4 cancelar vs begin_send en carrera (50): $CANC no enviados (cancelados a tiempo), $GO ya en envío (cancelación posterior registrada), 0 inconsistentes"

# C5 ------------------------------------------------------------------------------------------------------------------
for w in $(seq 1 40); do
  ( "${PSQL[@]}" -c "select allowed from dulabs_ba_rate_limit_hit('contact', 'c5', 3600, 25)" > "$WORK/c5.$w" 2>&1 ) &
done
wait
ALLOWED=$(cat "$WORK"/c5.* | grep -c '^t$' || true)
DENIED=$(cat "$WORK"/c5.* | grep -c '^f$' || true)
[ "$ALLOWED" = "25" ] && [ "$DENIED" = "15" ] || fail "C5 permitidos=$ALLOWED rechazados=$DENIED"
echo "PASS C5 40 golpes simultáneos con límite 25: 25 permitidos, 15 rechazados (contador atómico en Postgres)"

# C6 ------------------------------------------------------------------------------------------------------------------
for w in $(seq 1 40); do
  ( "${PSQL[@]}" -c "select dulabs_ba_usage_record('$T1', current_date, 1, 1, 100, 10, 5, 0, 0, 0, 200)" > "$WORK/c6.$w" 2>&1 ) &
done
wait
USAGE=$(q "select turns || '/' || ai_calls || '/' || input_tokens || '/' || latency_ms_total from dulabs_ba_usage_daily where id_tenant = '$T1' and day = current_date")
[ "$USAGE" = "40/40/4000/8000" ] || fail "C6 uso=$USAGE"
echo "PASS C6 40 registros de uso simultáneos: turns=40, ai_calls=40, tokens=4000 (0 incrementos perdidos)"

# C7 ------------------------------------------------------------------------------------------------------------------
q "insert into dulabs_ba_conversation_states (id_tenant, phone_number_id, telefono_cliente, agent_id, status, schema_version, state) values ('$T1', 'pn', '573001', 'f', 'NEW', 'v', '{\"status\":\"NEW\"}')" >/dev/null
for w in $(seq 1 20); do
  ( "${PSQL[@]}" -c "with u as (update dulabs_ba_conversation_states set state = '{\"status\":\"COLLECTING_INFORMATION\",\"w\":$w}', status = 'COLLECTING_INFORMATION', state_version = 2 where id_tenant = '$T1' and telefono_cliente = '573001' and state_version = 1 returning 1) select count(*) from u" > "$WORK/c7.$w" 2>&1 ) &
done
wait
WON=$(cat "$WORK"/c7.* | grep -c '^1$' || true)
[ "$WON" = "1" ] && [ "$(q "select state_version from dulabs_ba_conversation_states where telefono_cliente = '573001'")" = "2" ] || fail "C7 ganadores=$WON"
echo "PASS C7 20 escrituras del estado con la misma versión esperada: 1 gana, 19 ven conflicto (concurrencia optimista)"

# C8 ------------------------------------------------------------------------------------------------------------------
q "select outcome from dulabs_ba_save_onboarding_draft('$T1', 'f', 0, '{}', null)" >/dev/null
for w in $(seq 1 20); do
  ( "${PSQL[@]}" -c "select outcome from dulabs_ba_save_onboarding_draft('$T1', 'f', 1, '{\"w\":$w}', null)" > "$WORK/c8.$w" 2>&1 ) &
done
wait
SAVED=$(cat "$WORK"/c8.* | grep -c '^saved$' || true)
[ "$SAVED" = "1" ] || fail "C8 guardados=$SAVED"
echo "PASS C8 20 guardados del borrador con la misma revisión: 1 guarda, 19 conflicto (sin pisarse)"

# C9 ------------------------------------------------------------------------------------------------------------------
ART="jsonb_build_object('artifactSchema', 'business-agent.artifact/1.0.0', 'compilerVersion', '5.0.0', 'source', 'business_model', 'tenantId', '$T1', 'agentId', 'f9', 'version', jsonb_build_object('ref', 'ubm-v1', 'publishedVersion', 1), 'checksum', repeat('a', 64), 'executionFingerprint', repeat('b', 32))"
for w in $(seq 1 10); do
  ( "${PSQL[@]}" -c "select outcome from dulabs_ba_publish_business_model('$T1', 'f9', 0, '{\"schemaVersion\":\"business-agent.business-model/1.0.0\"}', repeat('c', 64), $ART, repeat('a', 64), repeat('b', 32))" > "$WORK/c9.$w" 2>&1 ) &
done
wait
PUB=$(cat "$WORK"/c9.* | grep -c '^published$' || true)
VERS=$(q "select count(*) from dulabs_ba_business_models where id_tenant = '$T1' and agent_id = 'f9'")
[ "$PUB" = "1" ] && [ "$VERS" = "1" ] || { cat "$WORK"/c9.*; fail "C9 publicadas=$PUB versiones=$VERS"; }
echo "PASS C9 10 publicaciones simultáneas: 1 versión publicada, 9 conflictos"

# C10 -----------------------------------------------------------------------------------------------------------------
RID=$(q "select id from dulabs_ba_reminders where conversation_id = 'pn:1'")
q "update dulabs_ba_reminders set lease_until = now() - interval '1 second' where id = '$RID'" >/dev/null
q "select count(*) from dulabs_ba_reminder_claim_due(1, 60)" >/dev/null   # el lease vencido pasa a unknown (verificación pendiente)
[ "$(q "select status || '/' || verification from dulabs_ba_reminders where id = '$RID'")" = "unknown/pending" ] || fail "C10 preparación"
for w in 1 2; do ( "${PSQL[@]}" -c "select dulabs_ba_reminder_resolve_unknown('00000000-0000-4000-8000-000000000002', '$RID', true)" > "$WORK/c10.$w" 2>&1 ) & done
wait
EFFECTIVE=$(cat "$WORK"/c10.* | grep -c '^t$' || true)
[ "$EFFECTIVE" = "1" ] && [ "$(q "select status || '/' || verification from dulabs_ba_reminders where id = '$RID'")" = "sent/verified_sent" ] || fail "C10 efectivas=$EFFECTIVE"
echo "PASS C10 2 verificadores del mismo envío desconocido: 1 resolución efectiva, estado final sent/verified_sent"

# C11 -----------------------------------------------------------------------------------------------------------------
RID=$(q "select id from dulabs_ba_reminders where conversation_id = 'pn:3'")
ATT=$(q "select attempts from dulabs_ba_reminders where id = '$RID'")
q "update dulabs_ba_reminders set lease_until = now() - interval '1 second' where id = '$RID'" >/dev/null
q "select count(*) from dulabs_ba_reminder_claim_due(1, 60)" >/dev/null
LATE=$(q "select dulabs_ba_reminder_mark_sent('00000000-0000-4000-8000-000000000004', '$RID', $ATT, 'wamid.late')")
LATE2=$(q "select dulabs_ba_reminder_begin_send('00000000-0000-4000-8000-000000000004', '$RID', $ATT)")
[ "$LATE" = "f" ] && [ "$LATE2" = "lost" ] && [ "$(q "select status from dulabs_ba_reminders where id = '$RID'")" = "unknown" ] || fail "C11 mark_sent=$LATE begin_send=$LATE2"
echo "PASS C11 worker reiniciado (lease vencido): su cierre tardío se rechaza (fencing) y begin_send devuelve lost; queda unknown → verificar"

echo "OK concurrencia real verificada (11 casos) en PostgreSQL $("${PSQL[@]}" -c 'show server_version')"
