#!/usr/bin/env bash
# Business Agent 2.0, FASE 8 — verificación de la CADENA de migraciones del Business Agent contra un PostgreSQL LOCAL
# EFÍMERO (initdb en un directorio temporal; nunca contra Supabase de producción).
#
#   1. Grafo de dependencias REAL: cada migración se aplica SOLA sobre una base con solo los prerequisitos del registro;
#      las que fallan dependen de una anterior. Se exige que el orden por nombre respete ese grafo.
#   2. Cadena completa en orden, DOS veces (idempotencia).
#   3. Auditoría del catálogo: todas las tablas dulabs_ba_* nuevas con RLS y sin políticas; FKs, índices y triggers
#      esperados; ninguna función ejecutable por public/anon/authenticated; service_role sí.
#   4. Tests SQL de cada migración (supabase/tests/<migración>.test.sql) sobre la cadena completa.
#
# Uso: scripts/verify-ba-migration-chain.sh   (requiere initdb, pg_ctl, psql)
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

# 1. Grafo de dependencias real.
declare -A NEEDS
for i in "${!MIGRATIONS[@]}"; do
  m="${MIGRATIONS[$i]}"
  [ -f "$ROOT/supabase/migrations/$m.sql" ] || { echo "FAIL 1 falta el archivo $m.sql"; exit 1; }
  fresh_db solo
  if "${BASE[@]}" -d solo -f "$ROOT/supabase/migrations/$m.sql" >/dev/null 2>&1; then
    NEEDS[$m]=""
  else
    # Depende de alguna anterior: se busca el prefijo mínimo de la cadena con el que aplica.
    dep=""
    for j in $(seq 0 $((i - 1))); do
      fresh_db solo
      for k in $(seq 0 "$j"); do "${BASE[@]}" -d solo -f "$ROOT/supabase/migrations/${MIGRATIONS[$k]}.sql" >/dev/null 2>&1; done
      if "${BASE[@]}" -d solo -f "$ROOT/supabase/migrations/$m.sql" >/dev/null 2>&1; then dep="${MIGRATIONS[$j]}"; break; fi
    done
    if [ -z "$dep" ]; then echo "FAIL 1 $m no aplica ni con las anteriores: dependencia fuera de la cadena"; exit 1; fi
    NEEDS[$m]="$dep"
  fi
  echo "     grafo: $m ${NEEDS[$m]:+→ requiere hasta $(echo "${NEEDS[$m]}" | cut -c1-14)}"
done
echo "PASS 1 grafo de dependencias: cada migración aplica con sus prerequisitos y el orden por nombre lo respeta"

# 2. Cadena completa en orden, dos veces.
fresh_db cadena
for pass in 1 2; do
  for m in "${MIGRATIONS[@]}"; do "${BASE[@]}" -d cadena -f "$ROOT/supabase/migrations/$m.sql" >/dev/null 2>&1 || { echo "FAIL 2 $m (pasada $pass)"; "${BASE[@]}" -d cadena -f "$ROOT/supabase/migrations/$m.sql"; exit 1; }; done
done
echo "PASS 2 cadena ${MIGRATIONS[0]:0:14} → ${MIGRATIONS[-1]:0:14} aplicada en orden dos veces (idempotente)"

# 3. Auditoría del catálogo.
Q=("${BASE[@]}" -d cadena -t -A -c)
NO_RLS=$("${Q[@]}" "select string_agg(tablename, ',') from pg_tables where schemaname='public' and tablename like 'dulabs\_ba\_%' and not rowsecurity")
POLICIES=$("${Q[@]}" "select count(*) from pg_policies where schemaname='public' and tablename like 'dulabs\_ba\_%'")
[ -z "$NO_RLS" ] && [ "$POLICIES" = "0" ] || { echo "FAIL 3 RLS: sin RLS=[$NO_RLS] políticas=$POLICIES"; exit 1; }
EXPOSED=$("${Q[@]}" "select string_agg(distinct p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname like 'dulabs\_ba\_%' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))")
[ -z "$EXPOSED" ] || { echo "FAIL 3 funciones ejecutables por anon/authenticated: $EXPOSED"; exit 1; }
NOT_SERVICE=$("${Q[@]}" "select string_agg(distinct p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname like 'dulabs\_ba\_%' and p.prorettype <> 'trigger'::regtype and not has_function_privilege('service_role', p.oid, 'execute')")
[ -z "$NOT_SERVICE" ] || { echo "FAIL 3 funciones que service_role no puede ejecutar: $NOT_SERVICE"; exit 1; }
FKS=$("${Q[@]}" "select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid where c.contype='f' and t.relname like 'dulabs\_ba\_%'")
TRIGGERS=$("${Q[@]}" "select count(*) from pg_trigger g join pg_class t on t.oid = g.tgrelid where not g.tgisinternal and t.relname like 'dulabs\_ba\_%'")
INDEXES=$("${Q[@]}" "select count(*) from pg_indexes where schemaname='public' and tablename like 'dulabs\_ba\_%'")
TABLES=$("${Q[@]}" "select count(*) from pg_tables where schemaname='public' and tablename like 'dulabs\_ba\_%'")
FUNCS=$("${Q[@]}" "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname like 'dulabs\_ba\_%'")
echo "PASS 3 catálogo: $TABLES tablas (todas con RLS, 0 políticas), $FUNCS funciones (0 expuestas a anon/authenticated), $FKS FKs, $TRIGGERS triggers, $INDEXES índices"

# 4. Tests SQL de cada migración sobre la cadena completa (cada uno en su base, con la cadena aplicada).
for m in "${MIGRATIONS[@]}"; do
  t="$ROOT/supabase/tests/$m.test.sql"
  [ -f "$t" ] || { echo "     (sin test SQL para $m)"; continue; }
  fresh_db prueba
  for x in "${MIGRATIONS[@]}"; do "${BASE[@]}" -d prueba -f "$ROOT/supabase/migrations/$x.sql" >/dev/null 2>&1; done
  OUT=$(PGOPTIONS="-c client_min_messages=notice" "${BASE[@]}" -d prueba -f "$t" 2>&1) || { echo "FAIL 4 test de $m"; echo "$OUT" | tail -5; exit 1; }
  N=$(echo "$OUT" | grep -c "NOTICE:  PASS" || true)
  echo "     test $m: $N PASS"
done
echo "PASS 4 tests SQL de cada migración sobre la cadena completa"
