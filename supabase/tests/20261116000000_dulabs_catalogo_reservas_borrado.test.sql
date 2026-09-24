-- Bloque 22 — reserva de stock y productos BORRADOS físicamente (DELETE desde el SQL Editor, como
-- se hizo con los productos sin precio de Delacour), sobre 20261116000000_dulabs_catalogo_reservas_stock.sql.
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba; negocios FICTICIOS). Misma
-- preparación que supabase/tests/20261116000000_dulabs_catalogo_reservas_stock.test.sql.

\set ON_ERROR_STOP 1

create or replace function pg_temp.pedido(p_tenant uuid, p_publico text, p_lineas jsonb) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.dulabs_catalogo_pedido_crear(
    jsonb_build_object('id_tenant', p_tenant, 'pedido_publico', p_publico, 'canal', 'retail', 'origen', 'agent',
      'estado', 'pending_confirmation', 'clave_idempotencia', 'clave-' || p_publico,
      'contacto_phone_number_id', 'PN-1', 'contacto_wa_id', '573001112233', 'lineas', p_lineas),
    jsonb_build_object('event_id', 'evt_' || left(md5(p_publico), 26), 'tipo', 'order.created', 'payload', '{}'::jsonb));
  return (r -> 'pedido' ->> 'id')::uuid;
end $$;

create or replace function pg_temp.mover(p_tenant uuid, p_id uuid, p_desde text, p_hacia text, p_actor text) returns jsonb language sql as $$
  select public.dulabs_catalogo_pedido_transicion(p_tenant, p_id, p_desde, p_hacia, p_actor, '{}'::jsonb, null)
$$;

create or replace function pg_temp.linea(p_ref text, p_q integer) returns jsonb language sql as $$
  select jsonb_build_object('reference', p_ref, 'product_name', p_ref, 'quantity', p_q, 'unit_price', 1000, 'subtotal', 1000 * p_q)
$$;

do $$
declare
  a constant uuid := gen_random_uuid();  -- negocio ficticio nuevo en cada corrida (repetible)
  borrar text;
  seguir text;
  reservado text;
  o1 uuid; o2 uuid;
  v_detail text;
  n integer;
begin
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values
    (a, 'Aretes que se borran', 1000, 5, true, true),
    (a, 'Aretes que siguen', 1000, 5, true, true),
    (a, 'Anillo reservado y luego borrado', 1000, 5, true, true);
  select referencia into borrar from public.dulabs_inventario_productos where id_tenant = a and nombre = 'Aretes que se borran';
  select referencia into seguir from public.dulabs_inventario_productos where id_tenant = a and nombre = 'Aretes que siguen';
  select referencia into reservado from public.dulabs_inventario_productos where id_tenant = a and nombre = 'Anillo reservado y luego borrado';

  -- 1. Propuesto con un producto que se BORRA antes del "sí": no se confirma (CT011, todo o nada);
  --    el otro producto del mismo pedido NO queda apartado a medias.
  o1 := pg_temp.pedido(a, 'DL-ORD-BRRD01', jsonb_build_array(pg_temp.linea(borrar, 1), pg_temp.linea(seguir, 2)));
  delete from public.dulabs_inventario_productos where id_tenant = a and referencia = borrar;
  begin
    perform pg_temp.mover(a, o1, 'pending_confirmation', 'confirmed', 'agent');
    raise exception 'FAIL 1a se confirmó con un producto borrado';
  exception when sqlstate 'CT011' then
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  if v_detail::jsonb <> to_jsonb(array[borrar]) then raise exception 'FAIL 1b detalle %', v_detail; end if;
  if (select stock from public.dulabs_inventario_productos where id_tenant = a and referencia = seguir) <> 5 then raise exception 'FAIL 1c apartó a medias'; end if;
  if exists (select 1 from public.dulabs_catalogo_reservas where pedido_id = o1) then raise exception 'FAIL 1d reserva parcial'; end if;
  if (select estado from public.dulabs_catalogo_pedidos where id = o1) <> 'pending_confirmation' then raise exception 'FAIL 1e estado'; end if;
  raise notice 'PASS 1 producto borrado antes del sí: no se confirma y no se aparta nada';

  -- 2. Confirmado (stock apartado) y el producto se BORRA después: cancelar no falla, libera la
  --    reserva y no "resucita" el producto.
  o2 := pg_temp.pedido(a, 'DL-ORD-BRRD02', jsonb_build_array(pg_temp.linea(reservado, 2)));
  perform pg_temp.mover(a, o2, 'pending_confirmation', 'confirmed', 'agent');
  if (select stock from public.dulabs_inventario_productos where id_tenant = a and referencia = reservado) <> 3 then raise exception 'FAIL 2a no apartó'; end if;
  delete from public.dulabs_inventario_productos where id_tenant = a and referencia = reservado;
  perform pg_temp.mover(a, o2, 'confirmed', 'cancelled', 'human');
  if (select estado from public.dulabs_catalogo_reservas where pedido_id = o2) <> 'liberada' then raise exception 'FAIL 2b reserva sigue activa'; end if;
  select count(*) into n from public.dulabs_inventario_productos where id_tenant = a and referencia = reservado;
  if n <> 0 then raise exception 'FAIL 2c el producto reapareció'; end if;
  raise notice 'PASS 2 reservado y luego borrado: cancelar libera sin errores ni productos fantasma';

  -- Sin limpieza de pedidos: su historial de eventos es inmutable por diseño (negocio ficticio propio).
end;
$$;
