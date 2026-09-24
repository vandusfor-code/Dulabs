#!/usr/bin/env bash
# Bloque 19 — CONCURRENCIA REAL de la reserva de stock: sesiones de Postgres en paralelo.
#
# ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO con las migraciones del Bloque 19 aplicadas
#     (ver la cabecera de 20261116000000_dulabs_catalogo_reservas_stock.test.sql). Negocios FICTICIOS.
# Uso: PSQL="psql -h /var/tmp/pgsock -p 55432 -U postgres -d b19" bash supabase/tests/…concurrencia.sh
set -euo pipefail
PSQL=${PSQL:?define PSQL}
Q() { $PSQL -v ON_ERROR_STOP=1 -qAt "$@"; }
fail() { echo "FAIL $*"; exit 1; }

C=cccccccc-0000-4000-8000-00000000000c
D=dddddddd-0000-4000-8000-00000000000d
E=eeeeeeee-0000-4000-8000-00000000000e
Q <<SQL
delete from dulabs_catalogo_pedidos where id_tenant in ('$C','$D','$E');
delete from dulabs_inventario_productos where id_tenant in ('$C','$D','$E');
insert into dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values
  ('$C', 'Ultimas unidades', 1000, 5, true, true),
  ('$D', 'X', 1000, 100, true, true), ('$D', 'Y', 1000, 100, true, true),
  ('$E', 'Z', 1000, 10, true, true);
create or replace function public.tmp_pedido(p_tenant uuid, p_publico text, p_lineas jsonb) returns uuid language sql as \$\$
  select (public.dulabs_catalogo_pedido_crear(
    jsonb_build_object('id_tenant', p_tenant, 'pedido_publico', p_publico, 'canal', 'retail', 'origen', 'agent',
      'estado', 'pending_confirmation', 'clave_idempotencia', 'clave-' || p_publico,
      'contacto_phone_number_id', 'PN-1', 'contacto_wa_id', '573001112233', 'lineas', p_lineas),
    jsonb_build_object('event_id', 'evt_' || left(md5(p_publico), 26), 'tipo', 'order.created', 'payload', '{}'::jsonb)) -> 'pedido' ->> 'id')::uuid
\$\$;
SQL
L() { echo "jsonb_build_object('reference','$1','product_name','p','quantity',$2,'unit_price',1000,'subtotal',1000)"; }
publico() { printf 'DL-ORD-%s%05d' "$1" "$2"; }

# 1. 30 clientes confirman A LA VEZ la última unidad de un producto con stock 5.
ids=()
for i in $(seq 1 30); do ids+=("$(Q -c "select public.tmp_pedido('$C', '$(publico C "$i")', jsonb_build_array($(L DL-000001 1)))")"); done
for id in "${ids[@]}"; do
  ( $PSQL -qAt -c "select public.dulabs_catalogo_pedido_transicion('$C', '$id', 'pending_confirmation', 'confirmed', 'agent', '{}', null) is not null" >/dev/null 2>&1 && echo ok || echo no ) &
done > /tmp/b19-c1.txt
wait
ok=$(grep -c '^ok$' /tmp/b19-c1.txt || true)
[ "$ok" = 5 ] || fail "1a confirmados=$ok (esperado 5)"
[ "$(Q -c "select stock from dulabs_inventario_productos where id_tenant='$C'")" = 0 ] || fail "1b stock"
[ "$(Q -c "select count(*) from dulabs_catalogo_pedidos where id_tenant='$C' and estado='confirmed'")" = 5 ] || fail "1c pedidos"
[ "$(Q -c "select coalesce(sum(cantidad),0) from dulabs_catalogo_reservas where id_tenant='$C' and estado='activa'")" = 5 ] || fail "1d reservas"
[ "$(Q -c "select count(*) from dulabs_catalogo_pedidos where id_tenant='$C' and estado='pending_confirmation'")" = 25 ] || fail "1e los demás intactos"
echo "PASS 1 30 confirmaciones simultáneas por 5 unidades: exactamente 5, stock 0, nunca negativo"

# 2. Órdenes de líneas cruzadas (X,Y) y (Y,X) en paralelo: sin deadlocks.
ids=()
for i in $(seq 1 20); do
  if [ $((i % 2)) = 0 ]; then lin="$(L DL-000001 2), $(L DL-000002 2)"; else lin="$(L DL-000002 2), $(L DL-000001 2)"; fi
  ids+=("$(Q -c "select public.tmp_pedido('$D', '$(publico D "$i")', jsonb_build_array($lin))")")
done
for id in "${ids[@]}"; do
  ( $PSQL -qAt -c "select public.dulabs_catalogo_pedido_transicion('$D', '$id', 'pending_confirmation', 'confirmed', 'agent', '{}', null) is not null" 2>&1 ) &
done > /tmp/b19-c2.txt
wait
grep -qi deadlock /tmp/b19-c2.txt && fail "2a deadlock"
[ "$(grep -c '^t$' /tmp/b19-c2.txt)" = 20 ] || fail "2b $(sort /tmp/b19-c2.txt | uniq -c | tr '\n' ' ')"
[ "$(Q -c "select string_agg(stock::text, ',' order by referencia) from dulabs_inventario_productos where id_tenant='$D'")" = "60,60" ] || fail "2c stock"
echo "PASS 2 20 pedidos con líneas cruzadas en paralelo: sin deadlocks, stock exacto"

# 3. La MISMA confirmación enviada 10 veces a la vez (reintentos / doble clic): un solo descuento.
one=$(Q -c "select public.tmp_pedido('$E', '$(publico E 1)', jsonb_build_array($(L DL-000001 3)))")
for i in $(seq 1 10); do
  ( $PSQL -qAt -c "select public.dulabs_catalogo_pedido_transicion('$E', '$one', 'pending_confirmation', 'confirmed', 'agent', '{}', null) is not null" 2>&1 ) &
done > /tmp/b19-c3.txt
wait
[ "$(grep -c '^t$' /tmp/b19-c3.txt)" = 1 ] || fail "3a $(sort /tmp/b19-c3.txt | uniq -c | tr '\n' ' ')"
[ "$(Q -c "select stock from dulabs_inventario_productos where id_tenant='$E'")" = 7 ] || fail "3b stock"
echo "PASS 3 la misma confirmación 10 veces en paralelo: un solo descuento"

# 4. Cancelaciones y confirmaciones mezcladas en paralelo: el inventario cuadra siempre.
#    (Z: 10 iniciales; ya hay 3 apartadas por el pedido de la prueba 3.)
conf=()
for i in $(seq 2 8); do
  id=$(Q -c "select public.tmp_pedido('$E', '$(publico E "$i")', jsonb_build_array($(L DL-000001 1)))")
  Q -c "select public.dulabs_catalogo_pedido_transicion('$E', '$id', 'pending_confirmation', 'confirmed', 'agent', '{}', null)" >/dev/null
  conf+=("$id")
done
[ "$(Q -c "select stock from dulabs_inventario_productos where id_tenant='$E'")" = 0 ] || fail "4a preparación"
nuevos=()
for i in $(seq 20 34); do nuevos+=("$(Q -c "select public.tmp_pedido('$E', '$(publico E "$i")', jsonb_build_array($(L DL-000001 1)))")"); done
{
  for id in "${conf[@]}"; do ( $PSQL -qAt -c "select public.dulabs_catalogo_pedido_transicion('$E', '$id', 'confirmed', 'cancelled', 'human', '{}', null) is not null" >/dev/null 2>&1 ) & done
  for id in "${nuevos[@]}"; do ( $PSQL -qAt -c "select public.dulabs_catalogo_pedido_transicion('$E', '$id', 'pending_confirmation', 'confirmed', 'agent', '{}', null) is not null" >/dev/null 2>&1 ) & done
  wait
}
cuadre=$(Q -c "select p.stock + coalesce(sum(r.cantidad) filter (where r.estado in ('activa','consumida')), 0)
                 from dulabs_inventario_productos p left join dulabs_catalogo_reservas r on r.producto_id = p.id
                where p.id_tenant='$E' group by p.stock")
[ "$cuadre" = 10 ] || fail "4b stock + apartado = $cuadre (esperado 10)"
activas=$(Q -c "select coalesce(sum(cantidad),0) from dulabs_catalogo_reservas where id_tenant='$E' and estado='activa'")
confirmados=$(Q -c "select coalesce(sum((l->>'quantity')::int),0) from dulabs_catalogo_pedidos p, jsonb_array_elements(p.lineas) l where p.id_tenant='$E' and p.estado='confirmed'")
[ "$activas" = "$confirmados" ] || fail "4c reservas activas=$activas vs unidades confirmadas=$confirmados"
[ "$(Q -c "select min(stock) from dulabs_inventario_productos where id_tenant in ('$C','$D','$E')")" -ge 0 ] || fail "4d negativo"
echo "PASS 4 cancelaciones y confirmaciones en paralelo: stock + apartado = 10 y cada confirmado tiene su reserva"

Q -c "drop function public.tmp_pedido(uuid, text, jsonb)"
echo "OK concurrencia"
