-- CMS comercial — verificación de 20261211000000_dulabs_cms_pie_y_paginas.sql (el pie de página y las páginas propias de la tienda como tipos del CMS)
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO. Inserta datos ficticios. Nunca contra Supabase de producción.
-- Preparación (psql): la de 20261210000000_dulabs_cms_comercial.test.sql y luego, en este orden y dos veces cada una (idempotentes):
--   \i supabase/migrations/20261210000000_dulabs_cms_comercial.sql
--   \i supabase/migrations/20261211000000_dulabs_cms_pie_y_paginas.sql
--   \i supabase/tests/20261211000000_dulabs_cms_pie_y_paginas.test.sql
-- En el repositorio también corre dentro de `npm run test:flow` (lib/cms-comercial/pie-sql.pglite.test.ts) con Postgres embebido (PGlite).

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

-- ---------------------------------------------------------------------------
-- 1. Un pie por negocio, con su código fijo
-- ---------------------------------------------------------------------------
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  u constant uuid := 'dddddddd-0000-4000-8000-00000000000d';
  r jsonb;
begin
  r := public.dulabs_cms_crear(a, 'pie', 'pie', '{"mostrar_categorias":true,"columnas":[],"redes":[]}'::jsonb, u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok', 'crear: el pie es un tipo válido');
  perform pg_temp.afirmar(r->'entidad'->>'tipo' = 'pie' and r->'entidad'->>'clave' = 'pie' and r->'entidad'->>'estado' = 'borrador', 'crear: nace en borrador con su código fijo');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'pie', 'pie', '{}'::jsonb, u, 'Ana')->>'resultado' = 'clave_existente', 'crear: un solo pie por negocio');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'pie', 'otro', '{}'::jsonb, u, 'Ana')->>'resultado' = 'invalido', 'crear: el pie solo puede llamarse «pie»');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'pie', 'pie-de-pagina', '{}'::jsonb, u, 'Ana')->>'resultado' = 'invalido', 'crear: ni siquiera con un código con formato válido');
  perform pg_temp.afirmar(public.dulabs_cms_crear(b, 'pie', 'pie', '{}'::jsonb, u, 'Ana')->>'resultado' = 'ok', 'crear: otro negocio tiene el suyo');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'home', 'home', '{}'::jsonb, u, 'Ana')->>'resultado' = 'ok', 'lo anterior sigue igual: la página principal');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'galleta', 'x', '{}'::jsonb, u, 'Ana')->>'resultado' = 'invalido', 'lo anterior sigue igual: un tipo desconocido se rechaza');
  perform pg_temp.afirmar((select count(*) from public.dulabs_cms_entidades where tipo = 'pie') = 2, 'quedaron exactamente dos pies (uno por negocio)');
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
  ck constant text := repeat('e', 64);
  r jsonb;
  id_pie uuid;
  claves text[];
begin
  id_pie := (public.dulabs_cms_listar(a, 'pie') -> 0 ->> 'id')::uuid;
  perform pg_temp.afirmar(id_pie is not null, 'listar: el negocio ve su pie');
  perform pg_temp.afirmar((public.dulabs_cms_listar(b, 'pie') -> 0 ->> 'id')::uuid <> id_pie, 'listar: cada negocio ve el suyo');

  r := public.dulabs_cms_guardar_borrador(a, id_pie, '{"descripcion":"Joyas para ti","mostrar_categorias":true,"columnas":[],"redes":[]}'::jsonb, 1, u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and (r->'entidad'->>'rev')::int = 2, 'guardar borrador del pie');

  insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values (a, 'cms_comercial', true), (b, 'cms_comercial', true);
  claves := array(select e->>'clave' from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e order by 1);
  perform pg_temp.afirmar(not ('pie' = any (claves)), 'lectura: un pie en borrador NO sale a la tienda');

  r := public.dulabs_cms_publicar(a, id_pie, 2, 0, ck, 'Primer pie', u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and (r->>'version')::int = 1 and r->'entidad'->>'estado' = 'publicada', 'publicar el pie: versión 1');

  r := public.dulabs_cms_lectura_activa(a);
  claves := array(select e->>'clave' from jsonb_array_elements(r->'entidades') e order by 1);
  perform pg_temp.afirmar('pie' = any (claves), 'lectura: el pie publicado sale a la tienda');
  perform pg_temp.afirmar((select e->>'tipo' = 'pie' and e->'contenido'->>'descripcion' = 'Joyas para ti' from jsonb_array_elements(r->'entidades') e where e->>'clave' = 'pie'), 'lectura: entrega el contenido de la versión activa');
  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(public.dulabs_cms_lectura_activa(b)->'entidades') e where e->>'clave' = 'pie'), 'lectura: el otro negocio no recibe el pie del primero (el suyo sigue en borrador)');

  perform pg_temp.afirmar((select count(*) from public.dulabs_cms_auditoria where entidad_id = id_pie and entidad_tipo = 'pie') = 3, 'historial: crear, guardar borrador y publicar quedan registrados con el tipo «pie»');
  perform pg_temp.afirmar(public.dulabs_cms_pausar(a, id_pie, u, 'Ana')->>'resultado' = 'ok', 'pausar el pie');
  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e where e->>'clave' = 'pie'), 'lectura: un pie pausado vuelve al de siempre (no sale)');
  perform pg_temp.afirmar(public.dulabs_cms_reanudar(a, id_pie, u, 'Ana')->>'resultado' = 'ok', 'reanudar el pie');
  perform pg_temp.afirmar(public.dulabs_cms_despublicar(a, id_pie, u, 'Ana')->>'resultado' = 'ok', 'despublicar el pie');
  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e where e->>'clave' = 'pie'), 'lectura: un pie despublicado no sale');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Las páginas propias: varias por negocio, con el código de su dirección
-- ---------------------------------------------------------------------------
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  u constant uuid := 'dddddddd-0000-4000-8000-00000000000d';
  r jsonb;
begin
  r := public.dulabs_cms_crear(a, 'pagina', 'politica-de-privacidad', '{"titulo":"Política de privacidad","bloques":[]}'::jsonb, u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok', 'crear: la página es un tipo válido');
  perform pg_temp.afirmar(r->'entidad'->>'tipo' = 'pagina' and r->'entidad'->>'clave' = 'politica-de-privacidad' and r->'entidad'->>'estado' = 'borrador', 'crear: nace en borrador con el código de su dirección');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'pagina', 'terminos-y-condiciones', '{"titulo":"Términos","bloques":[]}'::jsonb, u, 'Ana')->>'resultado' = 'ok', 'crear: un negocio tiene varias páginas');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'pagina', 'politica-de-privacidad', '{}'::jsonb, u, 'Ana')->>'resultado' = 'clave_existente', 'crear: el código de una página no se repite en el negocio');
  perform pg_temp.afirmar(public.dulabs_cms_crear(b, 'pagina', 'politica-de-privacidad', '{"titulo":"Otra","bloques":[]}'::jsonb, u, 'Ana')->>'resultado' = 'ok', 'crear: otro negocio puede usar el mismo código');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'pagina', 'Política Mala', '{}'::jsonb, u, 'Ana')->>'resultado' = 'invalido', 'crear: un código con formato inválido se rechaza');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'pagina', 'pie', '{}'::jsonb, u, 'Ana')->>'resultado' = 'ok', 'crear: una página puede llamarse «pie» (la regla del código fijo es solo del tipo «pie»)');
  perform pg_temp.afirmar((select count(*) from public.dulabs_cms_entidades where tipo = 'pagina' and id_tenant = a) = 3, 'el negocio quedó con tres páginas');
  perform pg_temp.afirmar((select count(*) from public.dulabs_cms_entidades where tipo = 'pie' and id_tenant = a) = 1, 'y su pie sigue siendo uno solo');
end;
$$;

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  u constant uuid := 'dddddddd-0000-4000-8000-00000000000d';
  ck constant text := repeat('f', 64);
  r jsonb;
  id_pag uuid;
  rev int;
begin
  id_pag := (select id from public.dulabs_cms_entidades where id_tenant = a and tipo = 'pagina' and clave = 'politica-de-privacidad');
  perform pg_temp.afirmar(id_pag is not null, 'listar: el negocio ve su página');
  perform pg_temp.afirmar((select jsonb_array_length(public.dulabs_cms_listar(a, 'pagina'))) = 3, 'listar: por tipo, solo las páginas');

  r := public.dulabs_cms_guardar_borrador(a, id_pag, '{"titulo":"Política de privacidad","bloques":[{"tipo":"parrafo","texto":"Cuidamos tus datos."}]}'::jsonb, 1, u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok', 'guardar borrador de la página');
  rev := (r->'entidad'->>'rev')::int;

  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e where e->>'tipo' = 'pagina'), 'lectura: una página en borrador NO sale a la tienda');

  r := public.dulabs_cms_publicar(a, id_pag, rev, 0, ck, 'Primera versión', u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and (r->>'version')::int = 1 and r->'entidad'->>'estado' = 'publicada', 'publicar la página: versión 1');

  r := public.dulabs_cms_lectura_activa(a);
  perform pg_temp.afirmar((select count(*) from jsonb_array_elements(r->'entidades') e where e->>'tipo' = 'pagina') = 1, 'lectura: sale solo la página publicada (las otras dos siguen en borrador)');
  perform pg_temp.afirmar((select e->>'clave' = 'politica-de-privacidad' and e->'contenido'->'bloques'->0->>'texto' = 'Cuidamos tus datos.' from jsonb_array_elements(r->'entidades') e where e->>'tipo' = 'pagina'), 'lectura: entrega el contenido de la versión activa');
  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(public.dulabs_cms_lectura_activa(b)->'entidades') e where e->>'tipo' = 'pagina'), 'lectura: el otro negocio no recibe la página del primero');

  perform pg_temp.afirmar((select count(*) from public.dulabs_cms_auditoria where entidad_id = id_pag and entidad_tipo = 'pagina') = 3, 'historial: crear, guardar borrador y publicar quedan registrados con el tipo «pagina»');
  perform pg_temp.afirmar(public.dulabs_cms_pausar(a, id_pag, u, 'Ana')->>'resultado' = 'ok', 'pausar la página');
  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e where e->>'tipo' = 'pagina'), 'lectura: una página pausada no sale');
  perform pg_temp.afirmar(public.dulabs_cms_reanudar(a, id_pag, u, 'Ana')->>'resultado' = 'ok', 'reanudar la página');
  perform pg_temp.afirmar(public.dulabs_cms_despublicar(a, id_pag, u, 'Ana')->>'resultado' = 'ok', 'despublicar la página');
  perform pg_temp.afirmar(public.dulabs_cms_archivar(a, id_pag, u, 'Ana')->>'resultado' = 'ok', 'archivar la página (despublicada)');
  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e where e->>'tipo' = 'pagina'), 'lectura: una página despublicada y archivada no sale');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Las restricciones ampliadas
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.afirmar((select pg_get_constraintdef(oid) like '%''pie''%' and pg_get_constraintdef(oid) like '%''pagina''%' from pg_constraint where conname = 'dulabs_cms_entidades_tipo_ck'), 'la restricción de tipos incluye «pie» y «pagina»');
  perform pg_temp.afirmar((select pg_get_constraintdef(oid) like '%''pie''%' and pg_get_constraintdef(oid) like '%''pagina''%' from pg_constraint where conname = 'dulabs_cms_auditoria_tipo_ck'), 'la auditoría reconoce «pie» y «pagina»');
  perform pg_temp.afirmar((select pg_get_constraintdef(oid) like '%''imagen''%' from pg_constraint where conname = 'dulabs_cms_auditoria_tipo_ck'), 'la auditoría sigue reconociendo «imagen»');
  perform pg_temp.afirmar(exists (select 1 from pg_constraint where conname = 'dulabs_cms_entidades_pie_ck'), 'existe la regla de un solo código para el pie');
  perform pg_temp.afirmar(exists (select 1 from pg_constraint where conname = 'dulabs_cms_entidades_home_ck'), 'la regla de la página principal sigue');
end;
$$;
