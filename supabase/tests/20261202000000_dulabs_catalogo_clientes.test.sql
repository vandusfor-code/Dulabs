-- Bloque 33 — verificación de 20261202000000_dulabs_catalogo_clientes.sql
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO con las migraciones del catálogo aplicadas. Datos FICTICIOS.
--   \i supabase/migrations/20261202000000_dulabs_catalogo_clientes.sql   (dos veces: idempotente)
--   \i supabase/tests/20261202000000_dulabs_catalogo_clientes.test.sql
\set ON_ERROR_STOP 1
begin;

do $$
declare
  a constant uuid := gen_random_uuid();
  b constant uuid := gen_random_uuid();
  pn constant text := 'PN-33-' || left(a::text, 8);
  pn_b constant text := 'PN-33B-' || left(b::text, 8);
  pid uuid;
  r jsonb;
  n integer;
  seq integer := 0;
  pedido text;
begin
  -- Pedido por la RPC del catálogo (como en producción) y luego llevado al estado de la prueba.
  create temp table if not exists b33_pedidos (id uuid) on commit drop;
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values (a, 'Dije B33', 1000, 50, true, true);

  -- X: mayorista (eligió con el botón), un pedido confirmado de $800.000 en Pasto y un borrador; tiene nota.
  insert into public.dulabs_catalogo_clientes_canal (id_tenant, phone_number_id, wa_id, canal, origen) values (a, pn, '573001110001', 'wholesale', 'cliente');
  foreach pedido in array array['DL-ORD-B33AAA', 'DL-ORD-B33AAB'] loop
    seq := seq + 1;
    pid := (public.dulabs_catalogo_pedido_crear(
      jsonb_build_object('id_tenant', a, 'pedido_publico', pedido, 'canal', 'wholesale', 'origen', 'agent', 'estado', 'draft',
        'clave_idempotencia', 'clave-b33-' || seq || '-' || a, 'contacto_phone_number_id', pn, 'contacto_wa_id', '573001110001',
        'lineas', jsonb_build_array(jsonb_build_object('reference', 'DL-000001', 'product_name', 'Dije B33', 'quantity', 1, 'unit_price', 800000, 'subtotal', 800000)), 'total', 800000),
      jsonb_build_object('event_id', 'evt_' || left(md5('b33' || seq || a::text), 26), 'tipo', 'order.created', 'payload', '{}'::jsonb)) -> 'pedido' ->> 'id')::uuid;
    if pedido = 'DL-ORD-B33AAA' then
      update public.dulabs_catalogo_pedidos set estado = 'confirmed', confirmado_at = now(), cliente_nombre = 'Ana Mayorista', ciudad = 'Pasto' where id = pid;
    end if;
  end loop;
  insert into public.dulabs_catalogo_clientes_notas (id_tenant, phone_number_id, wa_id, nota) values (a, pn, '573001110001', 'Paga siempre por Nequi');

  -- Y: detal, sin pedidos; su nombre viene de los contactos conocidos.
  insert into public.dulabs_catalogo_clientes_canal (id_tenant, phone_number_id, wa_id, canal, origen) values (a, pn, '573001110002', 'retail', 'cliente');
  insert into public.dulabs_clientes_conocidos (id_tenant, phone_number_id, telefono_cliente, nombre) values (a, pn, '573001110002', 'Luis Detal');

  -- Z: sin clasificación, con una solicitud de la tienda web (su modalidad sale del pedido).
  seq := seq + 1;
  pid := (public.dulabs_catalogo_pedido_crear(
    jsonb_build_object('id_tenant', a, 'pedido_publico', 'DL-ORD-B33AAC', 'canal', 'retail', 'origen', 'catalog', 'estado', 'draft',
      'clave_idempotencia', 'clave-b33-' || seq || '-' || a, 'contacto_phone_number_id', pn, 'contacto_wa_id', '573001110003',
      'lineas', jsonb_build_array(jsonb_build_object('reference', 'DL-000001', 'product_name', 'Dije B33', 'quantity', 1, 'unit_price', 1000, 'subtotal', 1000)), 'total', 1000),
    jsonb_build_object('event_id', 'evt_' || left(md5('b33' || seq || a::text), 26), 'tipo', 'order.created', 'payload', '{}'::jsonb)) -> 'pedido' ->> 'id')::uuid;
  update public.dulabs_catalogo_pedidos set estado = 'pending_confirmation' where id = pid;

  -- Solo saludó (mensaje, sin clasificación ni pedidos): NO es cliente.
  insert into public.dulabs_mensajes_log (phone_number_id, telefono_cliente, direccion, contenido, origen) values (pn, '573001110009', 'entrante', 'hola', 'entrante');
  -- Otro negocio: nunca aparece.
  insert into public.dulabs_catalogo_clientes_canal (id_tenant, phone_number_id, wa_id, canal, origen) values (b, pn_b, '573001110001', 'retail', 'cliente');

  -- 1. Todos: 3 clientes (X, Y, Z); el que solo saludó y el del otro negocio no.
  r := public.dulabs_catalogo_clientes_listar(a, null, 'todos', 25, 0);
  if (r->>'total')::int <> 3 then raise exception 'FALLO: se esperaban 3 clientes, hay % (%)', r->>'total', r; end if;
  if exists (select 1 from jsonb_array_elements(r->'filas') f where f->>'wa_id' = '573001110009') then raise exception 'FALLO: apareció un contacto que solo saludó'; end if;

  -- 2. Resumen de X: nombre, modalidad, pedidos, compras, total, ciudad, último pedido y nota.
  select f into r from jsonb_array_elements(public.dulabs_catalogo_clientes_listar(a, null, 'todos', 25, 0)->'filas') f where f->>'wa_id' = '573001110001';
  if r->>'nombre' <> 'Ana Mayorista' or r->>'canal' <> 'wholesale' or (r->>'pedidos')::int <> 1 or (r->>'compras')::int <> 1
     or (r->>'total_comprado')::bigint <> 800000 or r->>'ciudad' <> 'Pasto' or r->>'ultimo_pedido' <> 'DL-ORD-B33AAA' or (r->>'tiene_nota')::boolean is not true then
    raise exception 'FALLO: resumen de X incorrecto: %', r;
  end if;

  -- 3. Y: nombre de los contactos conocidos, sin compras. Z: modalidad del pedido de la tienda.
  select f into r from jsonb_array_elements(public.dulabs_catalogo_clientes_listar(a, null, 'todos', 25, 0)->'filas') f where f->>'wa_id' = '573001110002';
  if r->>'nombre' <> 'Luis Detal' or (r->>'compras')::int <> 0 or (r->>'total_comprado')::bigint <> 0 then raise exception 'FALLO: resumen de Y: %', r; end if;
  select f into r from jsonb_array_elements(public.dulabs_catalogo_clientes_listar(a, null, 'todos', 25, 0)->'filas') f where f->>'wa_id' = '573001110003';
  if r->>'canal' <> 'retail' or r->>'origen' is not null or (r->>'pedidos')::int <> 0 then raise exception 'FALLO: resumen de Z: %', r; end if;

  -- 4. Filtros.
  if (public.dulabs_catalogo_clientes_listar(a, null, 'mayorista', 25, 0)->>'total')::int <> 1 then raise exception 'FALLO: filtro mayorista'; end if;
  if (public.dulabs_catalogo_clientes_listar(a, null, 'detal', 25, 0)->>'total')::int <> 2 then raise exception 'FALLO: filtro detal'; end if;
  if (public.dulabs_catalogo_clientes_listar(a, null, 'compraron', 25, 0)->>'total')::int <> 1 then raise exception 'FALLO: filtro compraron'; end if;
  if (public.dulabs_catalogo_clientes_listar(a, null, 'sin_compras', 25, 0)->>'total')::int <> 2 then raise exception 'FALLO: filtro sin_compras'; end if;

  -- 5. Búsqueda por nombre (sin mayúsculas) y por teléfono (con espacios o '+').
  r := public.dulabs_catalogo_clientes_listar(a, 'ana may', 'todos', 25, 0);
  if (r->>'total')::int <> 1 or r->'filas'->0->>'wa_id' <> '573001110001' then raise exception 'FALLO: búsqueda por nombre: %', r; end if;
  r := public.dulabs_catalogo_clientes_listar(a, '+57 300 111 0002', 'todos', 25, 0);
  if (r->>'total')::int <> 1 or r->'filas'->0->>'wa_id' <> '573001110002' then raise exception 'FALLO: búsqueda por teléfono: %', r; end if;

  -- 6. Paginación: el total no cambia; la página trae lo pedido.
  r := public.dulabs_catalogo_clientes_listar(a, null, 'todos', 1, 1);
  if (r->>'total')::int <> 3 or jsonb_array_length(r->'filas') <> 1 then raise exception 'FALLO: paginación: %', r; end if;

  -- 7. Aislamiento: el otro negocio solo ve su cliente (y sin datos del primero).
  r := public.dulabs_catalogo_clientes_listar(b, null, 'todos', 25, 0);
  if (r->>'total')::int <> 1 or (r->'filas'->0->>'pedidos')::int <> 0 or (r->'filas'->0->>'tiene_nota')::boolean then raise exception 'FALLO: aislamiento entre negocios: %', r; end if;

  -- 8. Nota: compare-and-set por versión (dos ediciones a la vez: solo una gana).
  update public.dulabs_catalogo_clientes_notas set nota = 'Primera edición', version = version + 1 where id_tenant = a and phone_number_id = pn and wa_id = '573001110001' and version = 1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO: la primera edición debía ganar'; end if;
  update public.dulabs_catalogo_clientes_notas set nota = 'Edición vieja', version = version + 1 where id_tenant = a and phone_number_id = pn and wa_id = '573001110001' and version = 1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: una edición sobre una versión vieja no debe escribir'; end if;
  begin
    insert into public.dulabs_catalogo_clientes_notas (id_tenant, phone_number_id, wa_id, nota) values (a, pn, '573001110001', repeat('x', 1001));
    raise exception 'FALLO: nota > 1000 caracteres';
  exception when check_violation or unique_violation then null;
  end;
end $$;

-- 9. Solo service_role: anon y authenticated no pueden llamar la función ni leer las notas.
do $$
begin
  if has_function_privilege('anon', 'public.dulabs_catalogo_clientes_listar(uuid, text, text, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_catalogo_clientes_listar(uuid, text, text, integer, integer)', 'execute') then
    raise exception 'FALLO: anon/authenticated pueden listar clientes';
  end if;
  if has_table_privilege('anon', 'public.dulabs_catalogo_clientes_notas', 'select') or has_table_privilege('authenticated', 'public.dulabs_catalogo_clientes_notas', 'select') then
    raise exception 'FALLO: anon/authenticated pueden leer notas';
  end if;
end $$;

select 'OK Bloque 33: clientes (9 controles)';
rollback;
