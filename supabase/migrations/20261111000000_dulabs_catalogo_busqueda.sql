-- DuLabs — Bloque 10: búsqueda del catálogo para el agente (escala a miles de referencias).
--
-- 100 % ADITIVO. No agrega columnas a dulabs_inventario_productos (tabla compartida
-- con AMORE) ni cambia la tienda pública: solo funciones nuevas. Sin esta migración
-- el agente sigue usando la búsqueda anterior (el nombre CONTIENE el texto).
--
--   dulabs_catalogo_normalizar(text)   minúsculas + sin tildes (conserva la ñ).
--   dulabs_catalogo_documento(...)     tsvector en español: nombre (A), color/material (B),
--                                      descripción (C). IMMUTABLE.
--   dulabs_catalogo_buscar(...)        búsqueda de texto completo de UN negocio:
--       - español: plurales y singulares ("arete" ~ "aretes"), sin tildes, prefijos
--         ("dora" encuentra "dorado"); también el nombre de la categoría (B);
--       - modo 'all' (todas las palabras) o 'any' (alguna, para relajar);
--       - filtros en SQL: categoría, color, material, precio máximo DEL CANAL;
--       - excluir referencias (similares / otros), productos activos solamente;
--       - orden: relevancia, disponibles primero, más recientes;
--       - paginación (límite 1..20, offset 0..200) y total.
--   Devuelve SOLO referencias, relevancia y total: el backend resuelve precio, stock,
--   foto y disponibilidad con la resolución existente (una sola fuente de verdad).
--
-- Solo el backend (service_role) puede ejecutarla. El negocio es un parámetro que
-- pone el backend a partir del número de WhatsApp: nunca lo decide el modelo.
--
-- Rollback:
--   drop function if exists public.dulabs_catalogo_buscar(uuid, text, text, text, integer, integer, text, text, text, uuid, bigint, text[]);
--   drop function if exists public.dulabs_catalogo_documento(text, text, text, text);
--   drop function if exists public.dulabs_catalogo_normalizar(text);
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md).

begin;

create or replace function public.dulabs_catalogo_normalizar(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  -- Igual que dulabs_ba_unaccent (Business Agent), sin depender de esa migración:
  -- translate() no depende de la collation; después lower() solo toca ASCII.
  select lower(translate(coalesce(p_text, ''),
    'áéíóúüàèìòùâêîôûÁÉÍÓÚÜÀÈÌÒÙÂÊÎÔÛÑ',
    'aeiouuaeiouaeiouAEIOUUAEIOUAEIOUñ'))
$$;

create or replace function public.dulabs_catalogo_documento(p_nombre text, p_color text, p_material text, p_descripcion text)
returns tsvector
language sql
immutable
parallel safe
as $$
  select setweight(to_tsvector('spanish'::regconfig, public.dulabs_catalogo_normalizar(p_nombre)), 'A')
      || setweight(to_tsvector('spanish'::regconfig, public.dulabs_catalogo_normalizar(coalesce(p_color, '') || ' ' || coalesce(p_material, ''))), 'B')
      || setweight(to_tsvector('spanish'::regconfig, public.dulabs_catalogo_normalizar(left(coalesce(p_descripcion, ''), 2000))), 'C')
$$;

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

  -- Consulta: cada palabra (máx. 8) como prefijo en español; las vacías/"de"/"con" se descartan solas.
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
           public.dulabs_catalogo_documento(p.nombre, p.color, p.material, p.descripcion)
             || setweight(to_tsvector('spanish'::regconfig, public.dulabs_catalogo_normalizar(coalesce(c.nombre, p.categoria))), 'B') as documento
      from public.dulabs_inventario_productos p
      left join public.dulabs_catalogo_categorias c
        on c.id_tenant = p.id_tenant and c.id = p.categoria_id
     where p.id_tenant = p_tenant
       and p.activo
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
   where v_consulta is null or b.documento @@ v_consulta
   order by 2 desc, b.disponible desc, b.created_at desc, b.id desc
   limit least(greatest(coalesce(p_limite, 5), 1), 20)
  offset least(greatest(coalesce(p_offset, 0), 0), 200);
end;
$$;

comment on function public.dulabs_catalogo_buscar(uuid, text, text, text, integer, integer, text, text, text, uuid, bigint, text[]) is
  'Bloque 10 — búsqueda de texto completo (español, sin tildes, prefijos) del catálogo de UN negocio para el agente: filtros y precio del canal en SQL, paginada. Solo referencias; el backend resuelve precio/stock/foto. Solo service_role.';

revoke all on function public.dulabs_catalogo_buscar(uuid, text, text, text, integer, integer, text, text, text, uuid, bigint, text[]) from public, anon, authenticated;
grant execute on function public.dulabs_catalogo_buscar(uuid, text, text, text, integer, integer, text, text, text, uuid, bigint, text[]) to service_role;

commit;
