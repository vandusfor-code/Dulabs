#!/usr/bin/env bash
# Business Agent 2.0, FASE 5 — verifica la migración del Universal Business Model contra un PostgreSQL LOCAL EFÍMERO
# (initdb en un directorio temporal; nunca contra Supabase de producción):
#   1. la migración aplica dos veces (idempotente);
#   2. el test SQL (publicación, control optimista, inmutabilidad, consistencia contenido/columnas, rollback,
#      aislamiento por tenant, RLS y permisos);
#   3. concurrencia REAL: N sesiones publican a la vez sobre la MISMA versión => exactamente una publica.
# Uso: scripts/verify-ba-business-models.sh   (requiere initdb, pg_ctl, psql)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54331}"
N="${WORKERS:-12}"
trap '"$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

run_pg() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; fi
run_pg "'$PGBIN/initdb' -D '$WORK/data' -U postgres -A trust >/dev/null"
run_pg "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses= -c max_connections=60' -l '$WORK/log' start >/dev/null"
PSQL=("$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -c "create role service_role bypassrls; create role anon; create role authenticated;"
for i in 1 2; do "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261125000000_dulabs_ba_business_models.sql" 2>/dev/null; done
echo "PASS 0 migración idempotente (aplicada dos veces)"
"${PSQL[@]}" -f "$ROOT/supabase/tests/20261125000000_dulabs_ba_business_models.test.sql" 2>&1 | sed -n 's/.*NOTICE:  //p'

# 9. N editores publican a la vez sobre la misma versión vigente (0): exactamente uno gana.
T="cccccccc-0000-4000-8000-00000000000c"
ART="jsonb_build_object('artifactSchema','business-agent.artifact/1.0.0','compilerVersion','5.0.0','source','business_model','tenantId','$T','agentId','flow-c','version',jsonb_build_object('ref','ubm-v1','publishedVersion',1),'checksum',repeat('a',64),'executionFingerprint',repeat('b',32))"
START=$(( $(date +%s) + 2 ))
for w in $(seq 1 "$N"); do
  ( while [ "$(date +%s)" -lt "$START" ]; do :; done
    "${PSQL[@]}" -t -A -c "select outcome from dulabs_ba_publish_business_model('$T', 'flow-c', 0, '{\"schemaVersion\":\"business-agent.business-model/1.0.0\"}', repeat('c',64), $ART, repeat('a',64), repeat('b',32))" > "$WORK/pub.$w" 2>&1 ) &
done
wait
PUB=$(cat "$WORK"/pub.* | grep -c '^published$' || true)
CONF=$(cat "$WORK"/pub.* | grep -c '^conflict$' || true)
ROWS=$("${PSQL[@]}" -t -A -c "select count(*) from dulabs_ba_business_models where id_tenant = '$T'")
ACT=$("${PSQL[@]}" -t -A -c "select published_version from dulabs_ba_active_artifacts where id_tenant = '$T'")
if [ "$PUB" != "1" ] || [ "$CONF" != "$((N - 1))" ] || [ "$ROWS" != "1" ] || [ "$ACT" != "1" ]; then
  echo "FAIL 9 publicación concurrente: published=$PUB conflict=$CONF filas=$ROWS activa=$ACT"; cat "$WORK"/pub.*; exit 1
fi
echo "PASS 9 concurrencia real: $N publicaciones simultáneas sobre v0 => 1 published, $((N - 1)) conflict, 1 versión"
