-- CMS comercial (Bloque 29) — verificación de 20261210000000_dulabs_cms_comercial.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO. Inserta datos ficticios. Nunca contra Supabase de producción.
-- Preparación (psql): igual que Supabase, con los roles y los privilegios por defecto de las tablas nuevas:
--   create role anon; create role authenticated; create role service_role bypassrls;
--   grant usage on schema public to anon, authenticated, service_role;
--   alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
--   alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
--   alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
--   create table public.dulabs_tenant_modulos (id_tenant uuid not null, modulo text not null, habilitado boolean not null default true, primary key (id_tenant, modulo));
--   \i supabase/migrations/20261210000000_dulabs_cms_comercial.sql   (dos veces: idempotente)
--   \i supabase/tests/20261210000000_dulabs_cms_comercial.test.sql
-- En el repositorio también corre dentro de `npm run test:flow` (lib/cms-comercial/sql.pglite.test.ts) con Postgres embebido (PGlite).

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
-- 1. Estructura y seguridad
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.afirmar((select count(*) from pg_class where relkind = 'r' and relrowsecurity and relname in ('dulabs_cms_entidades', 'dulabs_cms_versiones', 'dulabs_cms_auditoria', 'dulabs_cms_assets')) = 4,
                          'RLS habilitada en las 4 tablas');
  perform pg_temp.afirmar(not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'dulabs_cms_%'), 'sin políticas: solo service_role');
  perform pg_temp.afirmar((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'dulabs\_cms\_%') >= 24, 'las funciones existen');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Crear, guardar borrador, publicar (flujo feliz + controles optimistas + aislamiento)
-- ---------------------------------------------------------------------------
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  u constant uuid := 'dddddddd-0000-4000-8000-00000000000d';
  ck1 constant text := repeat('a', 64);
  ck2 constant text := repeat('b', 64);
  r jsonb;
  v_id uuid;
  id_b uuid;
begin
  -- crear
  r := public.dulabs_cms_crear(a, 'oferta', 'amor', '{"nombre":"Amor 15%"}'::jsonb, u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok', 'crear: ok');
  v_id := (r->'entidad'->>'id')::uuid;
  perform pg_temp.afirmar(r->'entidad'->>'estado' = 'borrador' and (r->'entidad'->>'rev')::int = 1 and r->'entidad'->'version_activa' = 'null'::jsonb, 'crear: nace en borrador, rev 1, sin versión activa');
  perform pg_temp.afirmar(r->'entidad'->'borrador' = '{"nombre":"Amor 15%"}'::jsonb, 'crear: guarda el borrador');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'oferta', 'amor', '{"nombre":"otra"}'::jsonb, u, 'Ana')->>'resultado' = 'clave_existente', 'crear: el código se repite en el mismo negocio y tipo');
  perform pg_temp.afirmar(public.dulabs_cms_crear(b, 'oferta', 'amor', '{"nombre":"x"}'::jsonb, u, 'Ana')->>'resultado' = 'ok', 'crear: el mismo código en OTRO negocio es válido');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'combo', 'amor', '{"nombre":"x"}'::jsonb, u, 'Ana')->>'resultado' = 'ok', 'crear: el mismo código en otro tipo es válido');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'galleta', 'x', '{}'::jsonb, u, 'Ana')->>'resultado' = 'invalido', 'crear: tipo desconocido');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'oferta', 'Con Mayúsculas', '{}'::jsonb, u, 'Ana')->>'resultado' = 'invalido', 'crear: código con formato inválido');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'home', 'otra', '{}'::jsonb, u, 'Ana')->>'resultado' = 'invalido', 'crear: la página principal solo puede llamarse «home»');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'home', 'home', '{"portada":{}}'::jsonb, u, 'Ana')->>'resultado' = 'ok', 'crear: página principal');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'home', 'home', '{}'::jsonb, u, 'Ana')->>'resultado' = 'clave_existente', 'crear: una sola página principal por negocio');
  perform pg_temp.afirmar(public.dulabs_cms_crear(a, 'oferta', 'sin-borrador', null, u, 'Ana')->>'resultado' = 'invalido', 'crear: sin contenido');

  -- guardar borrador
  r := public.dulabs_cms_guardar_borrador(a, v_id, '{"nombre":"Amor 20%"}'::jsonb, 1, u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and (r->'entidad'->>'rev')::int = 2 and r->'entidad'->'borrador' = '{"nombre":"Amor 20%"}'::jsonb, 'guardar: reemplaza el borrador y sube rev');
  r := public.dulabs_cms_guardar_borrador(a, v_id, '{"nombre":"pisado"}'::jsonb, 1, u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'conflicto' and (r->>'rev')::int = 2, 'guardar: con rev vieja hay conflicto y NO pisa');
  perform pg_temp.afirmar((public.dulabs_cms_obtener(a, v_id))->'borrador' = '{"nombre":"Amor 20%"}'::jsonb, 'guardar: el conflicto no cambió nada');
  perform pg_temp.afirmar(public.dulabs_cms_guardar_borrador(b, v_id, '{"x":1}'::jsonb, 2, u, 'Ana')->>'resultado' = 'no_encontrada', 'guardar: un elemento de otro negocio no existe');
  perform pg_temp.afirmar(public.dulabs_cms_guardar_borrador(a, v_id, jsonb_build_object('texto', repeat('x', 270000)), 2, u, 'Ana')->>'resultado' = 'invalido', 'guardar: un borrador gigante se rechaza');
  perform pg_temp.afirmar((select antes = '{"nombre":"Amor 15%"}'::jsonb and despues = '{"nombre":"Amor 20%"}'::jsonb from public.dulabs_cms_auditoria where entidad_id = v_id and accion = 'editar_borrador'), 'guardar: la auditoría guarda valor anterior y nuevo');

  -- publicar
  perform pg_temp.afirmar(public.dulabs_cms_publicar(a, v_id, 1, 0, ck1, null, u, 'Ana')->>'resultado' = 'conflicto', 'publicar: con rev vieja hay conflicto');
  perform pg_temp.afirmar(public.dulabs_cms_publicar(a, v_id, 2, 5, ck1, null, u, 'Ana')->>'resultado' = 'conflicto', 'publicar: con versión esperada distinta hay conflicto');
  perform pg_temp.afirmar(public.dulabs_cms_publicar(b, v_id, 2, 0, ck1, null, u, 'Ana')->>'resultado' = 'no_encontrada', 'publicar: un elemento de otro negocio no existe');
  perform pg_temp.afirmar(public.dulabs_cms_publicar(a, v_id, 2, 0, 'no-es-sha256', null, u, 'Ana')->>'resultado' = 'invalido', 'publicar: checksum con formato inválido');
  perform pg_temp.afirmar((select estado = 'borrador' and version_activa is null and rev = 2 and borrador is not null from public.dulabs_cms_entidades where id = v_id), 'publicar: un intento inválido no cambia nada');
  perform pg_temp.afirmar((select count(*) from public.dulabs_cms_versiones where entidad_id = v_id) = 0, 'publicar: un intento inválido no deja versión');
  r := public.dulabs_cms_publicar(a, v_id, 2, 0, ck1, 'Primera publicación', u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and (r->>'version')::int = 1, 'publicar: ok, versión 1');
  perform pg_temp.afirmar(r->'entidad'->>'estado' = 'publicada' and (r->'entidad'->>'version_activa')::int = 1 and r->'entidad'->'borrador' = 'null'::jsonb and (r->'entidad'->>'rev')::int = 3, 'publicar: queda publicada, sin borrador pendiente');
  perform pg_temp.afirmar(r->'entidad'->'contenido_activo' = '{"nombre":"Amor 20%"}'::jsonb, 'publicar: el contenido activo es el borrador validado');
  perform pg_temp.afirmar(public.dulabs_cms_publicar(a, v_id, 3, 1, ck1, null, u, 'Ana')->>'resultado' = 'sin_cambios', 'publicar: sin borrador pendiente no hay nada que publicar');

  -- editar de nuevo: lo publicado NO cambia hasta publicar
  perform pg_temp.afirmar(public.dulabs_cms_guardar_borrador(a, v_id, '{"nombre":"Amor 25%"}'::jsonb, 3, u, 'Ana')->>'resultado' = 'ok', 'editar sobre lo publicado');
  perform pg_temp.afirmar((public.dulabs_cms_obtener(a, v_id))->'contenido_activo' = '{"nombre":"Amor 20%"}'::jsonb, 'el borrador NO toca lo publicado');
  r := public.dulabs_cms_publicar(a, v_id, 4, 1, ck2, 'Sube a 25', u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and (r->>'version')::int = 2, 'publicar: versión 2');
  perform pg_temp.afirmar((select antes = '{"nombre":"Amor 20%"}'::jsonb and despues = '{"nombre":"Amor 25%"}'::jsonb and version = 2 and nota = 'Sube a 25' and actor_etiqueta = 'Ana' and actor_user_id = u
                             from public.dulabs_cms_auditoria where entidad_id = v_id and accion = 'publicar' order by id desc limit 1), 'publicar: auditoría 20 → 25 con versión, nota y actor');
  perform pg_temp.afirmar((select count(*) from public.dulabs_cms_versiones where entidad_id = v_id) = 2, 'publicar: dos versiones en el historial');

  -- el otro negocio no ve nada de esto
  id_b := (public.dulabs_cms_listar(b, 'oferta') -> 0 ->> 'id')::uuid;
  perform pg_temp.afirmar(id_b is not null and id_b <> v_id, 'listar: cada negocio ve lo suyo');
  perform pg_temp.afirmar(public.dulabs_cms_obtener(b, v_id) is null, 'obtener: el negocio B no ve el elemento de A');
  perform pg_temp.afirmar((public.dulabs_cms_versiones_listar(b, v_id)) = '[]'::jsonb, 'versiones: el negocio B no ve las de A');
  perform pg_temp.afirmar((public.dulabs_cms_auditoria_listar(b, v_id)) = '[]'::jsonb, 'auditoría: el negocio B no ve la de A');
  perform pg_temp.afirmar(public.dulabs_cms_version(b, v_id, 1) is null, 'versión: el negocio B no ve una versión de A');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Lectura pública: SOLO publicadas, con versión activa, módulo habilitado, sin archivadas ni pausadas
-- ---------------------------------------------------------------------------
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  c constant uuid := 'cccccccc-0000-4000-8000-00000000000c';
  u constant uuid := 'dddddddd-0000-4000-8000-00000000000d';
  ck constant text := repeat('c', 64);
  r jsonb;
  id_pub uuid;
  id_pausada uuid;
  id_borrador uuid;
  id_archivada uuid;
  claves text[];
begin
  -- Módulo apagado: nada, aunque haya publicado.
  perform pg_temp.afirmar((public.dulabs_cms_lectura_activa(a))->>'habilitado' = 'false', 'lectura: sin el módulo habilitado no hay nada');
  perform pg_temp.afirmar(jsonb_array_length(public.dulabs_cms_lectura_activa(a)->'entidades') = 0, 'lectura: sin módulo no hay entidades aunque existan publicadas');
  insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values (a, 'cms_comercial', true), (b, 'cms_comercial', false);

  r := public.dulabs_cms_lectura_activa(a);
  claves := array(select e->>'clave' from jsonb_array_elements(r->'entidades') e order by 1);
  perform pg_temp.afirmar(r->>'habilitado' = 'true' and claves = array['amor'], 'lectura: solo la oferta publicada («amor»); el borrador de combo y la home en borrador NO salen');
  perform pg_temp.afirmar((r->'entidades'->0->>'version')::int = 2 and r->'entidades'->0->'contenido' = '{"nombre":"Amor 25%"}'::jsonb, 'lectura: entrega la versión ACTIVA, no el borrador');
  perform pg_temp.afirmar(r->'entidades'->0->>'checksum' = repeat('b', 64), 'lectura: entrega el checksum de la versión');

  -- Pausada, borrador y archivada no salen.
  id_pausada := (public.dulabs_cms_crear(a, 'oferta', 'pausada', '{"nombre":"P"}'::jsonb, u, 'Ana')->'entidad'->>'id')::uuid;
  perform public.dulabs_cms_publicar(a, id_pausada, 1, 0, ck, null, u, 'Ana');
  id_borrador := (public.dulabs_cms_crear(a, 'oferta', 'solo-borrador', '{"nombre":"B"}'::jsonb, u, 'Ana')->'entidad'->>'id')::uuid;
  id_archivada := (public.dulabs_cms_crear(a, 'oferta', 'archivada', '{"nombre":"A"}'::jsonb, u, 'Ana')->'entidad'->>'id')::uuid;
  perform pg_temp.afirmar(public.dulabs_cms_archivar(a, id_archivada, u, 'Ana')->>'resultado' = 'ok', 'archivar un borrador');
  claves := array(select e->>'clave' from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e order by 1);
  perform pg_temp.afirmar(claves = array['amor', 'pausada'], 'lectura: publicadas = amor y pausada (aún en vivo)');
  perform pg_temp.afirmar(public.dulabs_cms_pausar(a, id_pausada, u, 'Ana')->>'resultado' = 'ok', 'pausar');
  claves := array(select e->>'clave' from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e order by 1);
  perform pg_temp.afirmar(claves = array['amor'], 'lectura: una oferta PAUSADA deja de salir al instante');
  perform pg_temp.afirmar(public.dulabs_cms_reanudar(a, id_pausada, u, 'Ana')->>'resultado' = 'ok', 'reanudar');
  claves := array(select e->>'clave' from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e order by 1);
  perform pg_temp.afirmar(claves = array['amor', 'pausada'], 'lectura: reanudada vuelve a salir');
  perform pg_temp.afirmar(public.dulabs_cms_despublicar(a, id_pausada, u, 'Ana')->>'resultado' = 'ok', 'despublicar');
  claves := array(select e->>'clave' from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e order by 1);
  perform pg_temp.afirmar(claves = array['amor'], 'lectura: despublicada no sale');

  -- Otro negocio, con módulo apagado o sin fila: nada de A.
  perform pg_temp.afirmar(jsonb_array_length(public.dulabs_cms_lectura_activa(b)->'entidades') = 0 and public.dulabs_cms_lectura_activa(b)->>'habilitado' = 'false', 'lectura: módulo apagado en B');
  perform pg_temp.afirmar(public.dulabs_cms_lectura_activa(c)->>'habilitado' = 'false', 'lectura: negocio sin fila de módulo');
  insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values (b, 'cms_comercial', true) on conflict (id_tenant, modulo) do update set habilitado = true;
  perform pg_temp.afirmar(jsonb_array_length(public.dulabs_cms_lectura_activa(b)->'entidades') = 0, 'lectura: B habilitado no recibe lo publicado por A');
  perform pg_temp.afirmar(public.dulabs_cms_lectura_activa(null)->>'habilitado' = 'false', 'lectura: negocio nulo');
end;
$$;

-- Defensa en profundidad: una restricción impide archivar lo que está en vivo; aun así, si alguien la saltara, la lectura pública jamás entrega un archivado.
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  v_id uuid;
  claves text[];
begin
  select e.id into v_id from public.dulabs_cms_entidades e where e.id_tenant = a and e.clave = 'amor' and e.tipo = 'oferta';
  perform pg_temp.afirmar(v_id is not null and (select estado from public.dulabs_cms_entidades where id = v_id) = 'publicada', 'prerrequisito: «amor» está publicada');
  alter table public.dulabs_cms_entidades drop constraint dulabs_cms_entidades_archivada_ck;
  update public.dulabs_cms_entidades set archivada_at = now() where id = v_id;
  claves := array(select e->>'clave' from jsonb_array_elements(public.dulabs_cms_lectura_activa(a)->'entidades') e order by 1);
  update public.dulabs_cms_entidades set archivada_at = null where id = v_id;
  alter table public.dulabs_cms_entidades add constraint dulabs_cms_entidades_archivada_ck check (archivada_at is null or estado = 'borrador');
  perform pg_temp.afirmar(not ('amor' = any(claves)), 'lectura: un archivado jamás se entrega, aunque estuviera marcado como publicado');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Estados: pausar / reanudar / despublicar / archivar / restaurar
-- ---------------------------------------------------------------------------
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  u constant uuid := 'dddddddd-0000-4000-8000-00000000000d';
  v_id uuid;
  r jsonb;
  v1 jsonb;
  v3 jsonb;
begin
  select e.id into v_id from public.dulabs_cms_entidades e where e.id_tenant = a and e.clave = 'amor' and e.tipo = 'oferta';

  -- transiciones inválidas
  perform pg_temp.afirmar(public.dulabs_cms_reanudar(a, v_id, u, 'Ana')->>'resultado' = 'estado_invalido', 'reanudar: solo desde pausada');
  perform pg_temp.afirmar(public.dulabs_cms_archivar(a, v_id, u, 'Ana')->>'resultado' = 'estado_invalido', 'archivar: un elemento EN VIVO no se archiva');
  perform pg_temp.afirmar(public.dulabs_cms_pausar(b, v_id, u, 'Ana')->>'resultado' = 'no_encontrada', 'pausar: otro negocio no existe');
  perform pg_temp.afirmar(public.dulabs_cms_pausar(a, v_id, u, 'Ana')->>'resultado' = 'ok', 'pausar: ok');
  perform pg_temp.afirmar(public.dulabs_cms_pausar(a, v_id, u, 'Ana')->>'resultado' = 'estado_invalido', 'pausar: dos veces no');
  perform pg_temp.afirmar((select estado = 'pausada' and version_activa = 2 from public.dulabs_cms_entidades where id = v_id), 'pausada conserva su versión activa');
  perform pg_temp.afirmar(public.dulabs_cms_reanudar(a, v_id, u, 'Ana')->>'resultado' = 'ok', 'reanudar: ok');

  -- restaurar la versión 1 estando activa la 2
  v1 := public.dulabs_cms_version(a, v_id, 1);
  perform pg_temp.afirmar(public.dulabs_cms_restaurar(a, v_id, 1, 1, null, u, 'Ana')->>'resultado' = 'conflicto', 'restaurar: con versión esperada vieja hay conflicto');
  perform pg_temp.afirmar(public.dulabs_cms_restaurar(a, v_id, 99, 2, null, u, 'Ana')->>'resultado' = 'version_no_encontrada', 'restaurar: una versión que no existe');
  perform pg_temp.afirmar(public.dulabs_cms_restaurar(b, v_id, 1, 2, null, u, 'Ana')->>'resultado' = 'no_encontrada', 'restaurar: otro negocio no existe');
  perform public.dulabs_cms_guardar_borrador(a, v_id, '{"nombre":"Borrador pendiente"}'::jsonb, (public.dulabs_cms_obtener(a, v_id)->>'rev')::int, u, 'Ana');
  r := public.dulabs_cms_restaurar(a, v_id, 1, 2, 'Volver a 20', u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and (r->>'version')::int = 3, 'restaurar: crea la versión 3');
  v3 := public.dulabs_cms_version(a, v_id, 3);
  perform pg_temp.afirmar(v3->>'accion' = 'restaurar' and (v3->>'restaurada_de')::int = 1 and v3->'contenido' = v1->'contenido' and v3->>'checksum' = v1->>'checksum', 'restaurar: copia contenido y checksum de la versión 1');
  perform pg_temp.afirmar((public.dulabs_cms_version(a, v_id, 1)) = v1 and (select count(*) from public.dulabs_cms_versiones where entidad_id = v_id) = 3, 'restaurar: no borra ni cambia las versiones anteriores');
  perform pg_temp.afirmar(r->'entidad'->>'estado' = 'publicada' and (r->'entidad'->>'version_activa')::int = 3 and r->'entidad'->'borrador' = '{"nombre":"Borrador pendiente"}'::jsonb, 'restaurar: queda activa la 3 y NO descarta el borrador pendiente');
  perform pg_temp.afirmar((select antes = '{"nombre":"Amor 25%"}'::jsonb and despues = '{"nombre":"Amor 20%"}'::jsonb and nota = 'Volver a 20' from public.dulabs_cms_auditoria where entidad_id = v_id and accion = 'restaurar'), 'restaurar: auditoría 25 → 20');

  -- despublicar sin borrador devuelve lo publicado como borrador (no se pierde nada)
  perform public.dulabs_cms_guardar_borrador(a, v_id, '{"nombre":"x"}'::jsonb, (public.dulabs_cms_obtener(a, v_id)->>'rev')::int, u, 'Ana');
  perform pg_temp.afirmar(public.dulabs_cms_despublicar(a, v_id, u, 'Ana')->>'resultado' = 'ok', 'despublicar con borrador pendiente');
  perform pg_temp.afirmar((select estado = 'borrador' and version_activa is null and borrador = '{"nombre":"x"}'::jsonb from public.dulabs_cms_entidades where id = v_id), 'despublicar: conserva el borrador pendiente');
  perform pg_temp.afirmar(public.dulabs_cms_despublicar(a, v_id, u, 'Ana')->>'resultado' = 'estado_invalido', 'despublicar: un borrador no se despublica');
  perform pg_temp.afirmar(public.dulabs_cms_restaurar(a, v_id, 3, 0, null, u, 'Ana')->>'resultado' = 'ok', 'restaurar tras despublicar: vuelve a estar en vivo');
  perform pg_temp.afirmar((select estado = 'publicada' and version_activa = 4 from public.dulabs_cms_entidades where id = v_id), 'restaurar: nueva versión 4 activa');

  -- archivar / desarchivar
  perform pg_temp.afirmar(public.dulabs_cms_despublicar(a, v_id, u, 'Ana')->>'resultado' = 'ok', 'despublicar de nuevo');
  perform pg_temp.afirmar(public.dulabs_cms_archivar(a, v_id, u, 'Ana')->>'resultado' = 'ok', 'archivar: ok');
  perform pg_temp.afirmar(public.dulabs_cms_archivar(a, v_id, u, 'Ana')->>'resultado' = 'estado_invalido', 'archivar: dos veces no');
  perform pg_temp.afirmar(public.dulabs_cms_guardar_borrador(a, v_id, '{"nombre":"y"}'::jsonb, (public.dulabs_cms_obtener(a, v_id)->>'rev')::int, u, 'Ana')->>'resultado' = 'archivada', 'un archivado no se edita');
  perform pg_temp.afirmar(public.dulabs_cms_publicar(a, v_id, (public.dulabs_cms_obtener(a, v_id)->>'rev')::int, 0, repeat('d', 64), null, u, 'Ana')->>'resultado' = 'archivada', 'un archivado no se publica');
  perform pg_temp.afirmar(public.dulabs_cms_restaurar(a, v_id, 1, 0, null, u, 'Ana')->>'resultado' = 'archivada', 'un archivado no se restaura');
  perform pg_temp.afirmar(not exists (select 1 from jsonb_array_elements(public.dulabs_cms_listar(a, 'oferta')) e where e->>'clave' = 'amor'), 'listar: oculta los archivados por defecto');
  perform pg_temp.afirmar(exists (select 1 from jsonb_array_elements(public.dulabs_cms_listar(a, 'oferta', null, true)) e where e->>'clave' = 'amor'), 'listar: los muestra si se piden');
  perform pg_temp.afirmar(exists (select 1 from jsonb_array_elements(public.dulabs_cms_listar(a, null, 'borrador', true)) e where e->>'clave' = 'amor'), 'listar: filtra por estado');
  perform pg_temp.afirmar(public.dulabs_cms_desarchivar(a, v_id, u, 'Ana')->>'resultado' = 'ok', 'desarchivar');
  perform pg_temp.afirmar(public.dulabs_cms_desarchivar(a, v_id, u, 'Ana')->>'resultado' = 'estado_invalido', 'desarchivar: dos veces no');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Inmutabilidad, claves foráneas compuestas y restricciones
-- ---------------------------------------------------------------------------
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  v_id uuid;
  otro uuid;
  rechazado boolean;
begin
  select e.id into v_id from public.dulabs_cms_entidades e where e.id_tenant = a and e.clave = 'amor' and e.tipo = 'oferta';
  select e.id into otro from public.dulabs_cms_entidades e where e.id_tenant = b and e.tipo = 'oferta' limit 1;

  -- versiones y auditoría: ni update ni delete
  foreach rechazado in array array[true] loop
    begin
      update public.dulabs_cms_versiones set nota = 'tocado' where entidad_id = v_id;
      rechazado := false;
    exception when sqlstate 'CT002' then rechazado := true;
    end;
    perform pg_temp.afirmar(rechazado, 'versiones: no se pueden editar');
    begin
      delete from public.dulabs_cms_versiones where entidad_id = v_id;
      rechazado := false;
    exception when sqlstate 'CT002' then rechazado := true;
    end;
    perform pg_temp.afirmar(rechazado, 'versiones: no se pueden borrar');
    begin
      update public.dulabs_cms_auditoria set accion = 'crear' where entidad_id = v_id;
      rechazado := false;
    exception when sqlstate 'CT002' then rechazado := true;
    end;
    perform pg_temp.afirmar(rechazado, 'auditoría: no se puede editar');
    begin
      delete from public.dulabs_cms_auditoria where entidad_id = v_id;
      rechazado := false;
    exception when sqlstate 'CT002' then rechazado := true;
    end;
    perform pg_temp.afirmar(rechazado, 'auditoría: no se puede borrar');
  end loop;

  -- una versión no puede colgar del elemento de otro negocio
  begin
    insert into public.dulabs_cms_versiones (id_tenant, entidad_id, version, contenido, checksum, accion) values (b, v_id, 77, '{}'::jsonb, repeat('e', 64), 'publicar');
    rechazado := false;
  exception when foreign_key_violation then rechazado := true;
  end;
  perform pg_temp.afirmar(rechazado, 'FK compuesta: una versión del negocio B no puede colgar de un elemento del negocio A');

  -- el puntero activo no puede apuntar a una versión que no existe ni a la de otro elemento
  begin
    update public.dulabs_cms_entidades set estado = 'publicada', version_activa = 99 where id = v_id;
    rechazado := false;
  exception when foreign_key_violation then rechazado := true;
  end;
  perform pg_temp.afirmar(rechazado, 'FK compuesta: el puntero no puede apuntar a una versión inexistente');
  begin
    update public.dulabs_cms_entidades set estado = 'publicada', version_activa = (select max(version) from public.dulabs_cms_versiones where entidad_id = otro) where id = otro;
    rechazado := false;
  exception when foreign_key_violation or check_violation then rechazado := true;
  end;
  perform pg_temp.afirmar(rechazado, 'FK compuesta: un elemento sin versiones no puede quedar «publicado»');

  -- restricciones de coherencia
  begin
    update public.dulabs_cms_entidades set estado = 'publicada', version_activa = null where id = v_id;
    rechazado := false;
  exception when check_violation then rechazado := true;
  end;
  perform pg_temp.afirmar(rechazado, 'CHECK: publicada exige versión activa');
  begin
    update public.dulabs_cms_entidades set estado = 'borrador', borrador = null, version_activa = null where id = v_id;
    rechazado := false;
  exception when check_violation then rechazado := true;
  end;
  perform pg_temp.afirmar(rechazado, 'CHECK: siempre hay algo que editar o algo publicado');
  begin
    update public.dulabs_cms_entidades set estado = 'vencida' where id = v_id;
    rechazado := false;
  exception when check_violation then rechazado := true;
  end;
  perform pg_temp.afirmar(rechazado, 'CHECK: «vencida» no es un estado guardado (se deriva al leer)');
  begin
    insert into public.dulabs_cms_versiones (id_tenant, entidad_id, version, contenido, checksum, accion, restaurada_de) values (a, v_id, 88, '{}'::jsonb, repeat('e', 64), 'publicar', 1);
    rechazado := false;
  exception when check_violation then rechazado := true;
  end;
  perform pg_temp.afirmar(rechazado, 'CHECK: solo una restauración declara de qué versión viene');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Imágenes
-- ---------------------------------------------------------------------------
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  u constant uuid := 'dddddddd-0000-4000-8000-00000000000d';
  i1 constant uuid := '11111111-0000-4000-8000-000000000001';
  i2 constant uuid := '22222222-0000-4000-8000-000000000002';
  r jsonb;
begin
  r := public.dulabs_cms_asset_crear(a, i1, a::text || '/cms/' || i1::text || '/portada.webp', 'image/webp', 120000, 1600, 900, 'portada.png', u);
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and r->'asset'->>'estado' = 'pendiente', 'asset: nace pendiente');
  perform pg_temp.afirmar(public.dulabs_cms_asset_crear(a, i1, a::text || '/cms/' || i1::text || '/otra.webp', 'image/webp', 1, 100, 100, null, u)->>'resultado' = 'existente', 'asset: el id no se repite');
  perform pg_temp.afirmar(public.dulabs_cms_asset_crear(a, i2, b::text || '/cms/' || i2::text || '/x.webp', 'image/webp', 1, 100, 100, null, u)->>'resultado' = 'invalido', 'asset: la ruta no puede apuntar al espacio de otro negocio');
  perform pg_temp.afirmar(public.dulabs_cms_asset_crear(a, i2, a::text || '/cms/' || i2::text || '/../x.webp', 'image/webp', 1, 100, 100, null, u)->>'resultado' = 'invalido', 'asset: la ruta no puede escapar con «..»');
  perform pg_temp.afirmar(public.dulabs_cms_asset_crear(a, i2, a::text || '/cms/' || i2::text || '//x.webp', 'image/webp', 1, 100, 100, null, u)->>'resultado' = 'invalido', 'asset: la ruta no puede traer «//»');
  perform pg_temp.afirmar(public.dulabs_cms_asset_crear(a, i2, a::text || '/otro/' || i2::text || '/x.webp', 'image/webp', 1, 100, 100, null, u)->>'resultado' = 'invalido', 'asset: la ruta debe quedar bajo /cms/{id}/');
  perform pg_temp.afirmar(public.dulabs_cms_asset_crear(a, i2, a::text || '/cms/' || i2::text || '/x.gif', 'image/gif', 1, 100, 100, null, u)->>'resultado' = 'invalido', 'asset: tipo de imagen no permitido');
  perform pg_temp.afirmar(public.dulabs_cms_asset_crear(a, i2, a::text || '/cms/' || i2::text || '/x.webp', 'image/webp', 20000000, 100, 100, null, u)->>'resultado' = 'invalido', 'asset: tamaño máximo 10 MB');
  perform pg_temp.afirmar(jsonb_array_length(public.dulabs_cms_lectura_activa(a)->'assets') = 0, 'asset pendiente: no sale en la lectura pública');
  perform pg_temp.afirmar(public.dulabs_cms_asset_confirmar(b, i1, 120000, 1600, 900, u, 'Ana')->>'resultado' = 'no_encontrada', 'asset: otro negocio no puede confirmarlo');
  r := public.dulabs_cms_asset_confirmar(a, i1, 118000, 1600, 900, u, 'Ana');
  perform pg_temp.afirmar(r->>'resultado' = 'ok' and r->'asset'->>'estado' = 'listo' and (r->'asset'->>'bytes')::int = 118000, 'asset: confirmado queda listo con los datos reales');
  perform public.dulabs_cms_asset_confirmar(a, i1, 118000, 1600, 900, u, 'Ana');
  perform pg_temp.afirmar((select count(*) from public.dulabs_cms_auditoria where entidad_id = i1 and accion = 'subir_imagen') = 1, 'asset: confirmar dos veces audita una sola vez');
  perform pg_temp.afirmar(jsonb_array_length(public.dulabs_cms_lectura_activa(a)->'assets') = 1, 'asset listo: sale en la lectura pública');
  perform pg_temp.afirmar(jsonb_array_length(public.dulabs_cms_lectura_activa(b)->'assets') = 0, 'asset: B no ve las imágenes de A');
  perform pg_temp.afirmar(public.dulabs_cms_asset_obtener(b, i1) is null and public.dulabs_cms_asset_obtener(a, i1) is not null, 'asset: obtener respeta el negocio');
  perform pg_temp.afirmar(jsonb_array_length(public.dulabs_cms_assets_listar(a)) = 1 and jsonb_array_length(public.dulabs_cms_assets_listar(b)) = 0, 'asset: listar respeta el negocio');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Permisos: solo service_role (anon y authenticated no ejecutan funciones ni leen tablas)
-- ---------------------------------------------------------------------------
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  rol text;
  denegado boolean;
begin
  foreach rol in array array['anon', 'authenticated'] loop
    execute format('set local role %I', rol);
    begin
      perform public.dulabs_cms_lectura_activa(a);
      denegado := false;
    exception when insufficient_privilege then denegado := true;
    end;
    reset role;
    perform pg_temp.afirmar(denegado, rol || ': no puede ejecutar las funciones');
    execute format('set local role %I', rol);
    begin
      perform count(*) from public.dulabs_cms_entidades;
      denegado := false;
    exception when insufficient_privilege then denegado := true;
    end;
    reset role;
    perform pg_temp.afirmar(denegado, rol || ': no puede leer las tablas');
  end loop;

  -- Por introspección, función por función y tabla por tabla (no depende de qué barrera se active primero).
  perform pg_temp.afirmar(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                       where n.nspname = 'public' and p.proname like 'dulabs\_cms\_%'
                                         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
                          'ninguna función del CMS es ejecutable por anon ni authenticated');
  perform pg_temp.afirmar(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                       where n.nspname = 'public' and p.proname like 'dulabs\_cms\_%' and not has_function_privilege('service_role', p.oid, 'execute')),
                          'service_role ejecuta todas las funciones del CMS');
  foreach rol in array array['anon', 'authenticated'] loop
    perform pg_temp.afirmar(not exists (select 1 from unnest(array['dulabs_cms_entidades', 'dulabs_cms_versiones', 'dulabs_cms_auditoria', 'dulabs_cms_assets']) t(nombre)
                                         where has_table_privilege(rol, 'public.' || t.nombre, 'select') or has_table_privilege(rol, 'public.' || t.nombre, 'insert')
                                            or has_table_privilege(rol, 'public.' || t.nombre, 'update') or has_table_privilege(rol, 'public.' || t.nombre, 'delete')),
                            rol || ': sin ningún privilegio sobre las tablas del CMS');
  end loop;

  set local role service_role;
  perform public.dulabs_cms_lectura_activa(a);
  perform public.dulabs_cms_listar(a);
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. La auditoría cubre cada acción
-- ---------------------------------------------------------------------------
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  acciones text[];
begin
  acciones := array(select distinct accion from public.dulabs_cms_auditoria where id_tenant = a order by 1);
  perform pg_temp.afirmar(acciones @> array['crear', 'editar_borrador', 'publicar', 'restaurar', 'pausar', 'reanudar', 'despublicar', 'archivar', 'desarchivar', 'subir_imagen'], 'auditoría: quedaron las 10 acciones, obtuvo ' || array_to_string(acciones, ','));
  perform pg_temp.afirmar(not exists (select 1 from public.dulabs_cms_auditoria where id_tenant = a and (actor_etiqueta is null or actor_user_id is null)), 'auditoría: toda acción registra quién la hizo');
  perform pg_temp.afirmar(not exists (select 1 from public.dulabs_cms_auditoria where id_tenant = 'bbbbbbbb-0000-4000-8000-00000000000b' and entidad_id in (select entidad_id from public.dulabs_cms_auditoria where id_tenant = a)), 'auditoría: ninguna entrada de B habla de elementos de A');
end;
$$;

select 'CMS comercial: todas las verificaciones SQL pasaron' as resultado;
