#!/usr/bin/env bash
# Registros de módulo — CONCURRENCIA REAL: varios conciliadores (sesiones de Postgres) a la vez.
#
# ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO con el preludio y la migración aplicados.
# Uso: PSQL="psql -h /var/tmp/pgpb -p 55433 -U postgres -d <base>" bash supabase/tests/…concurrencia.sh
set -euo pipefail
PSQL=${PSQL:?define PSQL}
T=ffffffff-0000-4000-8000-000000000006
PN=pid-sint-reg-conc
SALIDA=$(mktemp)

$PSQL -q -v ON_ERROR_STOP=1 > /dev/null <<SQL
delete from dulabs_registros_modulo where tenant_id = '$T';
delete from dulabs_flow_executions where tenant_id = '$T';
delete from dulabs_clientes_config where id_tenant = '$T';
insert into dulabs_clientes_config (id_tenant, phone_number_id) values ('$T', '$PN');
insert into dulabs_flow_executions (tenant_id, id, flow_id, flow_version_id, execution_id, phone_number_id, telefono_cliente, status)
select '$T', ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, gen_random_uuid(), gen_random_uuid(), 'k' || g, '$PN', '5731' || lpad(g::text, 8, '0'), 'completed'
  from generate_series(1, 60) g;
select dulabs_registro_modulo_abrir('$T', 'mod_prueba', e.id, e.phone_number_id, e.telefono_cliente, 'act', '{}'::jsonb, 0)
  from dulabs_flow_executions e where e.tenant_id = '$T';
SQL

# 1. La MISMA ejecución abierta 15 veces a la vez: UNA fila.
for i in $(seq 1 15); do
  $PSQL -qAtc "select dulabs_registro_modulo_abrir('$T', 'mod_prueba', '00000000-0000-4000-9000-000000000001', '$PN', '573100000001', 'act', '{}'::jsonb, 0)" > /dev/null &
done
wait
N=$($PSQL -qAtc "select count(*) from dulabs_registros_modulo where tenant_id = '$T' and flow_execution_id = '00000000-0000-4000-9000-000000000001'")
[ "$N" = "1" ] || { echo "FAIL 1: filas=$N"; exit 1; }

# 2. 8 conciliadores reclaman a la vez (10 cada uno) sobre 60 filas: ninguna fila se entrega dos veces.
for i in $(seq 1 8); do
  $PSQL -qAtc "select x->>'id' from jsonb_array_elements(dulabs_registro_modulo_reclamar(10, '$T', 300)) x" >> "$SALIDA" &
done
wait
TOTAL=$(grep -c . "$SALIDA" || true)
UNICOS=$(sort -u "$SALIDA" | grep -c . || true)
rm -f "$SALIDA"
[ "$TOTAL" = "$UNICOS" ] && [ "$TOTAL" = "60" ] || { echo "FAIL 2: entregadas=$TOTAL únicas=$UNICOS"; exit 1; }

# 3. Cierres simultáneos de la misma fila: solo UNO la cambia (los terminales no se pisan).
ID=$($PSQL -qAtc "select id from dulabs_registros_modulo where tenant_id = '$T' order by id limit 1")
SAL2=$(mktemp)
for e in registrado fallido registrado fallido registrado fallido; do
  $PSQL -qAtc "select dulabs_registro_modulo_resolver('$T', $ID, '$e', '1', 'x', null)->>'actualizado'" >> "$SAL2" &
done
wait
GANA=$(grep -c '^true$' "$SAL2" || true); rm -f "$SAL2"
[ "$GANA" = "1" ] || { echo "FAIL 3: ganadores=$GANA"; exit 1; }

echo "OK — concurrencia de dulabs_registros_modulo: 3/3"
