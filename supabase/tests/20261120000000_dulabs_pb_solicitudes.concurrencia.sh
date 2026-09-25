#!/usr/bin/env bash
# Publi Bordados — CONCURRENCIA REAL del registro de solicitudes: sesiones de Postgres en paralelo.
#
# ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO con el preludio y la migración aplicados (ver la
#     cabecera de 20261120000000_dulabs_pb_solicitudes.test.sql). Tenants y números FICTICIOS.
# Uso: PSQL="psql -h /var/tmp/pgpb -p 55433 -U postgres -d pbsol" bash supabase/tests/…concurrencia.sh
set -euo pipefail
PSQL=${PSQL:?define PSQL}
T=cccccccc-0000-4000-8000-000000000003
PN=pid-sint-concurrencia

$PSQL -q -v ON_ERROR_STOP=1 <<SQL
delete from dulabs_pb_solicitudes where id_tenant = '$T';
delete from dulabs_clientes_conocidos where id_tenant = '$T';
delete from dulabs_flow_executions where tenant_id = '$T';
delete from dulabs_clientes_config where id_tenant = '$T';
insert into dulabs_clientes_config (id_tenant, phone_number_id) values ('$T', '$PN');
insert into dulabs_flow_executions (tenant_id, id, flow_id, flow_version_id, execution_id, phone_number_id, telefono_cliente, status)
select '$T', ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, gen_random_uuid(), gen_random_uuid(), 'c' || g, '$PN', '57300000' || lpad(g::text, 4, '0'), 'waiting_effect'
  from generate_series(1, 20) g;
insert into dulabs_flow_executions (tenant_id, id, flow_id, flow_version_id, execution_id, phone_number_id, telefono_cliente, status)
values ('$T', '00000000-0000-4000-8000-000000009999', gen_random_uuid(), gen_random_uuid(), 'mismo', '$PN', '573009999999', 'waiting_effect');
SQL

DATOS='{"tipo_cliente":"persona_natural","nombre":"Concurrente","producto":"gorras","cantidad":"5"}'

# 1. La MISMA ejecución registrada 15 veces a la vez (reintentos / doble despacho): UNA solicitud, UN contacto.
for i in $(seq 1 15); do
  $PSQL -qAtc "select creada from dulabs_pb_registrar_solicitud('$T', '$PN', '573009999999', '00000000-0000-4000-8000-000000009999', '$DATOS')" > /dev/null &
done
wait
N=$($PSQL -qAtc "select count(*) from dulabs_pb_solicitudes s join dulabs_clientes_conocidos c on c.id = s.contacto_id where s.id_tenant = '$T' and c.telefono_cliente = '573009999999'")
C=$($PSQL -qAtc "select count(*) from dulabs_clientes_conocidos where id_tenant = '$T' and telefono_cliente = '573009999999'")
[ "$N" = "1" ] && [ "$C" = "1" ] || { echo "FAIL 1: solicitudes=$N contactos=$C"; exit 1; }

# 2. El MISMO cliente con 20 ejecuciones distintas en paralelo sobre un solo teléfono: 20 solicitudes, 1 contacto.
$PSQL -q -v ON_ERROR_STOP=1 -c "update dulabs_flow_executions set telefono_cliente = '573008888888' where tenant_id = '$T' and execution_id like 'c%'"
for g in $(seq 1 20); do
  ID="00000000-0000-4000-8000-$(printf '%012d' "$g")"
  $PSQL -qAtc "select creada from dulabs_pb_registrar_solicitud('$T', '$PN', '573008888888', '$ID', '$DATOS')" > /dev/null &
done
wait
N=$($PSQL -qAtc "select count(*) from dulabs_pb_solicitudes s join dulabs_clientes_conocidos c on c.id = s.contacto_id where s.id_tenant = '$T' and c.telefono_cliente = '573008888888'")
C=$($PSQL -qAtc "select count(*) from dulabs_clientes_conocidos where id_tenant = '$T' and telefono_cliente = '573008888888'")
[ "$N" = "20" ] && [ "$C" = "1" ] || { echo "FAIL 2: solicitudes=$N contactos=$C"; exit 1; }

# 3. Dos asesoras cambian la MISMA solicitud a la vez con la misma versión: exactamente una gana.
SID=$($PSQL -qAtc "select id from dulabs_pb_solicitudes where id_tenant = '$T' order by id limit 1")
OK=0
for e in en_atencion atendido en_atencion atendido en_atencion atendido; do
  $PSQL -qAtc "select dulabs_pb_actualizar_solicitud('$T', $SID, 1, '{\"estado\":\"$e\"}')->>'resultado'" >> /tmp/pb_conc_$$ &
done
wait
OK=$(grep -c '^ok$' /tmp/pb_conc_$$ || true); rm -f /tmp/pb_conc_$$
V=$($PSQL -qAtc "select version from dulabs_pb_solicitudes where id = $SID")
[ "$OK" = "1" ] && [ "$V" = "2" ] || { echo "FAIL 3: ganadores=$OK version=$V"; exit 1; }

echo "OK — concurrencia de dulabs_pb_solicitudes: 3/3"
