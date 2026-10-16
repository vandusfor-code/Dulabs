-- CMS comercial — verificación de 20261212000000_dulabs_cms_multimedia.sql (las fotos y videos del inicio como tipo del CMS, y los videos MP4 como archivos)
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO. Inserta datos ficticios. Nunca contra Supabase de producción.
-- Preparación (psql): la de 20261210000000_dulabs_cms_comercial.test.sql y luego, en este orden y dos veces cada una (idempotentes):
--   \i supabase/migrations/20261210000000_dulabs_cms_comercial.sql
--   \i supabase/migrations/20261211000000_dulabs_cms_pie_y_paginas.sql
--   \i supabase/migrations/20261212000000_dulabs_cms_multimedia.sql
--   \i supabase/tests/20261212000000_dulabs_cms_multimedia.test.sql
-- En el repositorio también corre dentro de `npm run test:flow` (lib/cms-comercial/multimedia-sql.pglite.test.ts) con Postgres embebido (PGlite).

\set ON_ERROR_STOP 1

create or replace function pg_temp.afirmar(p_ok boolean, p_mensaje text)
returns void
language plpgsql
as $$
begin
  if p_ok is not true then
    raise exception 'FALLÓ: %', p_mensaje;
  end if;
end;
$$;

insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado)
values ('aaaaaaaa-0000-4000-8000-00000000000a', 'cms_comercial', true), ('bbbbbbbb-0000-4000-8000-00000000000b', 'cms_comercial', true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. Un elemento «fotos y videos» por negocio, con su código fijo
-- ---------------------------------------------------------------------------
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  u constant uuid := 'dddddddd-0000-4000-8000-00000000000d';
  r jsonb;
begin
  r := public.dulabs_cms_crear(a, 'multimedia', 'multimedia', '{}'::jsonb, u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok', 'crear: «multimedia» es un tipo válido');
  perform pg_temp.afirmar(r->'entidad'->>'tipo' = 'multimedia' and r->'entidad'->>'clave' = 'multimedia' and r->'entidad'->>'estado' = 'borrador', 'crear: nace en borrador con su código fijo');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'multimedia', 'multimedia', '{}'::jsonb, u, 'Ana')->>'resultado' = 'clave_existente', 'crear: uno solo por negocio');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'multimedia', 'otro', '{}'::jsonb, u, 'Ana')->>'resultado' = 'invalido', 'crear: solo puede llamarse «multimedia»');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'multimedia', 'fotos-y-videos', '{}'::jsonb, u, 'Ana')->>'resultado' = 'invalido', 'crear: ni siquiera con un código con formato válido');
  perform pg_temp.afirmar(public.dulabs_cms_crear(b, 'multimedia', 'multimedia', '{}'::jsonb, u, 'Ana')->>'resultado' = 'ok', 'crear: otro negocio tiene el suyo');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'pie', 'pie', '{}'::jsonb, u, 'Ana')->>'resultado' = 'ok', 'lo anterior sigue igual: el pie');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'pagina', 'politica-de-privacidad', '{}'::jsonb, u, 'Ana')->>'resultado' = 'ok', 'lo anterior sigue igual: las páginas');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'galleta', 'x', '{}'::jsonb, u, 'Ana')->>'resultado' = 'invalido', 'lo anterior sigue igual: un tipo desconocido se rechaza');
  perform pg_temp.afirmar((select count(*) from public.dulabs_cms_entidades where tipo = 'multimedia') = 2, 'quedaron exactamente dos (uno por negocio)');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. El mismo ciclo que los demás tipos: guardar, publicar, historial, lectura pública
-- ---------------------------------------------------------------------------
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  u constant uuid := 'dddddddd-0000-4000-8000-00000000000d';
  ck constant text := repeat('d', 64);
  r jsonb;
  id_m uuid;
begin
  id_m := (public.dulabs_cms_listar(a, 'multimedia') -> 0 ->> 'id')::uuid;
  perform pg_temp.afirmar(id_m is not null, 'listar: el negocio ve sus fotos y videos');
  perform pg_temp.afirmar((public.dulabs_cms_listar(b, 'multimedia') -> 0 ->> 'id')::uuid <> id_m, 'listar: cada negocio ve lo suyo');

  r := public.dulabs_cms_guardar_borrador(a, id_m, '{"categorias":[]}'::jsonb, 1, u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and (r->'entidad'->>'rev')::int = 2, 'guardar borrador');
  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e where e->>'tipo' = 'multimedia'), 'lectura: en borrador NO sale a la tienda');

  r := public.dulabs_cms_publicar(a, id_m, 2, 0, ck, 'Primera versión', u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and (r->>'version')::int = 1 and r->'entidad'->>'estado' = 'publicada', 'publicar: versión 1');
  perform pg_temp.afirmar((select count(*) from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e where e->>'tipo' = 'multimedia' and e->>'clave' = 'multimedia') = 1, 'lectura: lo publicado sale a la tienda');
  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(public.dulabs_cms_lectura_activa(b)->'entidades') e where e->>'tipo' = 'multimedia'), 'lectura: el otro negocio no recibe lo del primero');
  perform pg_temp.afirmar((select count(*) from public.dulabs_cms_auditoria where entidad_id = id_m and entidad_tipo = 'multimedia') = 3, 'historial: crear, guardar borrador y publicar quedan registrados con el tipo «multimedia»');
  perform pg_temp.afirmar(public.dulabs_cms_pausar(a, id_m, u, 'Ana')->>'resultado' = 'ok', 'pausar');
  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e where e->>'tipo' = 'multimedia'), 'lectura: pausado no sale (vuelven los originales)');
  perform pg_temp.afirmar(public.dulabs_cms_reanudar(a, id_m, u, 'Ana')->>'resultado' = 'ok', 'reanudar');
  perform pg_temp.afirmar(public.dulabs_cms_despublicar(a, id_m, u, 'Ana')->>'resultado' = 'ok', 'despublicar');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Los videos como archivos del CMS
-- ---------------------------------------------------------------------------
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  u constant uuid := 'dddddddd-0000-4000-8000-00000000000d';
  v constant uuid := 'e0000000-0000-4000-8000-0000000000e1';
  w constant uuid := 'e0000000-0000-4000-8000-0000000000e2';
  x constant uuid := 'e0000000-0000-4000-8000-0000000000e3';
  r jsonb;
begin
  r := public.dulabs_cms_asset_crear(a, v, a::text || '/cms/' || v::text || '/video.mp4', 'video/mp4', 1500000, 1280, 720, 'portada.mp4', u);
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and r->'asset'->>'mime_type' = 'video/mp4' and r->'asset'->>'estado' = 'pendiente', 'asset: un video MP4 se registra como pendiente');
  perform pg_temp.afirmar(public.dulabs_cms_asset_crear(a, w, a::text || '/cms/' || w::text || '/video.webm', 'video/webm', 1500000, 1280, 720, 'otro.webm', u)->>'resultado' = 'invalido', 'asset: otro formato de video (WebM) se rechaza');
  perform pg_temp.afirmar(public.dulabs_cms_asset_crear(a, w, a::text || '/cms/' || w::text || '/video.mov', 'video/quicktime', 1500000, 1280, 720, 'otro.mov', u)->>'resultado' = 'invalido', 'asset: QuickTime se rechaza (el servidor entrega siempre MP4)');
  perform pg_temp.afirmar(public.dulabs_cms_asset_crear(a, w, a::text || '/cms/' || w::text || '/imagen.webp', 'image/webp', 50000, 1280, 720, 'poster.webp', u)->>'resultado' = 'ok', 'lo anterior sigue igual: una imagen WebP');
  perform pg_temp.afirmar(public.dulabs_cms_asset_crear(a, x, a::text || '/cms/' || x::text || '/video.mp4', 'video/mp4', 11000000, 1280, 720, 'enorme.mp4', u)->>'resultado' = 'invalido', 'asset: sigue el tope de 10 MB por archivo');
  perform pg_temp.afirmar(public.dulabs_cms_asset_crear(a, x, 'otra-ruta/' || x::text || '/video.mp4', 'video/mp4', 1000, 1280, 720, 'fuera.mp4', u)->>'resultado' = 'invalido', 'asset: la ruta sigue estando bajo la carpeta del negocio');
  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'assets') e where e->>'id' = v::text), 'lectura: un video pendiente no sale');

  r := public.dulabs_cms_asset_confirmar(a, v, 1400000, 1280, 720, u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and r->'asset'->>'estado' = 'listo' and (r->'asset'->>'bytes')::int = 1400000, 'asset: al confirmar queda listo con su peso real');
  perform pg_temp.afirmar((select e->>'mime_type' = 'video/mp4' from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'assets') e where e->>'id' = v::text), 'lectura: un video listo sale con su tipo');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Las restricciones ampliadas
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.afirmar((select pg_get_constraintdef(oid) like '%''multimedia''%' and pg_get_constraintdef(oid) like '%''pagina''%' and pg_get_constraintdef(oid) like '%''pie''%' from pg_constraint where conname = 'dulabs_cms_entidades_tipo_ck'), 'la restricción de tipos incluye «multimedia» y conserva «pie» y «pagina»');
  perform pg_temp.afirmar((select pg_get_constraintdef(oid) like '%''multimedia''%' and pg_get_constraintdef(oid) like '%''imagen''%' from pg_constraint where conname = 'dulabs_cms_auditoria_tipo_ck'), 'la auditoría reconoce «multimedia» y sigue reconociendo «imagen»');
  perform pg_temp.afirmar((select pg_get_constraintdef(oid) like '%video/mp4%' and pg_get_constraintdef(oid) like '%image/webp%' and pg_get_constraintdef(oid) like '%image/jpeg%' and pg_get_constraintdef(oid) like '%image/png%' from pg_constraint where conname = 'dulabs_cms_assets_mime_ck'), 'los archivos admiten video/mp4 y siguen admitiendo las imágenes');
  perform pg_temp.afirmar(exists (select 1 from pg_constraint where conname = 'dulabs_cms_entidades_multimedia_ck'), 'existe la regla del código fijo');
  perform pg_temp.afirmar(exists (select 1 from pg_constraint where conname = 'dulabs_cms_entidades_pie_ck') and exists (select 1 from pg_constraint where conname = 'dulabs_cms_entidades_home_ck'), 'las reglas del pie y de la página principal siguen');
end;
$$;
