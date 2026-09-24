-- Bloque 20 — verificación de 20261117000000_dulabs_catalogo_busqueda_indice.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba; negocios FICTICIOS).
-- Preparación: roles service_role/anon/authenticated, esquema storage con storage.buckets, y:
--   \i supabase/migrations/20260923000000_amore_inventario_productos.sql   (tabla física de productos)
--   \i supabase/migrations/20261105000000_dulabs_catalogo_fase1.sql
--   \i supabase/migrations/20261111000000_dulabs_catalogo_busqueda.sql
--   \i supabase/migrations/20261117000000_dulabs_catalogo_busqueda_indice.sql   (dos veces: idempotente)
--   \i supabase/tests/20261117000000_dulabs_catalogo_busqueda_indice.test.sql
-- Paridad de resultados antes/después y rendimiento: scripts/perf (README).

\set ON_ERROR_STOP 1

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-0000000000c1';  -- con Catálogo
  b constant uuid := 'bbbbbbbb-0000-4000-8000-0000000000c2';  -- sin Catálogo (otro módulo)
  p1 uuid; p2 uuid; n integer; r record;
begin
  insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values (a, 'catalogo', true);

  -- 1. Crear indexa (solo negocios con Catálogo); la categoría entra al documento.
  insert into public.dulabs_catalogo_categorias (id_tenant, nombre) values (a, 'Aretes');
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, categoria_id, categoria, material, color, descripcion)
  values (a, '  Anillo   Corazón Piña ', 1000, 3, null, null, 'Plata 925', 'rosa', 'Con circón')
  returning id into p1;
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, categoria_id, categoria)
  values (a, 'Luna', 1000, 3, (select id from public.dulabs_catalogo_categorias where id_tenant = a), 'Aretes')
  returning id into p2;
  insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock) values (b, 'Anillo Corazón', 1000, 3);
  if (select count(*) from public.dulabs_catalogo_busqueda_doc where id_tenant = a) <> 2 then raise exception 'FAIL 1a'; end if;
  if exists (select 1 from public.dulabs_catalogo_busqueda_doc where id_tenant = b) then raise exception 'FAIL 1b indexó un negocio sin Catálogo'; end if;
  select * into r from public.dulabs_catalogo_busqueda_doc where producto_id = p1;
  if r.clave_nombre <> 'anillo corazon pina' then raise exception 'FAIL 1c clave %', r.clave_nombre; end if;
  if not exists (select 1 from public.dulabs_catalogo_buscar(a, 'aretes', 'all', 'retail', 20, 0) x where x.referencia = (select referencia from public.dulabs_inventario_productos where id = p2)) then
    raise exception 'FAIL 1d la categoría no entra al documento';
  end if;
  raise notice 'PASS 1 crear indexa (solo con Catálogo, con categoría)';

  -- 2. Editar lo buscable reindexa; editar precio/stock no; desactivar sale de la búsqueda.
  update public.dulabs_inventario_productos set nombre = 'Anillo Estrella' where id = p1;
  if (select clave_nombre from public.dulabs_catalogo_busqueda_doc where producto_id = p1) <> 'anillo estrella' then raise exception 'FAIL 2a'; end if;
  if exists (select 1 from public.dulabs_catalogo_buscar(a, 'corazon', 'all', 'retail', 20, 0)) then raise exception 'FAIL 2b documento viejo'; end if;
  if not exists (select 1 from public.dulabs_catalogo_buscar(a, 'estrella', 'all', 'retail', 20, 0)) then raise exception 'FAIL 2c'; end if;
  update public.dulabs_inventario_productos set activo = false where id = p1;
  if exists (select 1 from public.dulabs_catalogo_buscar(a, 'estrella', 'all', 'retail', 20, 0)) then raise exception 'FAIL 2d inactivo visible'; end if;
  raise notice 'PASS 2 editar reindexa; inactivo no aparece';

  -- 3. Borrar el producto borra su documento (cascada).
  delete from public.dulabs_inventario_productos where id = p1;
  if exists (select 1 from public.dulabs_catalogo_busqueda_doc where producto_id = p1) then raise exception 'FAIL 3'; end if;
  raise notice 'PASS 3 borrar limpia el índice';

  -- 4. Habilitar el Catálogo a un negocio existente lo indexa completo.
  insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values (b, 'catalogo', true);
  if (select count(*) from public.dulabs_catalogo_busqueda_doc where id_tenant = b) <> 1 then raise exception 'FAIL 4'; end if;
  raise notice 'PASS 4 habilitar el módulo indexa el negocio';

  -- 5. Nombre exacto: tildes/mayúsculas/espacios; nunca de otro negocio.
  select count(*) into n from public.dulabs_catalogo_por_nombre(b, 'ANILLO   corazon', 10);
  if n <> 1 then raise exception 'FAIL 5a %', n; end if;
  select count(*) into n from public.dulabs_catalogo_por_nombre(a, 'anillo corazon', 10);
  if n <> 0 then raise exception 'FAIL 5b cruzó negocios'; end if;
  select count(*) into n from public.dulabs_catalogo_por_nombre(b, 'anillo', 10);
  if n <> 0 then raise exception 'FAIL 5c no es exacto'; end if;
  raise notice 'PASS 5 nombre exacto por índice, aislado por negocio';

  -- 6. La búsqueda nunca devuelve productos de otro negocio.
  if exists (select 1 from public.dulabs_catalogo_buscar(a, 'anillo corazon', 'any', 'retail', 20, 0) x
              join public.dulabs_inventario_productos p on p.referencia = x.referencia and p.id_tenant = b) then
    raise exception 'FAIL 6';
  end if;
  raise notice 'PASS 6 aislamiento de la búsqueda';
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.dulabs_catalogo_busqueda_doc', 'select')
     or has_table_privilege('authenticated', 'public.dulabs_catalogo_busqueda_doc', 'select')
     or has_function_privilege('anon', 'public.dulabs_catalogo_por_nombre(uuid, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_catalogo_buscar(uuid, text, text, text, integer, integer, text, text, text, uuid, bigint, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_catalogo_busqueda_indexar(uuid, uuid)', 'execute') then
    raise exception 'FAIL 7 anon/authenticated con acceso';
  end if;
  raise notice 'PASS 7 solo el backend (service_role)';
end;
$$;
