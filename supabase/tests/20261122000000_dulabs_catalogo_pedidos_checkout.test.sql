-- Bloque 27 — verificación de 20261122000000_dulabs_catalogo_pedidos_checkout.sql
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO con las migraciones del catálogo aplicadas
--     (ver 20261116000000_dulabs_catalogo_reservas_stock.test.sql). Negocios y datos FICTICIOS.
--   \i supabase/migrations/20261122000000_dulabs_catalogo_pedidos_checkout.sql   (dos veces: idempotente)
--   \i supabase/tests/20261122000000_dulabs_catalogo_pedidos_checkout.test.sql
\set ON_ERROR_STOP 1

create or replace function pg_temp.pedido(p_tenant uuid, p_publico text, p_lineas jsonb) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.dulabs_catalogo_pedido_crear(
    jsonb_build_object('id_tenant', p_tenant, 'pedido_publico', p_publico, 'canal', 'retail', 'origen', 'agent',
      'estado', 'pending_confirmation', 'clave_idempotencia', 'clave-' || p_publico || '-' || p_tenant,
      'contacto_phone_number_id', 'PN-27', 'contacto_wa_id', '573001112233', 'lineas', p_lineas,
      'total', (select coalesce(sum((l->>'subtotal')::bigint), 0) from jsonb_array_elements(p_lineas) l)),
    jsonb_build_object('event_id', 'evt_' || left(md5(p_publico || p_tenant::text), 26), 'tipo', 'order.created', 'payload', '{}'::jsonb));
  return (r -> 'pedido' ->> 'id')::uuid;
end $$;

create or replace function pg_temp.mover(p_tenant uuid, p_id uuid, p_desde text, p_hacia text, p_actor text, p_cambios jsonb default '{}', p_miembro bigint default null) returns jsonb language sql as $$
  select public.dulabs_catalogo_pedido_transicion(p_tenant, p_id, p_desde, p_hacia, p_actor, p_cambios,
    jsonb_build_object('event_id', 'evt_' || left(md5(random()::text), 26), 'tipo', 'order.status_changed', 'motivo', 'prueba', 'payload', '{}'::jsonb, 'miembro_id', p_miembro))
$$;

create or replace function pg_temp.checkout(p_entrega text, p_pago text) returns jsonb language sql as $$
  select jsonb_build_object('checkout', true, 'cliente_nombre', 'Laura Prueba', 'metodo_pago', p_pago, 'estado_pago', 'pendiente',
    'tipo_entrega', p_entrega, 'etapa', 'confirmado', 'confirmado_at', now()::text)
    || case when p_entrega = 'domicilio' then jsonb_build_object('direccion', 'Calle 1 # 2-3', 'ciudad', 'Montería', 'referencia_entrega', 'Portón azul') else '{}'::jsonb end
$$;

create or replace function pg_temp.stock(p_tenant uuid, p_ref text) returns integer language sql as $$
  select stock from public.dulabs_inventario_productos where id_tenant = p_tenant and referencia = p_ref
$$;

create or replace function pg_temp.linea(p_ref text, p_q integer) returns jsonb language sql as $$
  select jsonb_build_object('reference', p_ref, 'product_name', p_ref, 'quantity', p_q, 'unit_price', 1000, 'subtotal', 1000 * p_q)
$$;

create or replace function pg_temp.etapa(p_tenant uuid, p_publico text, p_desde text, p_hacia text, p_miembro bigint default 7) returns jsonb language sql as $$
  select public.dulabs_catalogo_pedido_etapa(p_tenant, p_publico, p_desde, p_hacia, p_miembro, 'prueba', 'evt_' || left(md5(random()::text), 26))
$$;

create or replace function pg_temp.pago(p_tenant uuid, p_publico text, p_miembro bigint default 7) returns jsonb language sql as $$
  select public.dulabs_catalogo_pedido_pago(p_tenant, p_publico, p_miembro, 'transferencia verificada', 'evt_' || left(md5(random()::text), 26))
$$;

do $$
declare
  a constant uuid := gen_random_uuid();
  b constant uuid := gen_random_uuid();
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; o7 uuid; o8 uuid; o9 uuid;
  r jsonb;
  n integer;
begin
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values
    (a, 'Dije corazón', 1000, 10, true, true),  -- DL-000001
    (a, 'Aretes luna', 1000, 10, true, true);   -- DL-000002
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values
    (b, 'Anillo de OTRO negocio', 1000, 10, true, true);

  -- 1. Confirmar con checkout: aparta stock, guarda los datos; CONFIRMADO con el pago PENDIENTE.
  o1 := pg_temp.pedido(a, 'DL-ORD-CK0001', jsonb_build_array(pg_temp.linea('DL-000001', 2)));
  r := pg_temp.mover(a, o1, 'pending_confirmation', 'confirmed', 'agent', pg_temp.checkout('domicilio', 'transferencia'));
  if r->>'etapa' <> 'confirmado' or r->>'estado_pago' <> 'pendiente' or r->>'ciudad' <> 'Montería' or (r->>'checkout')::boolean is not true then raise exception 'FAIL 1a %', r; end if;
  if pg_temp.stock(a, 'DL-000001') <> 8 then raise exception 'FAIL 1b stock %', pg_temp.stock(a, 'DL-000001'); end if;
  raise notice 'PASS 1 confirmar con checkout: datos + reserva + confirmado con pago pendiente';

  -- 2. Reglas de datos: domicilio sin dirección / checkout incompleto => rechazado por la BD.
  o2 := pg_temp.pedido(a, 'DL-ORD-CK0002', jsonb_build_array(pg_temp.linea('DL-000002', 1)));
  begin
    perform pg_temp.mover(a, o2, 'pending_confirmation', 'confirmed', 'agent', pg_temp.checkout('tienda', 'pago_en_tienda') || jsonb_build_object('tipo_entrega', 'domicilio'));
    raise exception 'FAIL 2a domicilio sin dirección';
  exception when check_violation then null; end;
  begin
    perform pg_temp.mover(a, o2, 'pending_confirmation', 'confirmed', 'agent', jsonb_build_object('checkout', true, 'cliente_nombre', 'X'));
    raise exception 'FAIL 2b checkout incompleto';
  exception when check_violation then null; end;
  if pg_temp.stock(a, 'DL-000002') <> 10 then raise exception 'FAIL 2c un intento rechazado tocó el stock'; end if;
  raise notice 'PASS 2 la BD rechaza datos de checkout incompletos (sin tocar stock)';

  -- 3. Etapas: solo hacia adelante, de a un paso, con compare-and-set e idempotencia; pago aparte.
  begin
    r := pg_temp.etapa(a, 'DL-ORD-CK0001', 'confirmado', 'enviado');
    raise exception 'FAIL 3a salto de etapa %', r;
  exception when invalid_parameter_value then null; end;
  r := pg_temp.etapa(a, 'DL-ORD-CK0001', 'en_preparacion', 'enviado');
  if r->>'resultado' <> 'conflicto' then raise exception 'FAIL 3a2 etapa vista vieja %', r; end if;
  begin
    update public.dulabs_catalogo_pedidos set etapa = 'entregado' where id = o1;
    raise exception 'FAIL 3b salto directo por UPDATE';
  exception when invalid_parameter_value then null; end;
  r := pg_temp.etapa(a, 'DL-ORD-CK0001', 'confirmado', 'en_preparacion');
  if r->>'resultado' <> 'ok' or r#>>'{pedido,estado_pago}' <> 'pendiente' then raise exception 'FAIL 3c la etapa tocó el pago %', r; end if;
  r := pg_temp.etapa(a, 'DL-ORD-CK0001', 'confirmado', 'en_preparacion');
  if r->>'resultado' <> 'sin_cambio' then raise exception 'FAIL 3d doble clic %', r; end if;
  select count(*) into n from public.dulabs_catalogo_pedido_eventos where pedido_id = o1 and tipo = 'order.stage_changed';
  if n <> 1 then raise exception 'FAIL 3e eventos de etapa %', n; end if;
  begin
    update public.dulabs_catalogo_pedidos set etapa = 'confirmado' where id = o1;
    raise exception 'FAIL 3f retroceso';
  exception when invalid_parameter_value then null; end;
  begin
    r := pg_temp.etapa(a, 'DL-ORD-CK0001', 'en_preparacion', 'enviado', null);
    raise exception 'FAIL 3g sin miembro';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS 3 etapas: adelante, de a uno, CAS, idempotente, con miembro, sin tocar el pago';

  -- 4. Pago: independiente de la etapa; idempotente; no vuelve atrás. Completar exige ENTREGADO + PAGO.
  perform pg_temp.etapa(a, 'DL-ORD-CK0001', 'en_preparacion', 'enviado');
  perform pg_temp.etapa(a, 'DL-ORD-CK0001', 'enviado', 'entregado');
  begin
    perform pg_temp.mover(a, o1, 'confirmed', 'completed', 'human', '{}', 7);
    raise exception 'FAIL 4a completar sin pago';
  exception when invalid_parameter_value then null; end;
  r := pg_temp.pago(a, 'DL-ORD-CK0001');
  if r->>'resultado' <> 'ok' or r#>>'{pedido,estado_pago}' <> 'recibido' or r#>>'{pedido,etapa}' <> 'entregado' then raise exception 'FAIL 4b %', r; end if;
  if pg_temp.pago(a, 'DL-ORD-CK0001')->>'resultado' <> 'sin_cambio' then raise exception 'FAIL 4c pago dos veces'; end if;
  if (select count(*) from public.dulabs_catalogo_pedido_eventos where pedido_id = o1 and tipo = 'order.payment_changed' and miembro_id = 7) <> 1 then raise exception 'FAIL 4d evento de pago'; end if;
  begin
    update public.dulabs_catalogo_pedidos set estado_pago = 'pendiente' where id = o1;
    raise exception 'FAIL 4e pago hacia atrás';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.dulabs_catalogo_pedido_pago(a, 'DL-ORD-CK0001', null, 'x', 'evt_' || left(md5(random()::text), 26));
    raise exception 'FAIL 4f pago sin miembro';
  exception when insufficient_privilege then null; end;
  r := pg_temp.mover(a, o1, 'confirmed', 'completed', 'human', '{}', 7);
  if r->>'estado' <> 'completed' then raise exception 'FAIL 4g'; end if;
  if pg_temp.mover(a, o1, 'confirmed', 'completed', 'human', '{}', 7) is not null then raise exception 'FAIL 4h completar dos veces'; end if;
  if pg_temp.stock(a, 'DL-000001') <> 8 then raise exception 'FAIL 4i stock %', pg_temp.stock(a, 'DL-000001'); end if;
  if (select estado from public.dulabs_catalogo_reservas where pedido_id = o1) <> 'consumida' then raise exception 'FAIL 4j'; end if;
  if (select miembro_id from public.dulabs_catalogo_pedido_eventos where pedido_id = o1 and estado_hacia = 'completed') <> 7 then raise exception 'FAIL 4k miembro'; end if;
  raise notice 'PASS 4 pago independiente; completar = entregado + pagado; consume la reserva una vez';

  -- 5. Recoger en tienda: "enviado" imposible; entregado desde preparación; el pago puede llegar al final.
  o3 := pg_temp.pedido(a, 'DL-ORD-CK0003', jsonb_build_array(pg_temp.linea('DL-000002', 1)));
  perform pg_temp.mover(a, o3, 'pending_confirmation', 'confirmed', 'agent', pg_temp.checkout('tienda', 'pago_en_tienda'));
  perform pg_temp.etapa(a, 'DL-ORD-CK0003', 'confirmado', 'en_preparacion');
  begin
    r := pg_temp.etapa(a, 'DL-ORD-CK0003', 'en_preparacion', 'enviado');
    raise exception 'FAIL 5a enviado en recoger';
  exception when check_violation or invalid_parameter_value then null; end;
  r := pg_temp.etapa(a, 'DL-ORD-CK0003', 'en_preparacion', 'entregado');
  if r->>'resultado' <> 'ok' then raise exception 'FAIL 5b %', r; end if;
  perform pg_temp.pago(a, 'DL-ORD-CK0003');
  r := pg_temp.mover(a, o3, 'confirmed', 'completed', 'human', '{}', 7);
  if r->>'estado' <> 'completed' then raise exception 'FAIL 5c'; end if;
  -- Domicilio: no se entrega sin haber salido.
  o8 := pg_temp.pedido(a, 'DL-ORD-CK0008', jsonb_build_array(pg_temp.linea('DL-000002', 1)));
  perform pg_temp.mover(a, o8, 'pending_confirmation', 'confirmed', 'agent', pg_temp.checkout('domicilio', 'transferencia'));
  perform pg_temp.etapa(a, 'DL-ORD-CK0008', 'confirmado', 'en_preparacion');
  begin
    r := pg_temp.etapa(a, 'DL-ORD-CK0008', 'en_preparacion', 'entregado');
    raise exception 'FAIL 5d domicilio entregado sin enviar';
  exception when invalid_parameter_value then null; end;
  raise notice 'PASS 5 recoger en tienda sin enviado; domicilio pasa por enviado';

  -- 6. Rechazar libera la reserva (motivo propio) y es terminal; tras salir no se cancela ni rechaza.
  o4 := pg_temp.pedido(a, 'DL-ORD-CK0004', jsonb_build_array(pg_temp.linea('DL-000002', 3)));
  perform pg_temp.mover(a, o4, 'pending_confirmation', 'confirmed', 'agent', pg_temp.checkout('tienda', 'transferencia'));
  n := pg_temp.stock(a, 'DL-000002');
  perform pg_temp.mover(a, o4, 'confirmed', 'rejected', 'human', '{}', 9);
  if pg_temp.stock(a, 'DL-000002') <> n + 3 then raise exception 'FAIL 6a stock no volvió'; end if;
  if (select motivo from public.dulabs_catalogo_reservas where pedido_id = o4) <> 'rejected' then raise exception 'FAIL 6b'; end if;
  begin
    perform pg_temp.mover(a, o4, 'rejected', 'confirmed', 'human');
    raise exception 'FAIL 6c salió de rechazado';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.etapa(a, 'DL-ORD-CK0008', 'en_preparacion', 'enviado');
  n := pg_temp.stock(a, 'DL-000002');
  begin
    perform pg_temp.mover(a, o8, 'confirmed', 'cancelled', 'human', '{}', 9);
    raise exception 'FAIL 6d canceló un pedido enviado';
  exception when invalid_parameter_value then null; end;
  begin
    perform pg_temp.mover(a, o8, 'confirmed', 'rejected', 'human', '{}', 9);
    raise exception 'FAIL 6e rechazó un pedido enviado';
  exception when invalid_parameter_value then null; end;
  if pg_temp.stock(a, 'DL-000002') <> n then raise exception 'FAIL 6f el stock cambió'; end if;
  raise notice 'PASS 6 rechazar libera y es terminal; enviado no se cancela ni se rechaza';

  -- 7. Confirmado = inmutable (productos, total, datos del checkout, modalidad).
  o5 := pg_temp.pedido(a, 'DL-ORD-CK0005', jsonb_build_array(pg_temp.linea('DL-000002', 1)));
  perform pg_temp.mover(a, o5, 'pending_confirmation', 'confirmed', 'agent', pg_temp.checkout('domicilio', 'transferencia'));
  begin
    update public.dulabs_catalogo_pedidos set total = 1 where id = o5;
    raise exception 'FAIL 7a precio editado';
  exception when insufficient_privilege then null; end;
  begin
    update public.dulabs_catalogo_pedidos set direccion = 'otra' where id = o5;
    raise exception 'FAIL 7b dirección editada';
  exception when insufficient_privilege then null; end;
  begin
    update public.dulabs_catalogo_pedidos set canal = 'wholesale' where id = o5;
    raise exception 'FAIL 7c modalidad editada';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS 7 pedido confirmado inmutable';

  -- 8. Vencimiento 72 h: SOLO lo que nadie tocó (confirmado + pago pendiente).
  o6 := pg_temp.pedido(a, 'DL-ORD-CK0006', jsonb_build_array(pg_temp.linea('DL-000001', 1)));
  perform pg_temp.mover(a, o6, 'pending_confirmation', 'confirmed', 'agent', pg_temp.checkout('tienda', 'transferencia'));
  perform pg_temp.pago(a, 'DL-ORD-CK0006');
  o9 := pg_temp.pedido(a, 'DL-ORD-CK0009', jsonb_build_array(pg_temp.linea('DL-000001', 1)));
  perform pg_temp.mover(a, o9, 'pending_confirmation', 'confirmed', 'agent', pg_temp.checkout('tienda', 'pago_en_tienda'));
  perform pg_temp.etapa(a, 'DL-ORD-CK0009', 'confirmado', 'en_preparacion');
  update public.dulabs_catalogo_reservas set vence_at = now() - interval '1 minute' where pedido_id in (o5, o6, o9);
  n := pg_temp.stock(a, 'DL-000002');
  perform public.dulabs_catalogo_reservas_vencer(1000);
  if (select estado from public.dulabs_catalogo_pedidos where id = o5) <> 'expired' then raise exception 'FAIL 8a sin tocar no venció'; end if;
  if pg_temp.stock(a, 'DL-000002') <> n + 1 then raise exception 'FAIL 8b el stock no volvió'; end if;
  if (select estado from public.dulabs_catalogo_pedidos where id = o6) <> 'confirmed' then raise exception 'FAIL 8c pagado venció'; end if;
  if (select estado from public.dulabs_catalogo_pedidos where id = o9) <> 'confirmed' then raise exception 'FAIL 8d en preparación venció'; end if;
  perform public.dulabs_catalogo_reservas_vencer(1000);
  if pg_temp.stock(a, 'DL-000002') <> n + 1 then raise exception 'FAIL 8e vencer dos veces devolvió el stock dos veces'; end if;
  raise notice 'PASS 8 vencimiento: solo lo no tocado; el stock vuelve una vez';

  -- 9. Aislamiento: otro negocio no ve ni mueve la etapa ni el pago.
  r := public.dulabs_catalogo_pedido_etapa(b, 'DL-ORD-CK0009', 'en_preparacion', 'entregado', 7, 'x', 'evt_' || left(md5(random()::text), 26));
  if r->>'resultado' <> 'no_encontrado' then raise exception 'FAIL 9a %', r; end if;
  if pg_temp.pago(b, 'DL-ORD-CK0009')->>'resultado' <> 'no_encontrado' then raise exception 'FAIL 9b'; end if;
  if pg_temp.mover(b, o9, 'confirmed', 'rejected', 'human') is not null then raise exception 'FAIL 9c'; end if;
  raise notice 'PASS 9 aislamiento entre negocios';

  -- 10. Propuesta cancelada por el sistema (el cliente cancela el checkout): sin tocar stock.
  o7 := pg_temp.pedido(a, 'DL-ORD-CK0007', jsonb_build_array(pg_temp.linea('DL-000001', 1)));
  n := pg_temp.stock(a, 'DL-000001');
  r := pg_temp.mover(a, o7, 'pending_confirmation', 'cancelled', 'system');
  if r->>'estado' <> 'cancelled' or pg_temp.stock(a, 'DL-000001') <> n then raise exception 'FAIL 10'; end if;
  -- El sistema NUNCA confirma por el cliente (la confirmación del checkout es de la conversación).
  begin
    perform pg_temp.mover(a, pg_temp.pedido(a, 'DL-ORD-CK0010', jsonb_build_array(pg_temp.linea('DL-000001', 1))), 'pending_confirmation', 'confirmed', 'system', pg_temp.checkout('tienda', 'transferencia'));
    raise exception 'FAIL 10b el sistema confirmó';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'PASS 10 cancelar propuesta (sistema) sin tocar stock; el sistema no confirma';

  -- 11. Historial inmutable (también con miembro_id).
  begin
    update public.dulabs_catalogo_pedido_eventos set motivo = 'x' where pedido_id = o1;
    raise exception 'FAIL 11';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS 11 historial inmutable';

  -- 12. La atención es de la conversación: un pedido del checkout nunca pasa a 'handoff'.
  begin
    perform pg_temp.mover(a, o9, 'confirmed', 'handoff', 'agent');
    raise exception 'FAIL 12 pasó a handoff';
  exception when invalid_parameter_value then null; end;
  if (select estado from public.dulabs_catalogo_pedidos where id = o9) <> 'confirmed' then raise exception 'FAIL 12b'; end if;
  raise notice 'PASS 12 un pedido del checkout no pasa a handoff (atención separada)';
end;
$$;
