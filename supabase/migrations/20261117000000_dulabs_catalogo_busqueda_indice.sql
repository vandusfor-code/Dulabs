-- DuLabs Catálogo — Bloque 20: búsqueda INDEXADA (rendimiento con miles de referencias).
--
-- Medición (scripts/perf, datos sintéticos, PostgreSQL 16 local): la búsqueda de texto completo
-- calculaba el documento de CADA producto del negocio en CADA consulta (sin índice):
--   2.000 productos  ≈ 100 ms por búsqueda  (50 simultáneas: 29/s)
--   10.000 productos ≈ 450 ms por búsqueda  (50 simultáneas: 9/s; "amplía" ≈ 1 s)
-- y la herramienta del agente resolve_product_by_attributes leía TODAS las claves del negocio
-- (10.000 productos ≈ 2,1 MB y 15 consultas por llamada).
--
-- Solución (sin infraestructura nueva: Postgres puro):
--   dulabs_catalogo_busqueda_doc   documento de búsqueda YA CALCULADO por producto (tsvector) +
--                                  clave normalizada del nombre; índice GIN y btree.
--                                  Tabla PROPIA del catálogo: no agrega columnas ni índices a la
--                                  tabla de productos compartida ni ensucia su auditoría.
--   triggers                       la mantienen sola en la misma transacción de cada escritura,
--                                  SOLO para negocios con el módulo Catálogo habilitado; al
--                                  habilitar el módulo se indexa ese negocio completo.
--   dulabs_catalogo_buscar         MISMA firma y MISMO resultado (orden: relevancia, disponibles,
--                                  recientes), ahora sobre el documento indexado.
--   dulabs_catalogo_por_nombre     nombre exacto (sin tildes/mayúsculas/espacios extra) por índice.
--
-- 100 % ADITIVO y sin cambiar datos: las funciones anteriores se reemplazan con la misma firma;
-- sin esta migración el código funciona igual que antes (lento con muchos productos).
--
-- Rollback:
--   drop trigger if exists dulabs_catalogo_busqueda_doc_producto on public.dulabs_inventario_productos;
--   drop trigger if exists dulabs_catalogo_busqueda_doc_modulo on public.dulabs_tenant_modulos;
--   drop function if exists public.dulabs_catalogo_por_nombre(uuid, text, integer);
--   drop function if exists public.dulabs_catalogo_busqueda_doc_producto();
--   drop function if exists public.dulabs_catalogo_busqueda_doc_modulo();
--   drop function if exists public.dulabs_catalogo_busqueda_indexar(uuid, uuid);
--   drop table if exists public.dulabs_catalogo_busqueda_doc;
--   y volver a correr dulabs_catalogo_buscar de 20261111000000_dulabs_catalogo_busqueda.sql.
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md).

begin;

-- Clave del nombre IGUAL a normalizeText() del backend: sin marcas diacríticas (NFD), minúsculas,
-- espacios colapsados. El backend vuelve a comparar exacto: la clave solo encuentra candidatos.
create or replace function public.dulabs_catalogo_clave_nombre(p_texto text)
returns text
language sql
immutable
parallel safe
as $$
  select btrim(regexp_replace(regexp_replace(normalize(lower(coalesce(p_texto, '')), NFD), '[̀-ͯ]', '', 'g'), '\s+', ' ', 'g'))
$$;

-- Documento de búsqueda completo (el mismo que armaba dulabs_catalogo_buscar en cada consulta).
create or replace function public.dulabs_catalogo_documento_busqueda(p_nombre text, p_color text, p_material text, p_descripcion text, p_categoria text)
returns tsvector
language sql
immutable
parallel safe
as $$
  select public.dulabs_catalogo_documento(p_nombre, p_color, p_material, p_descripcion)
      || setweight(to_tsvector('spanish'::regconfig, public.dulabs_catalogo_normalizar(coalesce(p_categoria, ''))), 'B')
$$;

create table if not exists public.dulabs_catalogo_busqueda_doc (
  producto_id uuid primary key,
  id_tenant uuid not null,
  activo boolean not null,
  clave_nombre text not null,
  documento tsvector not null,
  actualizado_at timestamptz not null default now(),
  constraint dulabs_catalogo_busqueda_doc_producto_fk foreign key (id_tenant, producto_id)
    references public.dulabs_inventario_productos (id_tenant, id) on delete cascade
);

create index if not exists dulabs_catalogo_busqueda_doc_gin on public.dulabs_catalogo_busqueda_doc using gin (documento);
create index if not exists dulabs_catalogo_busqueda_doc_tenant_idx on public.dulabs_catalogo_busqueda_doc (id_tenant) where activo;
create index if not exists dulabs_catalogo_busqueda_doc_nombre_idx on public.dulabs_catalogo_busqueda_doc (id_tenant, clave_nombre);

comment on table public.dulabs_catalogo_busqueda_doc is
  'Bloque 20 — índice de búsqueda del catálogo (documento tsvector y clave del nombre ya calculados). Lo mantienen triggers, solo para negocios con el módulo Catálogo. Solo service_role.';

alter table public.dulabs_catalogo_busqueda_doc enable row level security;
revoke all on table public.dulabs_catalogo_busqueda_doc from anon, authenticated;

-- (Re)indexa un producto o un negocio entero (producto null).
create or replace function public.dulabs_catalogo_busqueda_indexar(p_tenant uuid, p_producto uuid default null)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with filas as (
    insert into public.dulabs_catalogo_busqueda_doc (producto_id, id_tenant, activo, clave_nombre, documento, actualizado_at)
    select p.id, p.id_tenant, p.activo, public.dulabs_catalogo_clave_nombre(p.nombre),
           public.dulabs_catalogo_documento_busqueda(p.nombre, p.color, p.material, p.descripcion, coalesce(c.nombre, p.categoria)),
           now()
      from public.dulabs_inventario_productos p
      left join public.dulabs_catalogo_categorias c on c.id_tenant = p.id_tenant and c.id = p.categoria_id
     where p.id_tenant = p_tenant and (p_producto is null or p.id = p_producto)
    on conflict (producto_id) do update
      set activo = excluded.activo, clave_nombre = excluded.clave_nombre, documento = excluded.documento, actualizado_at = now()
    returning 1
  )
  select count(*)::integer from filas
$$;

create or replace function public.dulabs_catalogo_busqueda_doc_producto()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Solo negocios con el Catálogo: los demás módulos que comparten la tabla no se indexan.
  if exists (select 1 from public.dulabs_tenant_modulos m where m.id_tenant = new.id_tenant and m.modulo = 'catalogo' and m.habilitado) then
    perform public.dulabs_catalogo_busqueda_indexar(new.id_tenant, new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists dulabs_catalogo_busqueda_doc_producto on public.dulabs_inventario_productos;
create trigger dulabs_catalogo_busqueda_doc_producto
  after insert or update of nombre, color, material, descripcion, categoria, categoria_id, activo
  on public.dulabs_inventario_productos
  for each row execute function public.dulabs_catalogo_busqueda_doc_producto();

create or replace function public.dulabs_catalogo_busqueda_doc_modulo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.modulo = 'catalogo' and new.habilitado and (tg_op = 'INSERT' or not old.habilitado) then
    perform public.dulabs_catalogo_busqueda_indexar(new.id_tenant, null);
  end if;
  return null;
end;
$$;

drop trigger if exists dulabs_catalogo_busqueda_doc_modulo on public.dulabs_tenant_modulos;
create trigger dulabs_catalogo_busqueda_doc_modulo
  after insert or update of habilitado on public.dulabs_tenant_modulos
  for each row execute function public.dulabs_catalogo_busqueda_doc_modulo();

-- Indexa los negocios que YA tienen el Catálogo.
select public.dulabs_catalogo_busqueda_indexar(m.id_tenant, null)
  from public.dulabs_tenant_modulos m
 where m.modulo = 'catalogo' and m.habilitado;

-- Misma firma y mismo resultado que la versión del Bloque 10, sobre el documento indexado.
create or replace function public.dulabs_catalogo_buscar(
  p_tenant uuid,
  p_texto text,
  p_modo text default 'all',
  p_canal text default 'retail',
  p_limite integer default 5,
  p_offset integer default 0,
  p_categoria text default null,
  p_color text default null,
  p_material text default null,
  p_categoria_id uuid default null,
  p_precio_max bigint default null,
  p_excluir text[] default null
)
returns table (referencia text, relevancia real, total bigint)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_palabra text;
  v_parte tsquery;
  v_consulta tsquery;
  v_n integer := 0;
begin
  if p_tenant is null then
    raise exception 'dulabs_catalogo_buscar: negocio requerido' using errcode = '22023';
  end if;
  if p_modo not in ('all', 'any') or p_canal not in ('retail', 'wholesale') then
    raise exception 'dulabs_catalogo_buscar: modo o canal inválido' using errcode = '22023';
  end if;

  foreach v_palabra in array regexp_split_to_array(public.dulabs_catalogo_normalizar(left(coalesce(p_texto, ''), 120)), '[^a-z0-9ñ]+') loop
    continue when char_length(v_palabra) < 2;
    exit when v_n >= 8;
    v_parte := to_tsquery('spanish'::regconfig, v_palabra || ':*');
    continue when numnode(v_parte) = 0;
    v_consulta := case when v_consulta is null then v_parte when p_modo = 'all' then v_consulta && v_parte else v_consulta || v_parte end;
    v_n := v_n + 1;
  end loop;

  return query
  with base as (
    select p.referencia,
           p.created_at,
           p.id,
           (not coalesce(p.controla_stock, true) or p.stock > 0) as disponible,
           d.documento
      from public.dulabs_catalogo_busqueda_doc d
      join public.dulabs_inventario_productos p on p.id = d.producto_id and p.id_tenant = d.id_tenant
      left join public.dulabs_catalogo_categorias c
        on c.id_tenant = p.id_tenant and c.id = p.categoria_id
     where d.id_tenant = p_tenant
       and d.activo
       and p.activo
       and (v_consulta is null or d.documento @@ v_consulta)
       and (p_excluir is null or not (p.referencia = any (p_excluir)))
       and (p_categoria_id is null or p.categoria_id = p_categoria_id)
       and (p_categoria is null or public.dulabs_catalogo_normalizar(coalesce(c.nombre, p.categoria)) like '%' || public.dulabs_catalogo_normalizar(p_categoria) || '%')
       and (p_color is null or public.dulabs_catalogo_normalizar(p.color) like '%' || public.dulabs_catalogo_normalizar(p_color) || '%')
       and (p_material is null or public.dulabs_catalogo_normalizar(p.material) like '%' || public.dulabs_catalogo_normalizar(p_material) || '%')
       and (p_precio_max is null
            or (case when p_canal = 'wholesale' then p.precio_mayor else p.precio end) <= p_precio_max)
  )
  select b.referencia::text,
         (case when v_consulta is null then 0 else ts_rank_cd('{0.1, 0.2, 0.6, 1.0}', b.documento, v_consulta) end)::real,
         count(*) over ()
    from base b
   order by 2 desc, b.disponible desc, b.created_at desc, b.id desc
   limit least(greatest(coalesce(p_limite, 5), 1), 20)
  offset least(greatest(coalesce(p_offset, 0), 0), 200);
end;
$$;

-- Productos de UN negocio cuyo nombre es IGUAL (clave normalizada). El backend filtra el resto.
create or replace function public.dulabs_catalogo_por_nombre(p_tenant uuid, p_nombre text, p_limite integer default 60)
returns table (referencia text)
language sql
stable
set search_path = public, pg_temp
as $$
  select p.referencia::text
    from public.dulabs_catalogo_busqueda_doc d
    join public.dulabs_inventario_productos p on p.id = d.producto_id and p.id_tenant = d.id_tenant
   where d.id_tenant = p_tenant
     and d.clave_nombre = public.dulabs_catalogo_clave_nombre(p_nombre)
   order by p.referencia
   limit least(greatest(coalesce(p_limite, 60), 1), 200)
$$;

revoke all on function public.dulabs_catalogo_clave_nombre(text) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_documento_busqueda(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_busqueda_indexar(uuid, uuid) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_busqueda_doc_producto() from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_busqueda_doc_modulo() from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_buscar(uuid, text, text, text, integer, integer, text, text, text, uuid, bigint, text[]) from public, anon, authenticated;
revoke all on function public.dulabs_catalogo_por_nombre(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.dulabs_catalogo_buscar(uuid, text, text, text, integer, integer, text, text, text, uuid, bigint, text[]) to service_role;
grant execute on function public.dulabs_catalogo_por_nombre(uuid, text, integer) to service_role;

commit;
