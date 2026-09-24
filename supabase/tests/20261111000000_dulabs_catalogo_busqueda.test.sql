-- Bloque 10 — verificación de 20261111000000_dulabs_catalogo_busqueda.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta ~2.000 productos ficticios).
-- Preparación: create role service_role; create role anon; create role authenticated;
--   create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
--   \i supabase/migrations/20260923000000_amore_inventario_productos.sql
--   \i supabase/migrations/20261105000000_dulabs_catalogo_fase1.sql
--   \i supabase/migrations/20261111000000_dulabs_catalogo_busqueda.sql   (dos veces: idempotente)
--   \i supabase/tests/20261111000000_dulabs_catalogo_busqueda.test.sql

\set ON_ERROR_STOP 1

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  cat_collares uuid;
  cat_aretes uuid;
  r record;
  n integer;
  refs text[];
  pagina1 text[];
  pagina2 text[];
  t0 timestamptz;
  ms numeric;
begin
  -- Los negocios que buscan tienen el módulo Catálogo (desde el Bloque 20 solo esos se indexan).
  insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values (a, 'catalogo', true), (b, 'catalogo', true) on conflict do nothing;
  insert into dulabs_catalogo_categorias (id_tenant, nombre) values (a, 'Collares') returning id into cat_collares;
  insert into dulabs_catalogo_categorias (id_tenant, nombre) values (a, 'Aretes') returning id into cat_aretes;

  -- Productos conocidos del negocio A.
  insert into dulabs_inventario_productos (id_tenant, nombre, descripcion, precio, precio_mayor, stock, controla_stock, color, material, categoria_id) values
    (a, 'Arete Luna', 'Arete pequeño en forma de luna', 45000, 25000, 5, true, 'Dorado', 'Oro laminado', cat_aretes),
    (a, 'Aretes argolla grandes', null, 52000, 30000, 0, true, 'Dorado', 'Acero', cat_aretes),
    (a, 'Dije Corazón', 'Corazón con circón', 38000, 20000, 3, true, 'Plateado', 'Plata 925', null),
    (a, 'Cadena veneciana', null, 90000, 60000, 2, true, 'Dorado', 'Oro laminado', cat_collares),
    (a, 'Pulsera tejida', 'Hecha a mano', 30000, null, 10, true, 'Rojo', 'Hilo', null),
    (a, 'Anillo solitario', null, 58000, 32000, 4, true, 'Plateado', 'Plata 925', null);
  insert into dulabs_inventario_productos (id_tenant, nombre, precio, stock, activo, color) values (a, 'Aretes descontinuados', 40000, 5, false, 'Dorado');
  -- Relleno: ~2.000 productos del negocio A y 300 del negocio B.
  insert into dulabs_inventario_productos (id_tenant, nombre, descripcion, precio, precio_mayor, stock, color, material)
  select a,
         (array['Anillo', 'Pulsera', 'Tobillera', 'Broche', 'Piercing', 'Llavero'])[1 + g % 6] || ' modelo ' || g,
         'Referencia de relleno ' || g,
         10000 + (g % 50) * 1000, 5000 + (g % 50) * 500, g % 7,
         (array['Negro', 'Blanco', 'Azul', 'Verde'])[1 + g % 4], (array['Acero', 'Cuero', 'Resina'])[1 + g % 3]
    from generate_series(1, 1994) g;
  insert into dulabs_inventario_productos (id_tenant, nombre, precio, stock, color)
  select b, 'Aretes de B ' || g, 99000, 5, 'Dorado' from generate_series(1, 300) g;
  analyze dulabs_inventario_productos;

  -- 1. Plural/singular y tildes: "aretes" encuentra "Arete Luna"; "corazon" encuentra "Dije Corazón".
  select array_agg(referencia) into refs from dulabs_catalogo_buscar(a, 'aretes', 'all', 'retail', 20, 0);
  if not exists (select 1 from dulabs_inventario_productos where id_tenant = a and nombre = 'Arete Luna' and referencia = any (refs)) then raise exception 'FAIL 1a plural/singular'; end if;
  select count(*) into n from dulabs_catalogo_buscar(a, 'corazon', 'all', 'retail', 20, 0) s join dulabs_inventario_productos p on p.id_tenant = a and p.referencia = s.referencia where p.nombre = 'Dije Corazón';
  if n <> 1 then raise exception 'FAIL 1b sin tildes'; end if;
  raise notice 'PASS 1 plural/singular y sin tildes';

  -- 2. Varias palabras NO contiguas, color y material: "aretes dorados" / "cadena oro".
  select count(*) into n from dulabs_catalogo_buscar(a, 'aretes dorados', 'all', 'retail', 20, 0) s join dulabs_inventario_productos p on p.id_tenant = a and p.referencia = s.referencia where p.nombre in ('Arete Luna', 'Aretes argolla grandes');
  if n <> 2 then raise exception 'FAIL 2a varias palabras (%)', n; end if;
  select count(*) into n from dulabs_catalogo_buscar(a, 'cadena oro', 'all', 'retail', 20, 0) s join dulabs_inventario_productos p on p.id_tenant = a and p.referencia = s.referencia where p.nombre = 'Cadena veneciana';
  if n <> 1 then raise exception 'FAIL 2b material'; end if;
  raise notice 'PASS 2 varias palabras, color y material';

  -- 3. Categoría: "collares" encuentra "Cadena veneciana" (categoría Collares); prefijo "dora" = dorado.
  select count(*) into n from dulabs_catalogo_buscar(a, 'collares', 'all', 'retail', 20, 0) s join dulabs_inventario_productos p on p.id_tenant = a and p.referencia = s.referencia where p.nombre = 'Cadena veneciana';
  if n <> 1 then raise exception 'FAIL 3a categoría'; end if;
  select count(*) into n from dulabs_catalogo_buscar(a, 'argolla dora', 'all', 'retail', 20, 0);
  if n <> 1 then raise exception 'FAIL 3b prefijo'; end if;
  raise notice 'PASS 3 categoría y prefijos';

  -- 4. Relevancia y disponibilidad: el nombre pesa más que la descripción; con igual relevancia, disponibles primero.
  select p.nombre into r from dulabs_catalogo_buscar(a, 'luna', 'all', 'retail', 1, 0) s join dulabs_inventario_productos p on p.id_tenant = a and p.referencia = s.referencia;
  if r.nombre <> 'Arete Luna' then raise exception 'FAIL 4a relevancia'; end if;
  select array_agg(p.nombre order by s.ord) into refs
    from (select referencia, row_number() over () ord from dulabs_catalogo_buscar(a, 'aretes', 'all', 'retail', 20, 0)) s
    join dulabs_inventario_productos p on p.id_tenant = a and p.referencia = s.referencia;
  if refs[array_length(refs, 1)] <> 'Aretes argolla grandes' then raise exception 'FAIL 4b agotado al final (%)', refs; end if;
  raise notice 'PASS 4 relevancia y disponibles primero';

  -- 5. Aislamiento: nunca devuelve productos de otro negocio ni inactivos.
  select count(*) into n from dulabs_catalogo_buscar(a, 'aretes', 'any', 'retail', 20, 0) s join dulabs_inventario_productos p on p.referencia = s.referencia and p.id_tenant = b and p.nombre like 'Aretes de B%'
    where not exists (select 1 from dulabs_inventario_productos x where x.id_tenant = a and x.referencia = s.referencia);
  if n <> 0 then raise exception 'FAIL 5a otro negocio'; end if;
  select count(*) into n from dulabs_catalogo_buscar(a, 'descontinuados', 'all', 'retail', 20, 0);
  if n <> 0 then raise exception 'FAIL 5b inactivo'; end if;
  begin
    perform dulabs_catalogo_buscar(null, 'aretes');
    raise exception 'FAIL 5c sin negocio';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'PASS 5 solo el negocio indicado y solo activos';

  -- 6. Filtros en SQL con el precio DEL CANAL.
  select count(*) into n from dulabs_catalogo_buscar(a, 'aretes', 'all', 'retail', 20, 0, null, null, null, null, 46000);
  if n <> 1 then raise exception 'FAIL 6a precio detal (%)', n; end if;
  select count(*) into n from dulabs_catalogo_buscar(a, 'aretes', 'all', 'wholesale', 20, 0, null, null, null, null, 30000);
  if n <> 2 then raise exception 'FAIL 6b precio mayorista (%)', n; end if;
  select count(*) into n from dulabs_catalogo_buscar(a, 'pulsera', 'all', 'wholesale', 20, 0, null, 'rojo', null, null, 100000);
  if n <> 0 then raise exception 'FAIL 6c sin precio mayorista no pasa el filtro'; end if;
  select count(*) into n from dulabs_catalogo_buscar(a, '', 'all', 'retail', 20, 0, 'aretes');
  if n <> 2 then raise exception 'FAIL 6d filtro de categoría sin texto (%)', n; end if;
  select count(*) into n from dulabs_catalogo_buscar(a, 'anillo', 'all', 'retail', 20, 0, null, 'plateado', 'plata');
  if n <> 1 then raise exception 'FAIL 6e color + material (%)', n; end if;
  raise notice 'PASS 6 filtros y precio del canal';

  -- 7. Paginación: total estable, páginas sin solaparse; exclusión.
  select max(total), array_agg(referencia) into n, pagina1 from dulabs_catalogo_buscar(a, 'anillo', 'all', 'retail', 5, 0);
  if n < 300 then raise exception 'FAIL 7a total (%)', n; end if;
  select array_agg(referencia) into pagina2 from dulabs_catalogo_buscar(a, 'anillo', 'all', 'retail', 5, 5);
  if pagina1 && pagina2 or array_length(pagina2, 1) <> 5 then raise exception 'FAIL 7b páginas solapadas'; end if;
  select count(*) into n from dulabs_catalogo_buscar(a, 'anillo', 'all', 'retail', 5, 0, null, null, null, null, null, pagina1) s where s.referencia = any (pagina1);
  if n <> 0 then raise exception 'FAIL 7c exclusión'; end if;
  select count(*) into n from dulabs_catalogo_buscar(a, 'anillo', 'all', 'retail', 500, 0);
  if n <> 20 then raise exception 'FAIL 7d límite máximo 20'; end if;
  raise notice 'PASS 7 paginación, exclusión y límites';

  -- 8. Modo 'any' relaja: "aretes rubí" (rubí no existe) => 0 en 'all', resultados en 'any'.
  select count(*) into n from dulabs_catalogo_buscar(a, 'aretes rubí', 'all', 'retail', 20, 0);
  if n <> 0 then raise exception 'FAIL 8a all'; end if;
  select count(*) into n from dulabs_catalogo_buscar(a, 'aretes rubí', 'any', 'retail', 20, 0);
  if n < 2 then raise exception 'FAIL 8b any'; end if;
  raise notice 'PASS 8 modo estricto y relajado';

  -- 9. Rendimiento con ~2.000 productos (sin índice nuevo: el cálculo es por negocio).
  t0 := clock_timestamp();
  for i in 1..20 loop
    perform * from dulabs_catalogo_buscar(a, 'anillo plateado', 'all', 'retail', 5, 0);
  end loop;
  ms := extract(epoch from clock_timestamp() - t0) * 1000 / 20;
  if ms > 200 then raise exception 'FAIL 9 lento: % ms', round(ms, 1); end if;
  raise notice 'PASS 9 búsqueda sobre ~2.000 productos: % ms promedio', round(ms, 1);
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.dulabs_catalogo_buscar(uuid, text, text, text, integer, integer, text, text, text, uuid, bigint, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_catalogo_buscar(uuid, text, text, text, integer, integer, text, text, text, uuid, bigint, text[])', 'execute') then
    raise exception 'FAIL 10 anon/authenticated pueden ejecutar la búsqueda';
  end if;
  raise notice 'PASS 10 solo el backend (service_role) ejecuta la búsqueda';
end;
$$;
