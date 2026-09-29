-- Bloque 34 — verificación de 20261203000000_dulabs_catalogo_clientes_ficha.sql
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO con las migraciones del catálogo aplicadas. Datos FICTICIOS.
--   \i supabase/migrations/20261203000000_dulabs_catalogo_clientes_ficha.sql   (dos veces: idempotente)
--   \i supabase/tests/20261203000000_dulabs_catalogo_clientes_ficha.test.sql
\set ON_ERROR_STOP 1
begin;

do $$
declare
  a constant uuid := gen_random_uuid();
  b constant uuid := gen_random_uuid();
  pn constant text := 'PN-34-' || left(a::text, 8);
  pid uuid;
  r jsonb;
begin
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, activo) values (a, 'Dije B34', 1000, 50, true, true);

  -- R: registrado por el equipo como mayorista ANTIGUO (ya compró fuera del bot), sin pedidos ni mensajes.
  insert into public.dulabs_catalogo_clientes_canal (id_tenant, phone_number_id, wa_id, canal, origen) values (a, pn, '573001120001', 'wholesale', 'asesora');
  insert into public.dulabs_clientes_conocidos (id_tenant, phone_number_id, telefono_cliente, nombre) values (a, pn, '573001120001', 'Rosa Registrada');
  insert into public.dulabs_catalogo_clientes_ficha (id_tenant, phone_number_id, wa_id, ya_compro, registrado) values (a, pn, '573001120001', true, true);

  -- S: registrado solo en la ficha (sin modalidad todavía): igual es cliente.
  insert into public.dulabs_catalogo_clientes_ficha (id_tenant, phone_number_id, wa_id, ya_compro, registrado) values (a, pn, '573001120002', false, true);

  -- T: cliente del chat con pedido a nombre "Tomás del pedido"; el equipo corrigió su nombre conocido.
  insert into public.dulabs_catalogo_clientes_canal (id_tenant, phone_number_id, wa_id, canal, origen) values (a, pn, '573001120003', 'retail', 'cliente');
  pid := (public.dulabs_catalogo_pedido_crear(
    jsonb_build_object('id_tenant', a, 'pedido_publico', 'DL-ORD-B34AAA', 'canal', 'retail', 'origen', 'agent', 'estado', 'draft',
      'clave_idempotencia', 'clave-b34-' || a, 'contacto_phone_number_id', pn, 'contacto_wa_id', '573001120003',
      'lineas', jsonb_build_array(jsonb_build_object('reference', 'DL-000001', 'product_name', 'Dije B34', 'quantity', 1, 'unit_price', 1000, 'subtotal', 1000)), 'total', 1000),
    jsonb_build_object('event_id', 'evt_' || left(md5('b34' || a::text), 26), 'tipo', 'order.created', 'payload', '{}'::jsonb)) -> 'pedido' ->> 'id')::uuid;
  update public.dulabs_catalogo_pedidos set estado = 'confirmed', confirmado_at = now(), cliente_nombre = 'Tomás del pedido' where id = pid;
  insert into public.dulabs_clientes_conocidos (id_tenant, phone_number_id, telefono_cliente, nombre) values (a, pn, '573001120003', 'Tomás Corregido');

  -- Otro negocio con ficha: nunca aparece en el primero.
  insert into public.dulabs_catalogo_clientes_ficha (id_tenant, phone_number_id, wa_id, ya_compro, registrado) values (b, pn, '573001120009', true, true);

  -- 1. Los registrados aparecen (con o sin modalidad); el del otro negocio no.
  r := public.dulabs_catalogo_clientes_listar(a, null, 'todos', 25, 0);
  if (r->>'total')::int <> 3 then raise exception 'FALLO: se esperaban 3 clientes: %', r; end if;

  -- 2. Ficha de R: ya_compro y registrado; nombre conocido; modalidad del registro.
  select f into r from jsonb_array_elements(public.dulabs_catalogo_clientes_listar(a, null, 'todos', 25, 0)->'filas') f where f->>'wa_id' = '573001120001';
  if r->>'nombre' <> 'Rosa Registrada' or r->>'canal' <> 'wholesale' or r->>'origen' <> 'asesora' or (r->>'ya_compro')::boolean is not true or (r->>'registrado')::boolean is not true then
    raise exception 'FALLO: ficha de R: %', r;
  end if;

  -- 3. El nombre que corrigió el equipo manda sobre el del pedido.
  select f into r from jsonb_array_elements(public.dulabs_catalogo_clientes_listar(a, null, 'todos', 25, 0)->'filas') f where f->>'wa_id' = '573001120003';
  if r->>'nombre' <> 'Tomás Corregido' then raise exception 'FALLO: nombre conocido primero: %', r; end if;

  -- 4. Filtros: "compraron" cuenta al cliente antiguo (sin pedidos); "sin_compras" no; "registrados".
  r := public.dulabs_catalogo_clientes_listar(a, null, 'compraron', 25, 0);
  if (r->>'total')::int <> 2 then raise exception 'FALLO: compraron (T por pedido + R antiguo): %', r; end if;
  r := public.dulabs_catalogo_clientes_listar(a, null, 'sin_compras', 25, 0);
  if (r->>'total')::int <> 1 or r->'filas'->0->>'wa_id' <> '573001120002' then raise exception 'FALLO: sin_compras: %', r; end if;
  r := public.dulabs_catalogo_clientes_listar(a, null, 'registrados', 25, 0);
  if (r->>'total')::int <> 2 then raise exception 'FALLO: registrados: %', r; end if;

  -- 5. Un contacto por (negocio, número, teléfono): la ficha no se duplica.
  begin
    insert into public.dulabs_catalogo_clientes_ficha (id_tenant, phone_number_id, wa_id) values (a, pn, '573001120001');
    raise exception 'FALLO: ficha duplicada';
  exception when unique_violation then null;
  end;
end $$;

-- 6. Solo service_role.
do $$
begin
  if has_table_privilege('anon', 'public.dulabs_catalogo_clientes_ficha', 'select') or has_table_privilege('authenticated', 'public.dulabs_catalogo_clientes_ficha', 'select') then
    raise exception 'FALLO: anon/authenticated pueden leer la ficha';
  end if;
end $$;

select 'OK Bloque 34: ficha de clientes (6 controles)';
rollback;
