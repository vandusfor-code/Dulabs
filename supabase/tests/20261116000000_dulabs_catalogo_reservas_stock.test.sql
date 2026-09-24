-- Bloque 19 — verificación de 20261116000000_dulabs_catalogo_reservas_stock.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba; negocios FICTICIOS).
-- Preparación: roles service_role/anon/authenticated, esquema storage con storage.buckets, y:
--   \i supabase/migrations/20260923000000_amore_inventario_productos.sql   (tabla física de productos)
--   \i supabase/migrations/20261105000000_dulabs_catalogo_fase1.sql
--   \i supabase/migrations/20261108000000_dulabs_catalogo_pedidos.sql
--   \i supabase/migrations/20261116000000_dulabs_catalogo_reservas_stock.sql   (dos veces: idempotente)
--   \i supabase/tests/20261116000000_dulabs_catalogo_reservas_stock.test.sql
-- La concurrencia real (sesiones paralelas) está en 20261116000000_dulabs_catalogo_reservas_stock.concurrencia.sh.

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

create or replace function pg_temp.mover(p_tenant uuid, p_id uuid, p_desde text, p_hacia text, p_actor text, p_cambios jsonb default '{}') returns jsonb language sql as $$
  select public.dulabs_catalogo_pedido_transicion(p_tenant, p_id, p_desde, p_hacia, p_actor, p_cambios, null)
$$;

create or replace function pg_temp.stock(p_tenant uuid, p_ref text) returns integer language sql as $$
  select stock from public.dulabs_inventario_productos where id_tenant = p_tenant and referencia = p_ref
$$;

create or replace function pg_temp.linea(p_ref text, p_q integer) returns jsonb language sql as $$
  select jsonb_build_object('reference', p_ref, 'product_name', p_ref, 'quantity', p_q, 'unit_price', 1000, 'subtotal', 1000 * p_q)
$$;

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; o7 uuid;
  r record;
  v_err text;
  v_detail text;
begin
  -- Productos FICTICIOS (la referencia la asigna el trigger en orden: DL-000001, DL-000002…).
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values
    (a, 'Anillo luna', 1000, 5, true, true),     -- DL-000001
    (a, 'Aretes sol', 1000, 1, true, true),      -- DL-000002
    (a, 'Dije sin inventario', 1000, 0, false, true), -- DL-000003
    (a, 'Pulsera retirada', 1000, 9, true, false);    -- DL-000004
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values
    (b, 'Anillo de OTRO negocio', 1000, 100, true, true); -- también DL-000001, de B

  -- 1. Confirmar aparta las unidades (solo de ESTE negocio, solo con inventario controlado).
  o1 := pg_temp.pedido(a, 'DL-ORD-AAAAA1', jsonb_build_array(pg_temp.linea('DL-000001', 2), pg_temp.linea('DL-000003', 3)));
  perform pg_temp.mover(a, o1, 'pending_confirmation', 'confirmed', 'agent');
  if pg_temp.stock(a, 'DL-000001') <> 3 then raise exception 'FAIL 1a stock %', pg_temp.stock(a, 'DL-000001'); end if;
  if pg_temp.stock(a, 'DL-000003') <> 0 then raise exception 'FAIL 1b sin inventario tocado'; end if;
  if pg_temp.stock(b, 'DL-000001') <> 100 then raise exception 'FAIL 1c otro negocio tocado'; end if;
  select * into r from public.dulabs_catalogo_reservas where pedido_id = o1;
  if r.referencia <> 'DL-000001' or r.cantidad <> 2 or r.estado <> 'activa' or r.vence_at < now() + interval '71 hours' then raise exception 'FAIL 1d %', row_to_json(r); end if;
  if (select count(*) from public.dulabs_catalogo_reservas where pedido_id = o1) <> 1 then raise exception 'FAIL 1e'; end if;
  if not exists (select 1 from public.dulabs_catalogo_eventos where referencia = 'DL-000001' and cambios ? 'stock' and actor_user_id is null) then
    raise exception 'FAIL 1f el cambio de stock no quedó en la auditoría del catálogo';
  end if;
  raise notice 'PASS 1 confirmar aparta el stock (mismo negocio, inventario controlado, auditado)';

  -- 2. Idempotencia: reconfirmar no descuenta de nuevo; handoff mantiene; volver a confirmed tampoco descuenta.
  if pg_temp.mover(a, o1, 'pending_confirmation', 'confirmed', 'agent') is not null then raise exception 'FAIL 2a'; end if;
  perform pg_temp.mover(a, o1, 'confirmed', 'handoff', 'agent');
  if pg_temp.stock(a, 'DL-000001') <> 3 then raise exception 'FAIL 2b handoff cambió el stock'; end if;
  perform pg_temp.mover(a, o1, 'handoff', 'confirmed', 'human');
  if pg_temp.stock(a, 'DL-000001') <> 3 or (select count(*) from public.dulabs_catalogo_reservas where pedido_id = o1 and estado = 'activa') <> 1 then
    raise exception 'FAIL 2c doble descuento %', pg_temp.stock(a, 'DL-000001');
  end if;
  raise notice 'PASS 2 idempotente (reconfirmar / handoff / volver a confirmar)';

  -- 3. Todo o nada: si una línea no alcanza, NADA cambia (ni el estado ni otras líneas).
  o2 := pg_temp.pedido(a, 'DL-ORD-AAAAA2', jsonb_build_array(pg_temp.linea('DL-000001', 1), pg_temp.linea('DL-000002', 2)));
  begin
    perform pg_temp.mover(a, o2, 'pending_confirmation', 'confirmed', 'agent');
    raise exception 'FAIL 3a confirmó sin stock';
  exception when sqlstate 'CT010' then
    get stacked diagnostics v_err = message_text, v_detail = pg_exception_detail;
  end;
  if v_err <> 'stock_insuficiente' or (v_detail::jsonb -> 0 ->> 'referencia') <> 'DL-000002' or (v_detail::jsonb -> 0 ->> 'disponible')::int <> 1 or (v_detail::jsonb -> 0 ->> 'pedido')::int <> 2 then
    raise exception 'FAIL 3b detalle %', v_detail;
  end if;
  if pg_temp.stock(a, 'DL-000001') <> 3 or pg_temp.stock(a, 'DL-000002') <> 1 then raise exception 'FAIL 3c stock movido'; end if;
  if (select estado from public.dulabs_catalogo_pedidos where id = o2) <> 'pending_confirmation' then raise exception 'FAIL 3d estado'; end if;
  if exists (select 1 from public.dulabs_catalogo_reservas where pedido_id = o2) then raise exception 'FAIL 3e reserva parcial'; end if;
  raise notice 'PASS 3 todo o nada con el detalle de lo que falta';

  -- 4. Producto retirado o inexistente => CT011, nada cambia.
  o3 := pg_temp.pedido(a, 'DL-ORD-AAAAA3', jsonb_build_array(pg_temp.linea('DL-000004', 1)));
  begin
    perform pg_temp.mover(a, o3, 'pending_confirmation', 'confirmed', 'agent');
    raise exception 'FAIL 4a';
  exception when sqlstate 'CT011' then
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  if v_detail::jsonb <> '["DL-000004"]'::jsonb or pg_temp.stock(a, 'DL-000004') <> 9 then raise exception 'FAIL 4b %', v_detail; end if;
  raise notice 'PASS 4 producto no vendible';

  -- 5. Cancelar devuelve el stock (una sola vez).
  perform pg_temp.mover(a, o1, 'confirmed', 'cancelled', 'human');
  if pg_temp.stock(a, 'DL-000001') <> 5 then raise exception 'FAIL 5a %', pg_temp.stock(a, 'DL-000001'); end if;
  select * into r from public.dulabs_catalogo_reservas where pedido_id = o1;
  if r.estado <> 'liberada' or r.motivo <> 'cancelled' or r.cerrada_at is null then raise exception 'FAIL 5b %', row_to_json(r); end if;
  if pg_temp.mover(a, o1, 'confirmed', 'cancelled', 'human') is not null or pg_temp.stock(a, 'DL-000001') <> 5 then raise exception 'FAIL 5c doble devolución'; end if;
  raise notice 'PASS 5 cancelar devuelve el stock una sola vez';

  -- 6. Completar consume la reserva (el stock NO vuelve).
  o4 := pg_temp.pedido(a, 'DL-ORD-AAAAA4', jsonb_build_array(pg_temp.linea('DL-000001', 1)));
  perform pg_temp.mover(a, o4, 'pending_confirmation', 'confirmed', 'agent');
  perform pg_temp.mover(a, o4, 'confirmed', 'completed', 'human');
  if pg_temp.stock(a, 'DL-000001') <> 4 or (select estado from public.dulabs_catalogo_reservas where pedido_id = o4) <> 'consumida' then raise exception 'FAIL 6'; end if;
  raise notice 'PASS 6 completar consume';

  -- 7. Vencimiento: el pedido confirmado sin cerrar pasa a expired y el stock vuelve (idempotente).
  o5 := pg_temp.pedido(a, 'DL-ORD-AAAAA5', jsonb_build_array(pg_temp.linea('DL-000001', 2)));
  perform pg_temp.mover(a, o5, 'pending_confirmation', 'confirmed', 'agent');
  o6 := pg_temp.pedido(a, 'DL-ORD-AAAAA6', jsonb_build_array(pg_temp.linea('DL-000001', 1)));
  perform pg_temp.mover(a, o6, 'pending_confirmation', 'confirmed', 'agent');
  if pg_temp.stock(a, 'DL-000001') <> 1 then raise exception 'FAIL 7a'; end if;
  update public.dulabs_catalogo_reservas set vence_at = now() - interval '1 minute' where pedido_id = o5;
  if public.dulabs_catalogo_reservas_vencer(100) <> 1 then raise exception 'FAIL 7b'; end if;
  if (select estado from public.dulabs_catalogo_pedidos where id = o5) <> 'expired' or pg_temp.stock(a, 'DL-000001') <> 3 then raise exception 'FAIL 7c'; end if;
  if (select estado from public.dulabs_catalogo_pedidos where id = o6) <> 'confirmed' then raise exception 'FAIL 7d venció uno vigente'; end if;
  if (select count(*) from public.dulabs_catalogo_pedido_eventos where pedido_id = o5 and motivo = 'reservation_expired' and estado_hacia = 'expired') <> 1 then raise exception 'FAIL 7e evento'; end if;
  if public.dulabs_catalogo_reservas_vencer(100) <> 0 or pg_temp.stock(a, 'DL-000001') <> 3 then raise exception 'FAIL 7f segunda corrida'; end if;
  raise notice 'PASS 7 vencimiento devuelve el stock (idempotente, no toca vigentes)';

  -- 8. Un pedido en manos de una asesora (handoff) NO vence solo.
  update public.dulabs_catalogo_reservas set vence_at = now() - interval '1 minute' where pedido_id = o6;
  perform pg_temp.mover(a, o6, 'confirmed', 'handoff', 'human');
  if public.dulabs_catalogo_reservas_vencer(100) <> 0 or pg_temp.stock(a, 'DL-000001') <> 3 then raise exception 'FAIL 8'; end if;
  raise notice 'PASS 8 handoff no vence solo';

  -- 9. Ajuste por cambio de líneas con reserva activa: sube (si alcanza), baja y quita.
  update public.dulabs_catalogo_pedidos set lineas = jsonb_build_array(pg_temp.linea('DL-000001', 3)) where id = o6; -- 1 -> 3
  if pg_temp.stock(a, 'DL-000001') <> 1 then raise exception 'FAIL 9a %', pg_temp.stock(a, 'DL-000001'); end if;
  update public.dulabs_catalogo_pedidos set lineas = jsonb_build_array(pg_temp.linea('DL-000001', 1)) where id = o6; -- 3 -> 1
  if pg_temp.stock(a, 'DL-000001') <> 3 then raise exception 'FAIL 9b'; end if;
  begin
    update public.dulabs_catalogo_pedidos set lineas = jsonb_build_array(pg_temp.linea('DL-000001', 10)) where id = o6;
    raise exception 'FAIL 9c';
  exception when sqlstate 'CT010' then null;
  end;
  if pg_temp.stock(a, 'DL-000001') <> 3 or (select cantidad from public.dulabs_catalogo_reservas where pedido_id = o6) <> 1 then raise exception 'FAIL 9d'; end if;
  raise notice 'PASS 9 ajuste de líneas con reserva activa';

  -- 10. El stock nunca queda negativo aunque alguien lo intente por fuera.
  begin
    update public.dulabs_inventario_productos set stock = -1 where id_tenant = a and referencia = 'DL-000001';
    raise exception 'FAIL 10';
  exception when check_violation then null;
  end;
  raise notice 'PASS 10 nunca negativo';

  -- 11. Duplicados de la misma referencia en las líneas se suman (una sola reserva).
  o7 := pg_temp.pedido(a, 'DL-ORD-AAAAA7', jsonb_build_array(pg_temp.linea('DL-000001', 1), pg_temp.linea('dl-000001', 1)));
  perform pg_temp.mover(a, o7, 'pending_confirmation', 'confirmed', 'agent');
  if pg_temp.stock(a, 'DL-000001') <> 1 or (select cantidad from public.dulabs_catalogo_reservas where pedido_id = o7) <> 2 then raise exception 'FAIL 11'; end if;
  raise notice 'PASS 11 líneas repetidas';
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.dulabs_catalogo_reservas', 'select')
     or has_table_privilege('authenticated', 'public.dulabs_catalogo_reservas', 'select')
     or has_function_privilege('anon', 'public.dulabs_catalogo_reservas_vencer(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_catalogo_reservas_ajustar(uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_catalogo_reservas_cerrar(uuid, text, text)', 'execute') then
    raise exception 'FAIL 12 anon/authenticated con acceso';
  end if;
  raise notice 'PASS 12 solo el backend (service_role)';
end;
$$;
