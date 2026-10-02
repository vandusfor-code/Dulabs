-- Fase 3B.1 — verificación de 20261207000000_dulabs_catalogo_pedidos_aceptacion.sql (pendiente de aceptación).
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO con las migraciones del catálogo aplicadas (nunca producción).
--     Negocios y datos FICTICIOS; todo en una transacción que se revierte.
--   \i supabase/migrations/20261207000000_dulabs_catalogo_pedidos_aceptacion.sql   (dos veces: idempotente)
--   \i supabase/tests/20261207000000_dulabs_catalogo_pedidos_aceptacion.test.sql
\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.pedido(p_tenant uuid, p_publico text, p_lineas jsonb) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.dulabs_catalogo_pedido_crear(
    jsonb_build_object('id_tenant', p_tenant, 'pedido_publico', p_publico, 'canal', 'retail', 'origen', 'agent',
      'estado', 'pending_confirmation', 'clave_idempotencia', 'clave-' || p_publico || '-' || p_tenant,
      'contacto_phone_number_id', 'PN-3B', 'contacto_wa_id', '573001112233', 'lineas', p_lineas,
      'total', (select coalesce(sum((l->>'subtotal')::bigint), 0) from jsonb_array_elements(p_lineas) l)),
    jsonb_build_object('event_id', 'evt_' || left(md5(p_publico || p_tenant::text), 26), 'tipo', 'order.created', 'payload', '{}'::jsonb));
  return (r -> 'pedido' ->> 'id')::uuid;
end $$;

create or replace function pg_temp.mover(p_tenant uuid, p_id uuid, p_desde text, p_hacia text, p_actor text, p_cambios jsonb default '{}', p_miembro bigint default null) returns jsonb language sql as $$
  select public.dulabs_catalogo_pedido_transicion(p_tenant, p_id, p_desde, p_hacia, p_actor, p_cambios,
    jsonb_build_object('event_id', 'evt_' || left(md5(random()::text), 26), 'tipo', 'order.status_changed', 'motivo', 'prueba', 'payload', '{}'::jsonb, 'miembro_id', p_miembro))
$$;

-- Datos del checkout para enviar a aceptación: SIN etapa, pago ni confirmado_at.
create or replace function pg_temp.aceptacion(p_entrega text) returns jsonb language sql as $$
  select jsonb_build_object('checkout', true, 'cliente_nombre', 'Laura Prueba', 'metodo_pago', 'contra_entrega', 'tipo_entrega', p_entrega,
    'telefono_contacto', '3001234567', 'departamento', 'Cundinamarca')
    || case when p_entrega = 'domicilio' then jsonb_build_object('direccion', 'Calle 1 # 2-3', 'ciudad', 'Bogotá', 'barrio', 'Chapinero')
            else jsonb_build_object('ciudad', 'Medellín', 'oficina_transportadora', 'Oficina Centro') end
$$;

create or replace function pg_temp.aceptar(p_reserva_min integer default null) returns jsonb language sql as $$
  select jsonb_build_object('etapa', 'confirmado', 'estado_pago', 'pendiente', 'confirmado_at', now()::text, 'confirmado_reserva_min', p_reserva_min)
$$;

create or replace function pg_temp.stock(p_tenant uuid, p_ref text) returns integer language sql as $$
  select stock from public.dulabs_inventario_productos where id_tenant = p_tenant and referencia = p_ref
$$;

create or replace function pg_temp.linea(p_ref text, p_q integer) returns jsonb language sql as $$
  select jsonb_build_object('reference', p_ref, 'product_name', p_ref, 'quantity', p_q, 'unit_price', 1000, 'subtotal', 1000 * p_q)
$$;

create or replace function pg_temp.vence(p_id uuid) returns timestamptz language sql as $$
  select max(vence_at) from public.dulabs_catalogo_reservas where pedido_id = p_id and estado = 'activa'
$$;

-- Texto cifrado con el formato v1 de lib/crypto.ts (valores ficticios).
create or replace function pg_temp.doc() returns jsonb language sql as $$
  select jsonb_build_object('tipo', 'cc', 'numero_cifrado', 'v1:QUJDREVGR0hJSktM:TU5PUFFSU1RVVldY:WVphYmNkZWZnaA==', 'ultimos4', '5678')
$$;

do $$
declare
  a constant uuid := gen_random_uuid();
  b constant uuid := gen_random_uuid();
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; o7 uuid; o8 uuid; o9 uuid;
  r jsonb;
  t timestamptz;
  def text;
begin
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values
    (a, 'Licuadora', 1000, 10, true, true),   -- DL-000001
    (a, 'Ventilador', 1000, 10, true, true);  -- DL-000002
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values
    (b, 'Producto de OTRO negocio', 1000, 10, true, true);

  -- 1. CHECKs: valores nuevos admitidos, los de siempre intactos, nada inventado.
  select pg_get_constraintdef(c.oid) into def from pg_constraint c where c.conrelid = 'public.dulabs_catalogo_pedidos'::regclass and c.conname = 'dulabs_catalogo_pedidos_estado_check';
  if def not like '%pending_acceptance%' or def not like '%pending_confirmation%' or def not like '%rejected%' then raise exception 'FAIL 1a estado: %', def; end if;
  select pg_get_constraintdef(c.oid) into def from pg_constraint c where c.conrelid = 'public.dulabs_catalogo_pedidos'::regclass and c.conname = 'dulabs_catalogo_pedidos_tipo_entrega_check';
  if def not like '%oficina_transportadora%' or def not like '%tienda%' or def not like '%domicilio%' then raise exception 'FAIL 1b tipo_entrega: %', def; end if;
  raise notice 'PASS 1 CHECKs: estado y entrega con los valores nuevos (superconjunto)';

  -- 2. Enviar a aceptación SIN política de reserva: no es venta y el stock no se toca.
  o1 := pg_temp.pedido(a, 'DL-ORD-AC0001', jsonb_build_array(pg_temp.linea('DL-000001', 2)));
  r := pg_temp.mover(a, o1, 'pending_confirmation', 'pending_acceptance', 'agent', pg_temp.aceptacion('domicilio'));
  if r->>'estado' <> 'pending_acceptance' or r->>'confirmado_at' is not null or r->>'etapa' is not null or r->>'estado_pago' is not null then raise exception 'FAIL 2a %', r; end if;
  if r->>'barrio' <> 'Chapinero' or r->>'telefono_contacto' <> '3001234567' then raise exception 'FAIL 2b datos nuevos %', r; end if;
  if pg_temp.stock(a, 'DL-000001') <> 10 or exists (select 1 from public.dulabs_catalogo_reservas where pedido_id = o1) then raise exception 'FAIL 2c sin política no se reserva'; end if;
  raise notice 'PASS 2 pendiente de aceptación: datos guardados, sin venta y sin reserva';

  -- 3. pending_acceptance <> confirmed: nunca confirmado_at, etapa ni estado de pago.
  begin
    update public.dulabs_catalogo_pedidos set confirmado_at = now() where id = o1;
    raise exception 'FAIL 3a confirmado_at en un pendiente';
  exception when check_violation or sqlstate '42501' or sqlstate '22023' then null; end;
  begin
    update public.dulabs_catalogo_pedidos set etapa = 'confirmado', estado_pago = 'pendiente' where id = o1;
    raise exception 'FAIL 3b etapa/pago en un pendiente';
  exception when check_violation or sqlstate '42501' or sqlstate '22023' then null; end;
  begin
    insert into public.dulabs_catalogo_pedidos (id_tenant, pedido_publico, canal, origen, estado, clave_idempotencia, contacto_phone_number_id, contacto_wa_id,
      checkout, cliente_nombre, metodo_pago, tipo_entrega, direccion, ciudad, etapa, estado_pago, confirmado_at)
    values (a, 'DL-ORD-AC0X01', 'retail', 'agent', 'pending_acceptance', 'clave-insert-directo-3c', 'PN-3B', '573001112233',
      true, 'X', 'contra_entrega', 'domicilio', 'Calle 1 # 2-3', 'Bogotá', 'confirmado', 'pendiente', now());
    raise exception 'FAIL 3c insertar un pendiente con datos de venta';
  exception when check_violation then null; end;
  raise notice 'PASS 3 la BD impide que un pendiente tenga confirmado_at, etapa o pago';

  -- 4. Datos inmutables mientras espera; el aviso y la respuesta, una sola vez.
  begin
    update public.dulabs_catalogo_pedidos set direccion = 'Otra 9 # 9-9' where id = o1;
    raise exception 'FAIL 4a editar datos de un pendiente';
  exception when sqlstate '42501' then null; end;
  begin
    perform pg_temp.mover(a, o1, 'pending_acceptance', 'pending_acceptance', 'human');
    raise exception 'FAIL 4b actualizar un pendiente por la transición';
  exception when sqlstate '22023' then null; end;
  r := public.dulabs_catalogo_pedido_aceptacion_marca(a, 'DL-ORD-AC0001', 'respuesta', 'evt_' || left(md5('r0'), 26));
  if r->>'resultado' <> 'conflicto' then raise exception 'FAIL 4c respuesta antes del aviso %', r; end if;
  r := public.dulabs_catalogo_pedido_aceptacion_marca(a, 'DL-ORD-AC0001', 'aviso', 'evt_' || left(md5('a1'), 26));
  if r->>'resultado' <> 'ok' or r->'pedido'->>'aviso_enviado_at' is null then raise exception 'FAIL 4d aviso %', r; end if;
  t := (r->'pedido'->>'aviso_enviado_at')::timestamptz;
  r := public.dulabs_catalogo_pedido_aceptacion_marca(a, 'DL-ORD-AC0001', 'aviso', 'evt_' || left(md5('a2'), 26));
  if r->>'resultado' <> 'sin_cambio' or (r->'pedido'->>'aviso_enviado_at')::timestamptz <> t then raise exception 'FAIL 4e aviso repetido %', r; end if;
  begin
    update public.dulabs_catalogo_pedidos set aviso_enviado_at = now() + interval '1 hour' where id = o1;
    raise exception 'FAIL 4f reescribir el aviso';
  exception when sqlstate '42501' then null; end;
  r := public.dulabs_catalogo_pedido_aceptacion_marca(a, 'DL-ORD-AC0001', 'respuesta', 'evt_' || left(md5('r1'), 26));
  if r->>'resultado' <> 'ok' or r->>'estado' <> 'pending_acceptance' then raise exception 'FAIL 4g respuesta %', r; end if;
  if (select count(*) from public.dulabs_catalogo_pedido_eventos where pedido_id = o1 and tipo in ('order.acceptance_notice_sent', 'order.customer_replied')) <> 2 then raise exception 'FAIL 4h eventos de aviso/respuesta'; end if;
  r := public.dulabs_catalogo_pedido_aceptacion_marca(b, 'DL-ORD-AC0001', 'aviso', 'evt_' || left(md5('b1'), 26));
  if r->>'resultado' <> 'no_encontrado' then raise exception 'FAIL 4i otro negocio marcó el pedido %', r; end if;
  raise notice 'PASS 4 inmutable mientras espera; aviso y respuesta una sola vez y solo del negocio';

  -- 5. Solo una PERSONA acepta; al aceptar empieza la venta y se aparta el stock (plazo de la plataforma).
  begin
    perform pg_temp.mover(a, o1, 'pending_acceptance', 'confirmed', 'agent', pg_temp.aceptar());
    raise exception 'FAIL 5a el agente aceptó';
  exception when sqlstate '22023' then null; end;
  begin
    perform pg_temp.mover(a, o1, 'pending_acceptance', 'confirmed', 'human', jsonb_build_object('confirmado_at', now()::text));
    raise exception 'FAIL 5b aceptar sin etapa ni pago';
  exception when sqlstate '22023' or check_violation then null; end;
  r := pg_temp.mover(a, o1, 'pending_acceptance', 'confirmed', 'human', pg_temp.aceptar(), 7);
  if r->>'estado' <> 'confirmed' or r->>'etapa' <> 'confirmado' or r->>'estado_pago' <> 'pendiente' or r->>'confirmado_at' is null then raise exception 'FAIL 5c %', r; end if;
  if pg_temp.stock(a, 'DL-000001') <> 8 then raise exception 'FAIL 5d stock %', pg_temp.stock(a, 'DL-000001'); end if;
  if abs(extract(epoch from (pg_temp.vence(o1) - (now() + public.dulabs_catalogo_reserva_ttl())))) > 5 then raise exception 'FAIL 5e plazo de la plataforma'; end if;
  raise notice 'PASS 5 aceptar (persona): confirmado, pago pendiente, reserva con el plazo de la plataforma';

  -- 6. Reserva con política explícita (nunca 72 h) y al aceptar con plazo propio, contado desde la aceptación.
  o2 := pg_temp.pedido(a, 'DL-ORD-AC0002', jsonb_build_array(pg_temp.linea('DL-000002', 3)));
  r := pg_temp.mover(a, o2, 'pending_confirmation', 'pending_acceptance', 'agent', pg_temp.aceptacion('domicilio') || jsonb_build_object('aceptacion_reserva_min', 90));
  if pg_temp.stock(a, 'DL-000002') <> 7 then raise exception 'FAIL 6a reserva explícita %', pg_temp.stock(a, 'DL-000002'); end if;
  if abs(extract(epoch from (pg_temp.vence(o2) - (now() + interval '90 minutes')))) > 5 then raise exception 'FAIL 6b plazo propio (no 72 h)'; end if;
  r := pg_temp.mover(a, o2, 'pending_acceptance', 'confirmed', 'human', pg_temp.aceptar(240), 7);
  if pg_temp.stock(a, 'DL-000002') <> 7 then raise exception 'FAIL 6c aceptar no reserva dos veces'; end if;
  if abs(extract(epoch from (pg_temp.vence(o2) - (now() + interval '240 minutes')))) > 5 then raise exception 'FAIL 6d plazo al aceptar'; end if;
  raise notice 'PASS 6 reserva solo con política explícita; al aceptar, plazo propio desde la aceptación';

  -- 7. Cerrar sin venta (persona): se libera lo apartado; el sistema no cancela un pendiente.
  o3 := pg_temp.pedido(a, 'DL-ORD-AC0003', jsonb_build_array(pg_temp.linea('DL-000002', 2)));
  perform pg_temp.mover(a, o3, 'pending_confirmation', 'pending_acceptance', 'agent', pg_temp.aceptacion('domicilio') || jsonb_build_object('aceptacion_reserva_min', 60));
  if pg_temp.stock(a, 'DL-000002') <> 5 then raise exception 'FAIL 7a %', pg_temp.stock(a, 'DL-000002'); end if;
  begin
    perform pg_temp.mover(a, o3, 'pending_acceptance', 'cancelled', 'system');
    raise exception 'FAIL 7b el sistema canceló un pendiente';
  exception when sqlstate '22023' then null; end;
  r := pg_temp.mover(a, o3, 'pending_acceptance', 'cancelled', 'human', jsonb_build_object('confirmacion', null), 7);
  if r->>'estado' <> 'cancelled' or r->>'cliente_nombre' <> 'Laura Prueba' or r->>'etapa' is not null then raise exception 'FAIL 7c %', r; end if;
  if pg_temp.stock(a, 'DL-000002') <> 7 then raise exception 'FAIL 7d el stock no volvió'; end if;
  begin
    perform pg_temp.mover(a, o3, 'pending_acceptance', 'completed', 'human');
    raise exception 'FAIL 7e completar un pendiente';
  exception when sqlstate '22023' then null; end;
  raise notice 'PASS 7 cancelar/rechazar sin venta libera el stock; el sistema no cancela; nunca "completar"';

  -- 8. Oficina de transportadora: con oficina y ciudad; la oficina solo con esa entrega.
  o4 := pg_temp.pedido(a, 'DL-ORD-AC0004', jsonb_build_array(pg_temp.linea('DL-000001', 1)));
  begin
    perform pg_temp.mover(a, o4, 'pending_confirmation', 'pending_acceptance', 'agent', pg_temp.aceptacion('oficina_transportadora') - 'oficina_transportadora');
    raise exception 'FAIL 8a oficina sin oficina';
  exception when check_violation then null; end;
  begin
    perform pg_temp.mover(a, o4, 'pending_confirmation', 'pending_acceptance', 'agent', pg_temp.aceptacion('domicilio') || jsonb_build_object('oficina_transportadora', 'Oficina Centro'));
    raise exception 'FAIL 8b oficina con domicilio';
  exception when check_violation then null; end;
  raise notice 'PASS 8 reglas de la oficina de transportadora';

  -- 9. Documento: solo cifrado, solo con oficina y en la misma transacción; inmutable; sin acceso de anon/authenticated.
  begin
    perform pg_temp.mover(a, o4, 'pending_confirmation', 'pending_acceptance', 'agent',
      pg_temp.aceptacion('oficina_transportadora') || jsonb_build_object('documento', jsonb_build_object('tipo', 'cc', 'numero_cifrado', '1020345678', 'ultimos4', '5678')));
    raise exception 'FAIL 9a documento en claro';
  exception when check_violation then null; end;
  if (select estado from public.dulabs_catalogo_pedidos where id = o4) <> 'pending_confirmation' then raise exception 'FAIL 9b el pedido cambió aunque el documento falló'; end if;
  r := pg_temp.mover(a, o4, 'pending_confirmation', 'pending_acceptance', 'agent', pg_temp.aceptacion('oficina_transportadora') || jsonb_build_object('documento', pg_temp.doc()));
  if (select ultimos4 from public.dulabs_catalogo_pedido_documentos where pedido_id = o4 and id_tenant = a) <> '5678' then raise exception 'FAIL 9c documento no guardado'; end if;
  begin
    update public.dulabs_catalogo_pedido_documentos set ultimos4 = '0000' where pedido_id = o4;
    raise exception 'FAIL 9d editar el documento';
  exception when sqlstate '42501' then null; end;
  o5 := pg_temp.pedido(a, 'DL-ORD-AC0005', jsonb_build_array(pg_temp.linea('DL-000001', 1)));
  perform pg_temp.mover(a, o5, 'pending_confirmation', 'pending_acceptance', 'agent', pg_temp.aceptacion('domicilio'));
  begin
    insert into public.dulabs_catalogo_pedido_documentos (pedido_id, id_tenant, tipo, numero_cifrado, ultimos4)
    values (o5, a, 'cc', (pg_temp.doc()->>'numero_cifrado'), '5678');
    raise exception 'FAIL 9e documento en un pedido a domicilio';
  exception when sqlstate '22023' then null; end;
  begin
    insert into public.dulabs_catalogo_pedido_documentos (pedido_id, id_tenant, tipo, numero_cifrado, ultimos4)
    values (o4, b, 'cc', (pg_temp.doc()->>'numero_cifrado'), '5678');
    raise exception 'FAIL 9f documento con el negocio de OTRO';
  exception when foreign_key_violation or unique_violation or sqlstate '22023' then null; end;
  begin
    perform pg_temp.mover(a, o5, 'pending_acceptance', 'cancelled', 'human', jsonb_build_object('documento', pg_temp.doc()));
    raise exception 'FAIL 9g documento fuera del envío a aceptación';
  exception when sqlstate '22023' then null; end;
  if has_table_privilege('anon', 'public.dulabs_catalogo_pedido_documentos', 'select') or has_table_privilege('authenticated', 'public.dulabs_catalogo_pedido_documentos', 'select') then
    raise exception 'FAIL 9h anon/authenticated pueden leer documentos';
  end if;
  raise notice 'PASS 9 documento: solo cifrado, solo oficina, atómico, inmutable y sin acceso público';

  -- 10. Vencimientos de la aceptación (solo con política): la reserva vencida libera stock sin cerrar; el vencimiento cierra.
  o6 := pg_temp.pedido(a, 'DL-ORD-AC0006', jsonb_build_array(pg_temp.linea('DL-000001', 1)));
  perform pg_temp.mover(a, o6, 'pending_confirmation', 'pending_acceptance', 'agent', pg_temp.aceptacion('domicilio') || jsonb_build_object('aceptacion_reserva_min', 30));
  o7 := pg_temp.pedido(a, 'DL-ORD-AC0007', jsonb_build_array(pg_temp.linea('DL-000001', 1)));
  perform pg_temp.mover(a, o7, 'pending_confirmation', 'pending_acceptance', 'agent', pg_temp.aceptacion('domicilio') || jsonb_build_object('aceptacion_vence_at', (now() - interval '1 minute')::text));
  update public.dulabs_catalogo_reservas set vence_at = now() - interval '1 minute' where pedido_id = o6;
  perform public.dulabs_catalogo_aceptacion_vencer(100);
  if (select estado from public.dulabs_catalogo_pedidos where id = o6) <> 'pending_acceptance' then raise exception 'FAIL 10a la reserva vencida cerró el pedido'; end if;
  if exists (select 1 from public.dulabs_catalogo_reservas where pedido_id = o6 and estado = 'activa') then raise exception 'FAIL 10b la reserva vencida sigue activa'; end if;
  if (select estado from public.dulabs_catalogo_pedidos where id = o7) <> 'expired' then raise exception 'FAIL 10c el vencimiento no cerró el pedido'; end if;
  if (select estado from public.dulabs_catalogo_pedidos where id = o5) <> 'pending_acceptance' then raise exception 'FAIL 10d venció un pedido SIN vencimiento'; end if;
  raise notice 'PASS 10 vencimientos solo con política explícita';

  -- 11. El flujo de siempre (Delacour) no cambia: confirmar directo aparta con 72 h; enviado sigue prohibido para tienda.
  o8 := pg_temp.pedido(a, 'DL-ORD-AC0008', jsonb_build_array(pg_temp.linea('DL-000002', 1)));
  r := pg_temp.mover(a, o8, 'pending_confirmation', 'confirmed', 'agent',
    jsonb_build_object('checkout', true, 'cliente_nombre', 'Ana Prueba', 'metodo_pago', 'pago_en_tienda', 'estado_pago', 'pendiente', 'tipo_entrega', 'tienda', 'etapa', 'confirmado', 'confirmado_at', now()::text));
  if r->>'estado' <> 'confirmed' or abs(extract(epoch from (pg_temp.vence(o8) - (now() + public.dulabs_catalogo_reserva_ttl())))) > 5 then raise exception 'FAIL 11a %', r; end if;
  begin
    update public.dulabs_catalogo_pedidos set etapa = 'en_preparacion' where id = o8;
    update public.dulabs_catalogo_pedidos set etapa = 'enviado' where id = o8;
    raise exception 'FAIL 11b enviado en un pedido para recoger en tienda';
  exception when sqlstate '22023' or check_violation then null; end;
  raise notice 'PASS 11 el checkout de siempre sigue igual';

  -- 12. Configuración del agente: la entrega nueva en el catálogo cerrado; lo inventado sigue rechazado.
  insert into public.dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, nivel_razonamiento, herramientas, canal, negocio)
  values (b, 'perfil-3b-prueba', 'catalog_sales', false, 'gemini', 'gemini-3.6-flash', 'env:GEMINI_KEY_PRUEBA', 'low', array['search_products'], 'retail', '{}'::jsonb);
  update public.dulabs_agente_runtime_config set checkout_opciones = '{"entregas":["domicilio","oficina_transportadora"],"pagos":[{"metodo":"contra_entrega"}]}'::jsonb where phone_number_id = 'perfil-3b-prueba';
  begin
    update public.dulabs_agente_runtime_config set checkout_opciones = '{"entregas":["dron"],"pagos":[{"metodo":"contra_entrega"}]}'::jsonb where phone_number_id = 'perfil-3b-prueba';
    raise exception 'FAIL 12 entrega inventada';
  exception when check_violation then null; end;
  raise notice 'PASS 12 configuración: oficina admitida, lo inventado rechazado';

  -- 13. Eliminar un cliente con un pedido pendiente de aceptación: es ACTIVO (no se borra).
  select pg_get_functiondef('public.dulabs_catalogo_cliente_eliminar(uuid, text, text, bigint)'::regprocedure) into def;
  if def not like '%''pending_acceptance''%' then raise exception 'FAIL 13 cliente_eliminar no protege pendientes'; end if;
  raise notice 'PASS 13 un pendiente de aceptación cuenta como pedido activo al eliminar un cliente';
end $$;

select 'OK Fase 3B.1: pendiente de aceptación (13 controles)';
rollback;
