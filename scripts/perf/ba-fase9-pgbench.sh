#!/usr/bin/env bash
# Business Agent 2.0, FASE 9 — contención REAL de Postgres en el camino de cada mensaje con 10 / 50 / 100 clientes
# concurrentes (pgbench) contra un PostgreSQL LOCAL EFÍMERO con la cadena 20261123 → 20261128 (nunca producción).
#
# Transacción simulada por mensaje (lo que el Business Agent agrega a la base por mensaje en FASE 9 + el estado):
#   2 límites (contacto + tenant) · 1 escritura del estado conversacional con versión optimista · 1 registro de uso
# Los tenants se reparten entre N (10/50/100) y cada cliente es una conversación distinta. Mide TPS y latencia media;
# verifica al final que los contadores de uso suman exactamente las transacciones confirmadas.
#
# Uso: scripts/perf/ba-fase9-pgbench.sh [segundos]   (requiere initdb, pg_ctl, psql, pgbench)
set -euo pipefail
SECS="${1:-10}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54352}"
trap '"$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

run_pg() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; fi
run_pg "'$PGBIN/initdb' -D '$WORK/data' -U postgres -A trust >/dev/null"
run_pg "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses= -c max_connections=140' -l '$WORK/log' start >/dev/null"
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
         20261126000000_dulabs_ba_onboarding 20261127000000_dulabs_ba_reminders 20261128000000_dulabs_ba_production_hardening; do
  "${PSQL[@]}" -f "$ROOT/supabase/migrations/$m.sql" >/dev/null
done
PGB="$PGBIN/pgbench"
cat > "$WORK/msg.sql" <<'SQL'
\set t random(1, :ntenants)
\set c :client_id
select allowed from dulabs_ba_rate_limit_hit('contact_messages', 'c' || :c, 60, 1000000);
select allowed from dulabs_ba_rate_limit_hit('tenant_messages', 't' || :t, 60, 1000000);
update dulabs_ba_conversation_states set state_version = state_version + 1, last_message_at = now() where telefono_cliente = '57300' || lpad(:c::text, 6, '0') and agent_id = 'load';
select dulabs_ba_usage_record(('00000000-0000-4000-8000-' || lpad(:t::text, 12, '0'))::uuid, current_date, 1, 1, 900, 60, 420, 0, 0, 0, 250);
SQL
chmod 644 "$WORK/msg.sql"
echo "clientes,tenants,tps,latencia_media_ms,transacciones,uso_registrado"
for N in 10 50 100; do
  "${PSQL[@]}" -c "truncate dulabs_ba_usage_daily, dulabs_ba_rate_counters; delete from dulabs_ba_conversation_states where agent_id = 'load';" >/dev/null
  "${PSQL[@]}" -c "insert into dulabs_ba_conversation_states (id_tenant, phone_number_id, telefono_cliente, agent_id, status, schema_version, state)
                   select ('00000000-0000-4000-8000-' || lpad(((g % $N) + 1)::text, 12, '0'))::uuid, 'pn', '57300' || lpad(g::text, 6, '0'), 'load', 'NEW', 'v', '{\"status\":\"NEW\"}'
                     from generate_series(0, $N) g" >/dev/null
  OUT=$("$PGB" -h "$WORK" -p "$PORT" -U postgres -n -c "$N" -j 4 -T "$SECS" -D ntenants="$N" -f "$WORK/msg.sql" postgres 2>&1)
  TPS=$(echo "$OUT" | grep -oP 'tps = \K[0-9.]+' | head -1)
  LAT=$(echo "$OUT" | grep -oP 'latency average = \K[0-9.]+' | head -1)
  TX=$(echo "$OUT" | grep -oP 'number of transactions actually processed: \K[0-9]+' | head -1)
  USO=$("${PSQL[@]}" -c "select coalesce(sum(turns), 0) from dulabs_ba_usage_daily")
  FAILED=$(echo "$OUT" | grep -oP 'number of failed transactions: \K[0-9]+' | head -1 || echo 0)
  echo "$N,$N,$TPS,$LAT,$TX,$USO"
  [ "$USO" = "$TX" ] || { echo "FAIL uso registrado ($USO) != transacciones ($TX)"; exit 1; }
  [ "${FAILED:-0}" = "0" ] || { echo "FAIL transacciones fallidas: $FAILED"; exit 1; }
done
echo "OK pgbench: 0 transacciones fallidas; uso por tenant exacto bajo concurrencia (PostgreSQL $("${PSQL[@]}" -c 'show server_version' | cut -d' ' -f1))"
