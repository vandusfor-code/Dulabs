-- Bloque 31 — verificación de 20261130000000_dulabs_catalogo_pedido_notificaciones.sql
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO con las migraciones del catálogo aplicadas. Datos FICTICIOS.
--   \i supabase/migrations/20261130000000_dulabs_catalogo_pedido_notificaciones.sql   (dos veces: idempotente)
--   \i supabase/tests/20261130000000_dulabs_catalogo_pedido_notificaciones.test.sql
\set ON_ERROR_STOP 1
begin;

do $$
declare
  a constant uuid := gen_random_uuid();
  pid uuid;
  n integer;
  ok boolean;
begin
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values (a, 'Dije N', 1000, 5, true, true);
  pid := (public.dulabs_catalogo_pedido_crear(
    jsonb_build_object('id_tenant', a, 'pedido_publico', 'DL-ORD-NT31AB', 'canal', 'retail', 'origen', 'agent', 'estado', 'draft',
      'clave_idempotencia', 'clave-nt31-' || a, 'contacto_phone_number_id', 'PN-31', 'contacto_wa_id', '573001112233',
      'lineas', jsonb_build_array(jsonb_build_object('reference', 'DL-000001', 'product_name', 'Dije N', 'quantity', 1, 'unit_price', 1000, 'subtotal', 1000)), 'total', 1000),
    jsonb_build_object('event_id', 'evt_' || left(md5('nt31' || a::text), 26), 'tipo', 'order.created', 'payload', '{}'::jsonb)) -> 'pedido' ->> 'id')::uuid;

  -- 1. Una fila por (pedido, tipo): la segunda del mismo tipo choca (candado de idempotencia).
  insert into public.dulabs_catalogo_pedido_notificaciones (id_tenant, pedido_id, pedido_publico, tipo, estado_hacia, estado)
  values (a, pid, 'DL-ORD-NT31AB', 'enviado', 'enviado', 'enviando');
  begin
    insert into public.dulabs_catalogo_pedido_notificaciones (id_tenant, pedido_id, pedido_publico, tipo, estado_hacia, estado)
    values (a, pid, 'DL-ORD-NT31AB', 'enviado', 'enviado', 'enviando');
    raise exception 'FALLO: se permitieron dos notificaciones del mismo tipo para el mismo pedido';
  exception when unique_violation then null;
  end;
  -- Otro tipo del mismo pedido: sí.
  insert into public.dulabs_catalogo_pedido_notificaciones (id_tenant, pedido_id, pedido_publico, tipo, estado_hacia) values (a, pid, 'DL-ORD-NT31AB', 'entregado', 'entregado');
  select count(*) into n from public.dulabs_catalogo_pedido_notificaciones where pedido_id = pid;
  if n <> 2 then raise exception 'FALLO: se esperaban 2 filas, hay %', n; end if;

  -- 2. Compare-and-set de un reintento: solo UNA de dos actualizaciones "fallida -> enviando" gana.
  update public.dulabs_catalogo_pedido_notificaciones set estado = 'fallida' where pedido_id = pid and tipo = 'enviado';
  update public.dulabs_catalogo_pedido_notificaciones set estado = 'enviando' where pedido_id = pid and tipo = 'enviado' and estado = 'fallida';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO: el primer reintento debía tomar la fila'; end if;
  update public.dulabs_catalogo_pedido_notificaciones set estado = 'enviando' where pedido_id = pid and tipo = 'enviado' and estado = 'fallida';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: el segundo reintento no debía tomar la fila'; end if;

  -- 3. Valores cerrados: tipo, estado, canal y teléfono.
  begin
    insert into public.dulabs_catalogo_pedido_notificaciones (id_tenant, pedido_id, pedido_publico, tipo, estado_hacia) values (a, pid, 'DL-ORD-NT31AB', 'inventado', 'x');
    raise exception 'FALLO: tipo inventado aceptado';
  exception when check_violation then null;
  end;
  begin
    update public.dulabs_catalogo_pedido_notificaciones set estado = 'entregada_supuestamente' where pedido_id = pid and tipo = 'entregado';
    raise exception 'FALLO: estado inventado aceptado';
  exception when check_violation then null;
  end;
  begin
    update public.dulabs_catalogo_pedido_notificaciones set canal = 'sms' where pedido_id = pid and tipo = 'entregado';
    raise exception 'FALLO: canal distinto de whatsapp aceptado';
  exception when check_violation then null;
  end;
  begin
    update public.dulabs_catalogo_pedido_notificaciones set telefono_cliente = '+57 300' where pedido_id = pid and tipo = 'entregado';
    raise exception 'FALLO: teléfono con formato inválido aceptado';
  exception when check_violation then null;
  end;

  -- 4. Una notificación siempre apunta a un pedido real (FK).
  begin
    insert into public.dulabs_catalogo_pedido_notificaciones (id_tenant, pedido_id, pedido_publico, tipo, estado_hacia) values (a, gen_random_uuid(), 'DL-ORD-NT31AB', 'completado', 'completado');
    raise exception 'FALLO: notificación de un pedido inexistente aceptada';
  exception when foreign_key_violation then null;
  end;

  -- 5. RLS activo y sin acceso para anon / authenticated.
  select relrowsecurity into ok from pg_class where relname = 'dulabs_catalogo_pedido_notificaciones';
  if not ok then raise exception 'FALLO: RLS apagado'; end if;
  if has_table_privilege('anon', 'public.dulabs_catalogo_pedido_notificaciones', 'select') then raise exception 'FALLO: anon puede leer'; end if;
  raise notice 'OK Bloque 31: notificaciones de pedidos (5 controles)';
end $$;

rollback;
