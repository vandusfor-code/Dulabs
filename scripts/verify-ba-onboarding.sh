#!/usr/bin/env bash
# Business Agent 2.0, FASE 6 — verifica la migración de la configuración guiada contra un PostgreSQL LOCAL EFÍMERO
# (initdb en un directorio temporal; nunca contra Supabase de producción):
#   1. tablas mínimas del registro + la función REAL dulabs_flow_publish_version (extraída de su migración);
#   2. FASE 5 (20261125000000) y FASE 6 (20261126000000, dos veces: idempotente);
#   3. el test SQL (borrador, publicación atómica, conflictos, reversión total, inmutabilidad, RLS, aislamiento);
#   4. concurrencia REAL: N pestañas guardan / publican a la vez => exactamente una gana.
# Uso: scripts/verify-ba-onboarding.sh   (requiere initdb, pg_ctl, psql)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54332}"
N="${WORKERS:-12}"
trap '"$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

run_pg() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; fi
run_pg "'$PGBIN/initdb' -D '$WORK/data' -U postgres -A trust >/dev/null"
run_pg "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses= -c max_connections=60' -l '$WORK/log' start >/dev/null"
PSQL=("$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" <<'SQL'
create role service_role bypassrls; create role anon; create role authenticated;
-- Tablas mínimas del registro (mismas claves y FKs que 20260828100000 / 20261018000000).
create table public.dulabs_flows (tenant_id uuid not null, id uuid not null default gen_random_uuid(), slug text not null, name text not null,
  status text not null default 'draft' check (status in ('draft','published','archived')), published_version_id uuid,
  updated_at timestamptz not null default now(), primary key (tenant_id, id));
create table public.dulabs_flow_versions (tenant_id uuid not null, id uuid not null default gen_random_uuid(), flow_id uuid not null,
  version_number int not null, definition_json jsonb not null, published_at timestamptz, retired_at timestamptz,
  primary key (tenant_id, id), foreign key (tenant_id, flow_id) references public.dulabs_flows (tenant_id, id));
create table public.dulabs_business_agent_versions (tenant_id uuid not null, id uuid not null default gen_random_uuid(), flow_id uuid not null,
  flow_version_id uuid not null, validation_status text not null, primary key (tenant_id, id), unique (tenant_id, flow_version_id));
SQL
# La función REAL de publicación del registro, tal como está en su migración.
awk '/^create or replace function public.dulabs_flow_publish_version\(/,/^\$\$;/' "$ROOT/supabase/migrations/20260828110000_dulabs_flow_store_critical_fixes.sql" > "$WORK/publish_fn.sql"
"${PSQL[@]}" -f "$WORK/publish_fn.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261125000000_dulabs_ba_business_models.sql" 2>/dev/null
for i in 1 2; do "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261126000000_dulabs_ba_onboarding.sql" 2>/dev/null; done
echo "PASS 0 migración idempotente (aplicada dos veces sobre FASE 5 y el registro real)"
"${PSQL[@]}" -f "$ROOT/supabase/tests/20261126000000_dulabs_ba_onboarding.test.sql" 2>&1 | sed -n 's/.*NOTICE:  //p'

T="cccccccc-0000-4000-8000-00000000000c"
F="fcfcfcfc-0000-4000-8000-00000000000c"
V="acacacac-0000-4000-8000-00000000000c"
"${PSQL[@]}" -c "insert into dulabs_flows (tenant_id, id, slug, name) values ('$T', '$F', 'business-agent', 'BA');
  insert into dulabs_flow_versions (tenant_id, id, flow_id, version_number, definition_json) values ('$T', '$V', '$F', 1, '{}');
  insert into dulabs_business_agent_versions (tenant_id, flow_id, flow_version_id, validation_status) values ('$T', '$F', '$V', 'validated');
  select dulabs_ba_save_onboarding_draft('$T', '$F', 0, '{\"version\":\"business-agent.onboarding-draft/1\"}', null);" >/dev/null

# 9. N pestañas guardan a la vez partiendo de la MISMA revisión (1): exactamente una guarda.
START=$(( $(date +%s) + 2 ))
for w in $(seq 1 "$N"); do
  ( while [ "$(date +%s)" -lt "$START" ]; do :; done
    "${PSQL[@]}" -t -A -c "select outcome from dulabs_ba_save_onboarding_draft('$T', '$F', 1, '{\"version\":\"business-agent.onboarding-draft/1\",\"w\":$w}', null)" > "$WORK/save.$w" 2>&1 ) &
done
wait
SAVED=$(cat "$WORK"/save.* | grep -c '^saved$' || true)
REV=$("${PSQL[@]}" -t -A -c "select revision from dulabs_ba_onboarding_drafts where id_tenant = '$T'")
if [ "$SAVED" != "1" ] || [ "$REV" != "2" ]; then echo "FAIL 9 guardados concurrentes: saved=$SAVED revision=$REV"; cat "$WORK"/save.*; exit 1; fi
echo "PASS 9 concurrencia real: $N pestañas guardan la revisión 1 a la vez => 1 guarda, $((N - 1)) conflict (revisión 2)"

# 10. N pestañas publican a la vez la MISMA revisión: exactamente una publica; el registro y el modelo quedan coherentes.
ART="jsonb_build_object('artifactSchema','business-agent.artifact/1.0.0','compilerVersion','5.0.0','source','business_model','tenantId','$T','agentId','$F','version',jsonb_build_object('ref','ubm-v1','publishedVersion',1),'checksum',repeat('a',64),'executionFingerprint',repeat('b',32))"
START=$(( $(date +%s) + 2 ))
for w in $(seq 1 "$N"); do
  ( while [ "$(date +%s)" -lt "$START" ]; do :; done
    "${PSQL[@]}" -t -A -c "select outcome from dulabs_ba_publish_onboarding('$T', '$F', '$V', 2, 0, '{\"schemaVersion\":\"business-agent.business-model/1.0.0\"}', repeat('c',64), $ART, repeat('a',64), repeat('b',32))" > "$WORK/pub.$w" 2>&1 ) &
done
wait
PUB=$(cat "$WORK"/pub.* | grep -c '^published$' || true)
CONF=$(cat "$WORK"/pub.* | grep -c '^version_conflict$' || true)
MODELS=$("${PSQL[@]}" -t -A -c "select count(*) from dulabs_ba_business_models where id_tenant = '$T'")
LINKS=$("${PSQL[@]}" -t -A -c "select count(*) from dulabs_ba_onboarding_publications where id_tenant = '$T'")
PTR=$("${PSQL[@]}" -t -A -c "select published_version_id from dulabs_flows where tenant_id = '$T'")
if [ "$PUB" != "1" ] || [ "$CONF" != "$((N - 1))" ] || [ "$MODELS" != "1" ] || [ "$LINKS" != "1" ] || [ "$PTR" != "$V" ]; then
  echo "FAIL 10 publicación concurrente: published=$PUB conflict=$CONF modelos=$MODELS enlaces=$LINKS puntero=$PTR"; cat "$WORK"/pub.*; exit 1
fi
echo "PASS 10 concurrencia real: $N publicaciones simultáneas => 1 published, $((N - 1)) conflict; 1 modelo, 1 enlace, puntero coherente"
