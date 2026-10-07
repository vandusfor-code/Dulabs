-- CMS COMERCIAL (Bloque 29) — ESTADO de la migración de los textos de ARIA (Delacour), SOLO LECTURA. No cambia nada.
-- Corre en el SQL Editor de Supabase (una sentencia). Sirve ANTES y DESPUÉS de cada paso (04, 05, 06).
--
-- Una fila por tema de la tabla de migración (más las del perfil y una de herramientas):
--   en_el_prompt  si el texto sigue dentro del prompt de ARIA (negocio.conocimiento)
--   en_el_cms     no migrado · borrador · publicada · pausada · archivada   (publicada = ARIA lo consulta con las herramientas)
--   version       versión publicada (si hay)
--   fuente        prompt (solo en el prompt) · prompt+cms (en ambos: la etapa de verificación) · cms (solo en el CMS publicado) · sin texto
-- La última fila (herramientas) dice cuántas de las 4 herramientas comerciales están habilitadas para ARIA.
-- Si el CMS no está instalado, esta consulta falla con «relation does not exist»: es la respuesta.
--
-- GENERADO por el código (lib/cms-comercial/migracion-textos.ts): una prueba lo regenera y lo compara con este archivo. No se edita a mano.

with tienda as (
  select id_tenant from public.dulabs_catalogo_publicacion where slug = 'delacour'
),
aria as (
  select negocio, herramientas from public.dulabs_agente_runtime_config
   where id_tenant = (select id_tenant from tienda limit 1) and tipo = 'catalog_sales'
),
en_prompt as (
  select lower(btrim(regexp_replace(translate(t.k->>'tema', 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g'))) as n
    from aria, jsonb_array_elements(case when jsonb_typeof(aria.negocio->'conocimiento') = 'array' then aria.negocio->'conocimiento' else '[]'::jsonb end) as t(k)
),
cms as (
  select clave, estado, version_activa, archivada_at from public.dulabs_cms_entidades
   where id_tenant = (select id_tenant from tienda limit 1) and tipo = 'contenido'
),
mapa as (
  select * from (values
    ('Quiénes somos', 'quienes-somos', 10),
    ('Ubicación', 'ubicacion', 20),
    ('Horario', 'horario', 30),
    ('Líneas y materiales', 'lineas-y-materiales', 40),
    ('Dorado y plateado', 'dorado-y-plateado', 50),
    ('Colección Vida Eterna', 'coleccion-vida-eterna', 60),
    ('Servicios', 'servicios', 70),
    ('Catálogo', 'catalogo', 80),
    ('Precios y disponibilidad', 'precios-y-disponibilidad', 90),
    ('Regalos', 'regalos', 100),
    ('Hombre y mujer', 'hombre-y-mujer', 110),
    ('Venta al detal', 'venta-al-detal', 120),
    ('Venta al por mayor', 'venta-al-por-mayor', 130),
    ('Emprendimiento', 'emprendimiento', 140),
    ('Separar mercancía', 'separar-mercancia', 150),
    ('Envíos', 'envios', 160),
    ('Medios de pago', 'medios-de-pago', 170),
    ('Pago no identificado', 'pago-no-identificado', 180),
    ('Garantías', 'garantias', 190),
    ('Cambios y devoluciones', 'cambios-y-devoluciones', 200),
    ('Promociones', 'promociones', 210),
    ('Reclamos', 'reclamos', 220)
  ) as m(legado, clave, orden)
),
perfil as (
  select * from (values
    ('Despedida', 1000),
    ('Datos del pedido', 1001)
  ) as p(legado, orden)
)
select m.orden, m.legado as tema, m.clave,
       exists (select 1 from en_prompt p where p.n = lower(btrim(regexp_replace(translate(m.legado, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')))) as en_el_prompt,
       case when c.clave is null then 'no migrado' when c.archivada_at is not null then 'archivada' else c.estado end as en_el_cms,
       c.version_activa as version,
       case
         when exists (select 1 from en_prompt p where p.n = lower(btrim(regexp_replace(translate(m.legado, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')))) and c.estado = 'publicada' and c.archivada_at is null then 'prompt+cms'
         when exists (select 1 from en_prompt p where p.n = lower(btrim(regexp_replace(translate(m.legado, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')))) then 'prompt'
         when c.estado = 'publicada' and c.archivada_at is null then 'cms'
         else 'sin texto'
       end as fuente
  from mapa m left join cms c on c.clave = m.clave
union all
select p.orden, p.legado, null, exists (select 1 from en_prompt e where e.n = lower(btrim(regexp_replace(translate(p.legado, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')))), 'se queda en el perfil', null, 'prompt'
  from perfil p
union all
select 2000, 'herramientas comerciales', null, null,
       (select count(*) from unnest(array['consultar_ofertas', 'consultar_combos', 'consultar_campanas', 'consultar_contenido_comercial']::text[]) as h where h = any (coalesce((select herramientas from aria), array[]::text[])))::text || ' de 4 habilitadas', null, null
order by 1;
