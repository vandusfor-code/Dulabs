#!/usr/bin/env bash
# Business Agent 2.0, FASE 10 — verifica scripts/ba-pilot-report.sql contra PostgreSQL real con la cadena de migraciones
# del Business Agent: cada métrica sale EXACTA de las filas (sin inventar), solo del tenant pedido y dentro de la ventana,
# y el reporte es de solo lectura (corre dentro de una transacción READ ONLY).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54350}"
trap '"$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

MIGRATIONS=(
  20261123000000_dulabs_ba_conversation_states
  20261124000000_dulabs_ba_action_engine
  20261125000000_dulabs_ba_business_models
  20261126000000_dulabs_ba_onboarding
  20261127000000_dulabs_ba_reminders
  20261128000000_dulabs_ba_production_hardening
  20261129000000_dulabs_ba_reminder_schedule_lock
)

run_pg() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; fi
run_pg "'$PGBIN/initdb' -D '$WORK/data' -U postgres -A trust >/dev/null"
run_pg "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses= -c max_connections=40' -l '$WORK/log' start >/dev/null"
export PGOPTIONS="-c client_min_messages=warning"
BASE=("$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

# Prerequisitos que YA existen en producción (registro de flows, versiones del Business Agent, funciones reales).
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

fresh_db() {
  "${BASE[@]}" -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null
  "${BASE[@]}" -d "$1" -f "$WORK/prereq.sql" -f "$WORK/publish_fn.sql" -f "$WORK/updated_at_fn.sql" >/dev/null
}

fresh_db pilot
for m in "${MIGRATIONS[@]}"; do "${BASE[@]}" -d pilot -f "$ROOT/supabase/migrations/$m.sql" >/dev/null; done
Q=("${BASE[@]}" -d pilot -At -F '|')
A=aaaaaaaa-0000-4000-8000-00000000000a
B=bbbbbbbb-0000-4000-8000-00000000000b
k() { printf '%032x' "$1"; }
h() { printf '%064x' "$1"; }
"${Q[@]}" <<SQL >/dev/null
insert into dulabs_ba_usage_daily (id_tenant, day, turns, ai_calls, input_tokens, output_tokens, estimated_cost_micro_usd, turn_errors, latency_ms_total)
values ('$A', current_date, 40, 38, 40000, 4000, 22000, 2, 80000), ('$A', current_date - 30, 999, 999, 1, 1, 1, 9, 1), ('$B', current_date, 500, 500, 1, 1, 1, 50, 1);
insert into dulabs_ba_action_executions (id_tenant, agent_id, conversation_id, action, contract_version, idempotency_key, arguments_hash, status, completed_at) values
  ('$A', 'f', 'c1', 'crear_cita_nylas_generico', '1', '$(k 1)', '$(h 1)', 'SUCCEEDED', now()),
  ('$A', 'f', 'c2', 'crear_cita_nylas_generico', '1', '$(k 2)', '$(h 2)', 'SUCCEEDED', now()),
  ('$A', 'f', 'c2', 'cancelar_cita_cliente', '1', '$(k 3)', '$(h 3)', 'SUCCEEDED', now()),
  ('$A', 'f', 'c3', 'crear_cita_nylas_generico', '1', '$(k 4)', '$(h 4)', 'TIMED_OUT', now()),
  ('$A', 'f', 'c4', 'crear_cita_nylas_generico', '1', '$(k 5)', '$(h 5)', 'REJECTED', now()),
  ('$A', 'f', 'c5', 'buscar_conocimiento', '1', '$(k 6)', '$(h 6)', 'FAILED', now()),
  ('$B', 'f', 'x', 'crear_cita_nylas_generico', '1', '$(k 7)', '$(h 7)', 'SUCCEEDED', now()),
  ('$B', 'f', 'x', 'crear_cita_nylas_generico', '1', '$(k 8)', '$(h 7)', 'SUCCEEDED', now());
insert into dulabs_ba_incidents (id_tenant, ref, correlation_id, code, error_class) values
  ('$A', 'AAAA1111', 'corr-0001', 'BA-AI-TIMEOUT', 'AI'), ('$A', 'AAAA2222', 'corr-0002', 'BA-INTEGRATION-CIRCUIT_OPEN', 'INTEGRATION'),
  ('$B', 'BBBB1111', 'corr-0003', 'BA-AI-TIMEOUT', 'AI');
SQL
sed "s/00000000-0000-0000-0000-000000000000/$A/" "$ROOT/scripts/ba-pilot-report.sql" > "$WORK/report.sql"
OUT=$( { echo "begin transaction read only;"; cat "$WORK/report.sql"; echo "commit;"; } | "${Q[@]}" 2>&1)
val() { echo "$OUT" | awk -F'|' -v k="$1" '$1==k {print $2}'; }
fail() { echo "FAIL $*"; echo "$OUT"; exit 1; }
check() { [ "$(val "$1")" = "$2" ] || fail "$1 = '$(val "$1")' (esperado '$2')"; }
[ "$(echo "$OUT" | grep -c '|')" = "27" ] || fail "se esperaban 27 métricas"
check mensajes_atendidos 40
check llamadas_ia 38
check latencia_promedio_ms 2000
check costo_estimado_usd 0.0220
check errores_de_turno 2
check acciones_ejecutadas 3
check acciones_rechazadas 1
check acciones_fallidas 1
check acciones_timeout_desenlace_desconocido 1
check reservas 2
check cancelaciones 1
check reprogramaciones 0
check recordatorios_programados 0
check errores_ia 1
check errores_integracion 1
check efectos_duplicados 0
check tasa_fallback_ia_pct 2.50
check tasa_fallo_acciones_pct 33.33
check tasa_efecto_duplicado_pct 0.00
check tasa_desenlace_desconocido_pct 16.67
echo "PASS P1 métricas exactas del tenant A en la ventana (27 métricas; nada de B ni de hace 30 días; solo lectura)"
sed "s/00000000-0000-0000-0000-000000000000/$B/" "$ROOT/scripts/ba-pilot-report.sql" > "$WORK/report.sql"
OUT=$( { echo "begin transaction read only;"; cat "$WORK/report.sql"; echo "commit;"; } | "${Q[@]}" 2>&1)
check efectos_duplicados 1
check tasa_efecto_duplicado_pct 50.00
echo "PASS P2 efecto duplicado REAL detectado (misma escritura exitosa dos veces en B)"
NEW=00000000-0000-4000-8000-000000000999
sed "s/00000000-0000-0000-0000-000000000000/$NEW/" "$ROOT/scripts/ba-pilot-report.sql" > "$WORK/report.sql"
OUT=$( { echo "begin transaction read only;"; cat "$WORK/report.sql"; echo "commit;"; } | "${Q[@]}" 2>&1)
check mensajes_atendidos 0
check latencia_promedio_ms ""
check tasa_fallback_ia_pct ""
check tasa_fallo_acciones_pct ""
echo "PASS P3 tenant sin datos: conteos en 0 y tasas NULL (nunca un 0 % inventado)"
echo "OK reporte del piloto verificado en PostgreSQL $("${BASE[@]}" -d pilot -At -c 'show server_version')"
