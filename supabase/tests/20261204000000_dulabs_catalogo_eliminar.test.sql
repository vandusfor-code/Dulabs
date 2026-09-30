-- Bloque 35 — verificación de 20261204000000_dulabs_catalogo_eliminar.sql
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO con las migraciones del catálogo aplicadas. Datos FICTICIOS.
--   \i supabase/migrations/20261204000000_dulabs_catalogo_eliminar.sql   (dos veces: idempotente)
--   \i supabase/tests/20261204000000_dulabs_catalogo_eliminar.test.sql
\set ON_ERROR_STOP 1
begin;

do $$
declare
  a constant uuid := gen_random_uuid();
  b constant uuid := gen_random_uuid();
  pn constant text := 'PN-35-' || left(a::text, 8);
  pn_b constant text := 'PN-35B-' || left(b::text, 8);
  prod uuid;
  p_cerrado uuid;
  p_activo uuid;
  p_otro uuid;
  stock0 integer;
  r jsonb;
  n integer;
  crear constant text := 'crear';
begin
  insert into public.dulabs_clientes_config (id_tenant, nombre_negocio, phone_number_id, telefono_negocio) values (a, 'Joyería B35', pn, '573000000035');
  insert into public.dulabs_clientes_config (id_tenant, nombre_negocio, phone_number_id, telefono_negocio) values (b, 'Otro B35', pn_b, '573000000036');
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values (a, 'Dije B35', 1000, 50, true, true) returning id into prod;

  -- Pedido de C1 confirmado (aparta stock) y luego completado; otro de C1 confirmado (activo).
  p_cerrado := (public.dulabs_catalogo_pedido_crear(
    jsonb_build_object('id_tenant', a, 'pedido_publico', 'DL-ORD-B35AAA', 'canal', 'retail', 'origen', 'agent', 'estado', 'draft',
      'clave_idempotencia', 'b35-1-' || a, 'contacto_phone_number_id', pn, 'contacto_wa_id', '573001350001',
      'lineas', jsonb_build_array(jsonb_build_object('reference', 'DL-000001', 'product_name', 'Dije B35', 'quantity', 1, 'unit_price', 1000, 'subtotal', 1000)), 'total', 1000),
    jsonb_build_object('event_id', 'evt_' || left(md5('b35a' || a::text), 26), 'tipo', 'order.created', 'payload', '{}'::jsonb)) -> 'pedido' ->> 'id')::uuid;
  update public.dulabs_catalogo_pedidos set estado = 'completed', confirmado_at = now() where id = p_cerrado;
  p_activo := (public.dulabs_catalogo_pedido_crear(
    jsonb_build_object('id_tenant', a, 'pedido_publico', 'DL-ORD-B35BBB', 'canal', 'retail', 'origen', 'agent', 'estado', 'draft',
      'clave_idempotencia', 'b35-2-' || a, 'contacto_phone_number_id', pn, 'contacto_wa_id', '573001350001',
      'lineas', '[]'::jsonb, 'total', 0),
    jsonb_build_object('event_id', 'evt_' || left(md5('b35b' || a::text), 26), 'tipo', 'order.created', 'payload', '{}'::jsonb)) -> 'pedido' ->> 'id')::uuid;
  update public.dulabs_catalogo_pedidos set estado = 'confirmed', confirmado_at = now() where id = p_activo;
  -- Pedido cerrado de otro negocio con el mismo número público.
  p_otro := (public.dulabs_catalogo_pedido_crear(
    jsonb_build_object('id_tenant', b, 'pedido_publico', 'DL-ORD-B35AAA', 'canal', 'retail', 'origen', 'agent', 'estado', 'draft',
      'clave_idempotencia', 'b35-3-' || b, 'contacto_phone_number_id', pn_b, 'contacto_wa_id', '573001350001', 'lineas', '[]'::jsonb, 'total', 0),
    jsonb_build_object('event_id', 'evt_' || left(md5('b35c' || b::text), 26), 'tipo', 'order.created', 'payload', '{}'::jsonb)) -> 'pedido' ->> 'id')::uuid;
  update public.dulabs_catalogo_pedidos set estado = 'cancelled' where id = p_otro;

  -- 1. Los historiales siguen inmutables para cualquier otro borrado.
  begin
    delete from public.dulabs_catalogo_pedido_eventos where pedido_id = p_cerrado;
    raise exception 'FALLO: se pudo borrar un evento sin autorización';
  exception when insufficient_privilege then null;
  end;

  -- 2. Un pedido ACTIVO no se elimina (primero se cancela: el stock vuelve).
  r := public.dulabs_catalogo_pedido_eliminar(a, 'DL-ORD-B35BBB', 7);
  if r->>'resultado' <> 'activo' or r->>'estado' <> 'confirmed' then raise exception 'FALLO: activo: %', r; end if;
  if not exists (select 1 from public.dulabs_catalogo_pedidos where id = p_activo) then raise exception 'FALLO: se borró un activo'; end if;

  -- 3. Cerrado: se elimina con su historial; copia en la auditoría; el stock no cambia; el del otro negocio sigue.
  select stock into stock0 from public.dulabs_inventario_productos where id = prod;
  r := public.dulabs_catalogo_pedido_eliminar(a, 'DL-ORD-B35AAA', 7);
  if r->>'resultado' <> 'eliminado' then raise exception 'FALLO: eliminar cerrado: %', r; end if;
  if exists (select 1 from public.dulabs_catalogo_pedidos where id = p_cerrado) then raise exception 'FALLO: sigue el pedido'; end if;
  if exists (select 1 from public.dulabs_catalogo_pedido_eventos where pedido_id = p_cerrado) then raise exception 'FALLO: sigue su historial'; end if;
  if (select stock from public.dulabs_inventario_productos where id = prod) <> stock0 then raise exception 'FALLO: cambió el stock'; end if;
  select count(*) into n from public.dulabs_catalogo_eliminados where id_tenant = a and tipo = 'pedido' and referencia = 'DL-ORD-B35AAA' and miembro_id = 7
    and datos->'pedido'->>'id' = p_cerrado::text and jsonb_array_length(datos->'eventos') >= 1;
  if n <> 1 then raise exception 'FALLO: auditoría del pedido'; end if;
  if not exists (select 1 from public.dulabs_catalogo_pedidos where id = p_otro) then raise exception 'FALLO: se borró el del otro negocio'; end if;
  if public.dulabs_catalogo_pedido_eliminar(a, 'DL-ORD-B35AAA', 7)->>'resultado' <> 'no_encontrado' then raise exception 'FALLO: repetir'; end if;
  -- La marca de autorización no queda encendida después.
  if coalesce(current_setting('dulabs.eliminacion_autorizada', true), '') = 'on' then raise exception 'FALLO: marca encendida'; end if;

  -- 4. Cliente C1 con un pedido activo: no se elimina.
  insert into public.dulabs_catalogo_clientes_canal (id_tenant, phone_number_id, wa_id, canal, origen) values (a, pn, '573001350001', 'retail', 'cliente');
  insert into public.dulabs_catalogo_clientes_canal_eventos (id_tenant, phone_number_id, wa_id, canal_anterior, canal_nuevo, origen) values (a, pn, '573001350001', null, 'retail', 'cliente');
  insert into public.dulabs_clientes_conocidos (id_tenant, phone_number_id, telefono_cliente, nombre) values (a, pn, '573001350001', 'Cliente B35');
  insert into public.dulabs_catalogo_clientes_ficha (id_tenant, phone_number_id, wa_id, ya_compro, registrado) values (a, pn, '573001350001', true, true);
  insert into public.dulabs_catalogo_clientes_notas (id_tenant, phone_number_id, wa_id, nota, version) values (a, pn, '573001350001', 'VIP', 1);
  insert into public.dulabs_agente_conversaciones (id_tenant, phone_number_id, wa_id, version, estado) values (a, pn, '573001350001', 1, '{}'::jsonb);
  r := public.dulabs_catalogo_cliente_eliminar(a, pn, '573001350001', 7);
  if r->>'resultado' <> 'pedidos_activos' or (r->>'activos')::int <> 1 then raise exception 'FALLO: cliente con activo: %', r; end if;
  if not exists (select 1 from public.dulabs_catalogo_clientes_canal where id_tenant = a and wa_id = '573001350001') then raise exception 'FALLO: se tocó el cliente'; end if;

  -- 5. Cancelado el activo: se elimina TODO lo del contacto (menos el chat del Inbox); copia en la auditoría.
  update public.dulabs_catalogo_pedidos set estado = 'cancelled' where id = p_activo;
  r := public.dulabs_catalogo_cliente_eliminar(a, pn, '573001350001', 7);
  if r->>'resultado' <> 'eliminado' or (r->>'pedidos')::int <> 1 then raise exception 'FALLO: eliminar cliente: %', r; end if;
  if exists (select 1 from public.dulabs_catalogo_pedidos where id_tenant = a and contacto_wa_id = '573001350001')
    or exists (select 1 from public.dulabs_catalogo_clientes_canal where id_tenant = a and wa_id = '573001350001')
    or exists (select 1 from public.dulabs_catalogo_clientes_canal_eventos where id_tenant = a and wa_id = '573001350001')
    or exists (select 1 from public.dulabs_clientes_conocidos where id_tenant = a and telefono_cliente = '573001350001')
    or exists (select 1 from public.dulabs_catalogo_clientes_ficha where id_tenant = a and wa_id = '573001350001')
    or exists (select 1 from public.dulabs_catalogo_clientes_notas where id_tenant = a and wa_id = '573001350001')
    or exists (select 1 from public.dulabs_agente_conversaciones where id_tenant = a and wa_id = '573001350001') then
    raise exception 'FALLO: quedó algo del cliente';
  end if;
  if (public.dulabs_catalogo_clientes_listar(a, null, 'todos', 25, 0)->>'total')::int <> 0 then raise exception 'FALLO: sigue en el listado'; end if;
  if not exists (select 1 from public.dulabs_catalogo_eliminados where id_tenant = a and tipo = 'cliente' and referencia = pn || '_573001350001'
    and datos->'nombre'->>'nombre' = 'Cliente B35' and jsonb_array_length(datos->'pedidos') = 1) then
    raise exception 'FALLO: auditoría del cliente';
  end if;
  -- El mismo teléfono en el otro negocio no se toca; un número ajeno no se acepta.
  if not exists (select 1 from public.dulabs_catalogo_pedidos where id = p_otro) then raise exception 'FALLO: se tocó el otro negocio'; end if;
  if public.dulabs_catalogo_cliente_eliminar(a, pn_b, '573001350001', 7)->>'resultado' <> 'no_encontrado' then raise exception 'FALLO: número ajeno'; end if;
  if public.dulabs_catalogo_cliente_eliminar(a, pn, '573001350001', 7)->>'resultado' <> 'no_encontrado' then raise exception 'FALLO: repetir cliente'; end if;

  -- 6. La auditoría es inmutable.
  begin
    delete from public.dulabs_catalogo_eliminados where id_tenant = a;
    raise exception 'FALLO: se borró la auditoría';
  exception when insufficient_privilege then null;
  end;
  perform crear;
end $$;

-- 7. Solo service_role.
do $$
begin
  if has_function_privilege('anon', 'public.dulabs_catalogo_pedido_eliminar(uuid, text, bigint)', 'execute')
    or has_function_privilege('authenticated', 'public.dulabs_catalogo_cliente_eliminar(uuid, text, text, bigint)', 'execute')
    or has_table_privilege('anon', 'public.dulabs_catalogo_eliminados', 'select') then
    raise exception 'FALLO: anon/authenticated tienen acceso';
  end if;
end $$;

select 'OK Bloque 35: eliminar pedidos y clientes (7 controles)';
rollback;
