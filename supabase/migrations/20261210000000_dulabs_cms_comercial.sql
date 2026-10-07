-- DuLabs — CMS comercial (Bloque 29): contenido comercial administrable por negocio con ciclo
--   BORRADOR → VALIDACIÓN → PUBLICAR → VERSIÓN ACTIVA, versiones inmutables, restauración y auditoría.
--
-- Tablas NUEVAS, aditivas. NO modifica ninguna tabla ni función existente. Sin el módulo `cms_comercial` habilitado para el negocio
-- (dulabs_tenant_modulos) nada de esto se lee ni se escribe desde la aplicación: el comportamiento actual de tienda, pedidos y ARIA no cambia.
--
--   1. dulabs_cms_entidades  — un elemento administrable (página principal, oferta, combo, campaña, contenido): borrador de trabajo, estado, puntero a la
--                              versión activa y `rev` (control optimista: dos editores no se pisan). «Vencida» NO se guarda: se deriva de la vigencia al leer.
--   2. dulabs_cms_versiones  — cada publicación o restauración: instantánea INMUTABLE (append-only) con checksum. Restaurar crea una versión nueva.
--   3. dulabs_cms_auditoria  — quién hizo qué, cuándo, con valor anterior y nuevo (append-only), escrita en la MISMA transacción del cambio.
--   4. dulabs_cms_assets     — imágenes subidas por el negocio (Storage); la ruta la decide el servidor y queda bajo {negocio}/cms/{id}/.
--
-- Reglas protegidas en la CAPA DE DATOS (valen para cualquier cliente de la base):
--   - aislamiento por negocio: `id_tenant` en cada tabla, claves foráneas COMPUESTAS (una versión o un puntero nunca cuelgan de otro negocio) y cada función
--     recibe el negocio y lo filtra siempre;
--   - publicar, restaurar, pausar, reanudar, despublicar, archivar y guardar borrador son ATÓMICOS (cambio + auditoría en una transacción), serializados por
--     candado consultivo por elemento y con control optimista (`rev` y versión esperada);
--   - lo único que consumen la tienda, el pedido y ARIA es dulabs_cms_lectura_activa: SOLO publicadas, con versión activa, no archivadas y solo si el módulo
--     está habilitado. Borradores y pausadas no existen para quien lee;
--   - versiones y auditoría no se editan ni se borran.
--
-- SEGURIDAD: RLS habilitada SIN políticas (solo service_role); funciones sin EXECUTE para public/anon/authenticated.
-- RECUPERACIÓN: todo es aditivo. Reversa: supabase/rollbacks/20261210000000_dulabs_cms_comercial.down.sql (se niega a correr si hay contenido publicado).
-- Idempotente: se puede ejecutar más de una vez. Se aplica a mano en el SQL Editor de Supabase.

begin;

-- ============================================================
-- 1. ELEMENTOS
-- ============================================================
create table if not exists public.dulabs_cms_entidades (
  id uuid not null default gen_random_uuid(),
  id_tenant uuid not null,
  tipo text not null,
  -- Código público estable (lo que ve ARIA). Nunca el id interno.
  clave text not null,
  estado text not null default 'borrador',
  -- Copia de trabajo pendiente de publicar. null = no hay cambios pendientes.
  borrador jsonb,
  version_activa integer,
  -- Contador de cambios (borrador, publicación, estado): control optimista.
  rev integer not null default 1,
  archivada_at timestamptz,
  created_by uuid,
  updated_by uuid,
  published_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  primary key (id),
  constraint dulabs_cms_entidades_ref unique (id, id_tenant),
  constraint dulabs_cms_entidades_clave_uq unique (id_tenant, tipo, clave),
  constraint dulabs_cms_entidades_tipo_ck check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido')),
  constraint dulabs_cms_entidades_clave_ck check (clave ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  -- Hay una sola página principal por negocio.
  constraint dulabs_cms_entidades_home_ck check (tipo <> 'home' or clave = 'home'),
  constraint dulabs_cms_entidades_estado_ck check (estado in ('borrador', 'publicada', 'pausada')),
  constraint dulabs_cms_entidades_rev_ck check (rev >= 1),
  constraint dulabs_cms_entidades_version_ck check (version_activa is null or version_activa >= 1),
  -- Publicada o pausada <=> tiene versión activa. Un borrador puro no la tiene.
  constraint dulabs_cms_entidades_activa_ck check ((estado = 'borrador') = (version_activa is null)),
  -- Un elemento archivado no puede estar en vivo.
  constraint dulabs_cms_entidades_archivada_ck check (archivada_at is null or estado = 'borrador'),
  -- Siempre hay algo que editar o algo publicado.
  constraint dulabs_cms_entidades_contenido_ck check (borrador is not null or version_activa is not null),
  constraint dulabs_cms_entidades_borrador_ck check (borrador is null or (jsonb_typeof(borrador) = 'object' and length(borrador::text) <= 262144))
);

create index if not exists dulabs_cms_entidades_tenant_tipo_idx on public.dulabs_cms_entidades (id_tenant, tipo, estado);
create index if not exists dulabs_cms_entidades_vivas_idx on public.dulabs_cms_entidades (id_tenant) where estado = 'publicada' and archivada_at is null;

-- ============================================================
-- 2. VERSIONES (append-only)
-- ============================================================
create table if not exists public.dulabs_cms_versiones (
  id uuid not null default gen_random_uuid(),
  id_tenant uuid not null,
  entidad_id uuid not null,
  version integer not null,
  contenido jsonb not null,
  checksum text not null,
  accion text not null,
  -- Si es una restauración: de qué versión se copió.
  restaurada_de integer,
  nota text,
  creado_por uuid,
  creado_por_etiqueta text,
  created_at timestamptz not null default now(),
  primary key (id),
  constraint dulabs_cms_versiones_version_uq unique (entidad_id, version),
  constraint dulabs_cms_versiones_ref unique (entidad_id, id_tenant, version),
  constraint dulabs_cms_versiones_version_ck check (version between 1 and 1000000),
  constraint dulabs_cms_versiones_contenido_ck check (jsonb_typeof(contenido) = 'object' and length(contenido::text) <= 262144),
  constraint dulabs_cms_versiones_checksum_ck check (checksum ~ '^[a-f0-9]{64}$'),
  constraint dulabs_cms_versiones_accion_ck check (accion in ('publicar', 'restaurar')),
  constraint dulabs_cms_versiones_restaurada_ck check ((accion = 'restaurar') = (restaurada_de is not null)),
  constraint dulabs_cms_versiones_nota_ck check (nota is null or char_length(nota) <= 500),
  constraint dulabs_cms_versiones_etiqueta_ck check (creado_por_etiqueta is null or char_length(creado_por_etiqueta) <= 120),
  -- Una versión nunca cuelga del elemento de otro negocio.
  constraint dulabs_cms_versiones_entidad_fk foreign key (entidad_id, id_tenant) references public.dulabs_cms_entidades (id, id_tenant)
);

-- El puntero a la versión activa: FK compuesta (mismo elemento, mismo negocio, versión existente). Se agrega aparte porque las tablas se referencian entre sí.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dulabs_cms_entidades_activa_fk' and conrelid = 'public.dulabs_cms_entidades'::regclass) then
    alter table public.dulabs_cms_entidades
      add constraint dulabs_cms_entidades_activa_fk foreign key (id, id_tenant, version_activa)
      references public.dulabs_cms_versiones (entidad_id, id_tenant, version);
  end if;
end;
$$;

-- ============================================================
-- 3. AUDITORÍA (append-only)
-- ============================================================
create table if not exists public.dulabs_cms_auditoria (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  entidad_tipo text not null,
  entidad_id uuid not null,
  accion text not null,
  version integer,
  nota text,
  antes jsonb,
  despues jsonb,
  actor_user_id uuid,
  actor_etiqueta text,
  created_at timestamptz not null default now(),
  constraint dulabs_cms_auditoria_tipo_ck check (entidad_tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'imagen')),
  constraint dulabs_cms_auditoria_accion_ck check (accion in ('crear', 'editar_borrador', 'publicar', 'restaurar', 'pausar', 'reanudar', 'despublicar', 'archivar', 'desarchivar', 'subir_imagen')),
  constraint dulabs_cms_auditoria_nota_ck check (nota is null or char_length(nota) <= 500),
  constraint dulabs_cms_auditoria_etiqueta_ck check (actor_etiqueta is null or char_length(actor_etiqueta) <= 120)
);

create index if not exists dulabs_cms_auditoria_tenant_idx on public.dulabs_cms_auditoria (id_tenant, id desc);
create index if not exists dulabs_cms_auditoria_entidad_idx on public.dulabs_cms_auditoria (id_tenant, entidad_id, id desc);

-- ============================================================
-- 4. IMÁGENES
-- ============================================================
create table if not exists public.dulabs_cms_assets (
  id uuid not null default gen_random_uuid(),
  id_tenant uuid not null,
  storage_path text not null,
  mime_type text not null,
  bytes integer not null,
  ancho integer not null,
  alto integer not null,
  -- pendiente = se emitió la URL de subida; listo = el servidor verificó el archivo.
  estado text not null default 'pendiente',
  nombre_original text,
  created_by uuid,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  primary key (id),
  constraint dulabs_cms_assets_ref unique (id, id_tenant),
  constraint dulabs_cms_assets_mime_ck check (mime_type in ('image/webp', 'image/jpeg', 'image/png')),
  constraint dulabs_cms_assets_bytes_ck check (bytes between 1 and 10485760),
  constraint dulabs_cms_assets_dim_ck check (ancho between 16 and 10000 and alto between 16 and 10000),
  constraint dulabs_cms_assets_estado_ck check (estado in ('pendiente', 'listo')),
  constraint dulabs_cms_assets_nombre_ck check (nombre_original is null or char_length(nombre_original) <= 120),
  -- La ruta queda SIEMPRE bajo {negocio}/cms/{id}/ y no puede escapar con «..» ni «//».
  constraint dulabs_cms_assets_ruta_ck check (storage_path like id_tenant::text || '/cms/' || id::text || '/%' and storage_path !~ '\.\.' and storage_path !~ '//')
);

create index if not exists dulabs_cms_assets_tenant_idx on public.dulabs_cms_assets (id_tenant, estado, created_at);

-- ============================================================
-- 5. INMUTABILIDAD Y SEGURIDAD DE TABLAS
-- ============================================================
create or replace function public.dulabs_cms_inmutable()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = 'CT002', message = 'cms_append_only', detail = tg_table_name;
end;
$$;

drop trigger if exists dulabs_cms_versiones_inmutable on public.dulabs_cms_versiones;
create trigger dulabs_cms_versiones_inmutable
  before update or delete on public.dulabs_cms_versiones
  for each row execute function public.dulabs_cms_inmutable();

drop trigger if exists dulabs_cms_auditoria_inmutable on public.dulabs_cms_auditoria;
create trigger dulabs_cms_auditoria_inmutable
  before update or delete on public.dulabs_cms_auditoria
  for each row execute function public.dulabs_cms_inmutable();

alter table public.dulabs_cms_entidades enable row level security;
alter table public.dulabs_cms_versiones enable row level security;
alter table public.dulabs_cms_auditoria enable row level security;
alter table public.dulabs_cms_assets enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.dulabs_cms_entidades, public.dulabs_cms_versiones, public.dulabs_cms_auditoria, public.dulabs_cms_assets from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.dulabs_cms_entidades, public.dulabs_cms_versiones, public.dulabs_cms_auditoria, public.dulabs_cms_assets from authenticated';
  end if;
end;
$$;

comment on table public.dulabs_cms_entidades is
  'CMS comercial (Bloque 29): elementos administrables por negocio (página principal, oferta, combo, campaña, contenido) con borrador, estado y versión activa. «Vencida» no se guarda: se deriva de la vigencia al leer.';
comment on table public.dulabs_cms_versiones is
  'CMS comercial: instantánea INMUTABLE de cada publicación o restauración (append-only). Lo único que lee la tienda, el pedido y ARIA es la versión activa de elementos publicados.';
comment on table public.dulabs_cms_auditoria is
  'CMS comercial: auditoría APPEND-ONLY (quién, qué, cuándo, antes y después) escrita en la misma transacción del cambio. Nunca contiene secretos.';
comment on table public.dulabs_cms_assets is
  'CMS comercial: imágenes subidas por el negocio. La ruta de Storage la decide el servidor y queda bajo {negocio}/cms/{id}/.';

-- ============================================================
-- 6. FUNCIONES (todas reciben el negocio y lo filtran SIEMPRE; solo service_role puede ejecutarlas)
-- ============================================================

-- Candado por elemento + fila bloqueada. Devuelve la fila (o una fila con todo null si no existe en ese negocio).
create or replace function public.dulabs_cms_bloquear(p_tenant uuid, p_id uuid)
returns public.dulabs_cms_entidades
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_fila public.dulabs_cms_entidades;
begin
  perform pg_advisory_xact_lock(hashtextextended('dulabs_cms:e:' || coalesce(p_tenant::text, '') || ':' || coalesce(p_id::text, ''), 0));
  select * into v_fila from public.dulabs_cms_entidades where id = p_id and id_tenant = p_tenant for update;
  return v_fila;
end;
$$;

-- Contenido de la versión activa (null si no hay).
create or replace function public.dulabs_cms_contenido_activo(p_tenant uuid, p_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select v.contenido
    from public.dulabs_cms_entidades e
    join public.dulabs_cms_versiones v on v.entidad_id = e.id and v.id_tenant = e.id_tenant and v.version = e.version_activa
   where e.id = p_id and e.id_tenant = p_tenant;
$$;

-- El elemento tal como lo ve el editor (con borrador y contenido activo).
create or replace function public.dulabs_cms_entidad_json(p_tenant uuid, p_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'id', e.id,
           'id_tenant', e.id_tenant,
           'tipo', e.tipo,
           'clave', e.clave,
           'estado', e.estado,
           'rev', e.rev,
           'version_activa', e.version_activa,
           'borrador', e.borrador,
           'contenido_activo', v.contenido,
           'archivada_at', e.archivada_at,
           'created_at', e.created_at,
           'updated_at', e.updated_at,
           'published_at', e.published_at)
    from public.dulabs_cms_entidades e
    left join public.dulabs_cms_versiones v on v.entidad_id = e.id and v.id_tenant = e.id_tenant and v.version = e.version_activa
   where e.id = p_id and e.id_tenant = p_tenant;
$$;

-- Registro de auditoría (interno: lo usan las funciones de abajo en la misma transacción del cambio).
create or replace function public.dulabs_cms_auditar(
  p_tenant uuid, p_tipo text, p_id uuid, p_accion text, p_version integer, p_nota text, p_antes jsonb, p_despues jsonb, p_actor uuid, p_etiqueta text
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.dulabs_cms_auditoria (id_tenant, entidad_tipo, entidad_id, accion, version, nota, antes, despues, actor_user_id, actor_etiqueta)
  values (p_tenant, p_tipo, p_id, p_accion, p_version, p_nota, p_antes, p_despues, p_actor, p_etiqueta);
$$;

-- CREAR: un elemento nuevo en borrador. «clave_existente» si el código ya está en uso en ese negocio y tipo.
create or replace function public.dulabs_cms_crear(p_tenant uuid, p_tipo text, p_clave text, p_borrador jsonb, p_actor uuid, p_etiqueta text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_tenant is null or p_tipo is null or p_clave is null or p_borrador is null then
    return jsonb_build_object('resultado', 'invalido');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dulabs_cms:c:' || p_tenant::text || ':' || p_tipo || ':' || p_clave, 0));
  begin
    insert into public.dulabs_cms_entidades (id_tenant, tipo, clave, estado, borrador, created_by, updated_by)
    values (p_tenant, p_tipo, p_clave, 'borrador', p_borrador, p_actor, p_actor)
    returning id into v_id;
  exception
    when unique_violation then return jsonb_build_object('resultado', 'clave_existente');
    when check_violation then return jsonb_build_object('resultado', 'invalido');
  end;
  perform public.dulabs_cms_auditar(p_tenant, p_tipo, v_id, 'crear', null, null, null, p_borrador, p_actor, p_etiqueta);
  return jsonb_build_object('resultado', 'ok', 'entidad', public.dulabs_cms_entidad_json(p_tenant, v_id));
end;
$$;

-- GUARDAR BORRADOR: reemplaza el borrador. Control optimista con `rev`.
create or replace function public.dulabs_cms_guardar_borrador(p_tenant uuid, p_id uuid, p_borrador jsonb, p_rev_esperada integer, p_actor uuid, p_etiqueta text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.dulabs_cms_entidades;
  v_antes jsonb;
begin
  if p_tenant is null or p_id is null or p_borrador is null or p_rev_esperada is null then
    return jsonb_build_object('resultado', 'invalido');
  end if;
  e := public.dulabs_cms_bloquear(p_tenant, p_id);
  if e.id is null then return jsonb_build_object('resultado', 'no_encontrada'); end if;
  if e.archivada_at is not null then return jsonb_build_object('resultado', 'archivada'); end if;
  if e.rev <> p_rev_esperada then return jsonb_build_object('resultado', 'conflicto', 'rev', e.rev, 'version_activa', e.version_activa); end if;
  -- Lo «anterior» es el borrador pendiente o, si no había, lo que está publicado (así el historial muestra el cambio real).
  v_antes := coalesce(e.borrador, public.dulabs_cms_contenido_activo(e.id_tenant, e.id));
  begin
    update public.dulabs_cms_entidades
       set borrador = p_borrador, rev = e.rev + 1, updated_at = now(), updated_by = p_actor
     where id = e.id and id_tenant = e.id_tenant;
  exception when check_violation then
    return jsonb_build_object('resultado', 'invalido');
  end;
  perform public.dulabs_cms_auditar(e.id_tenant, e.tipo, e.id, 'editar_borrador', null, null, v_antes, p_borrador, p_actor, p_etiqueta);
  return jsonb_build_object('resultado', 'ok', 'entidad', public.dulabs_cms_entidad_json(e.id_tenant, e.id));
end;
$$;

-- PUBLICAR: el borrador (validado por la aplicación en la revisión `p_rev_esperada`) pasa a ser una versión nueva e INMUTABLE y queda activa.
create or replace function public.dulabs_cms_publicar(
  p_tenant uuid, p_id uuid, p_rev_esperada integer, p_version_esperada integer, p_checksum text, p_nota text, p_actor uuid, p_etiqueta text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.dulabs_cms_entidades;
  v_antes jsonb;
  v_nueva integer;
begin
  if p_tenant is null or p_id is null or p_rev_esperada is null or p_version_esperada is null or p_checksum is null then
    return jsonb_build_object('resultado', 'invalido');
  end if;
  e := public.dulabs_cms_bloquear(p_tenant, p_id);
  if e.id is null then return jsonb_build_object('resultado', 'no_encontrada'); end if;
  if e.archivada_at is not null then return jsonb_build_object('resultado', 'archivada'); end if;
  if e.rev <> p_rev_esperada or coalesce(e.version_activa, 0) <> p_version_esperada then
    return jsonb_build_object('resultado', 'conflicto', 'rev', e.rev, 'version_activa', e.version_activa);
  end if;
  if e.borrador is null then return jsonb_build_object('resultado', 'sin_cambios'); end if;
  v_antes := public.dulabs_cms_contenido_activo(e.id_tenant, e.id);
  select coalesce(max(version), 0) + 1 into v_nueva from public.dulabs_cms_versiones where entidad_id = e.id and id_tenant = e.id_tenant;
  begin
    insert into public.dulabs_cms_versiones (id_tenant, entidad_id, version, contenido, checksum, accion, nota, creado_por, creado_por_etiqueta)
    values (e.id_tenant, e.id, v_nueva, e.borrador, p_checksum, 'publicar', p_nota, p_actor, p_etiqueta);
  exception when check_violation then
    return jsonb_build_object('resultado', 'invalido');
  end;
  update public.dulabs_cms_entidades
     set version_activa = v_nueva, estado = 'publicada', borrador = null, rev = e.rev + 1,
         updated_at = now(), updated_by = p_actor, published_at = now(), published_by = p_actor
   where id = e.id and id_tenant = e.id_tenant;
  perform public.dulabs_cms_auditar(e.id_tenant, e.tipo, e.id, 'publicar', v_nueva, p_nota, v_antes, e.borrador, p_actor, p_etiqueta);
  return jsonb_build_object('resultado', 'ok', 'version', v_nueva, 'entidad', public.dulabs_cms_entidad_json(e.id_tenant, e.id));
end;
$$;

-- RESTAURAR: copia una versión anterior como versión NUEVA y la activa. No toca el borrador pendiente.
create or replace function public.dulabs_cms_restaurar(p_tenant uuid, p_id uuid, p_version integer, p_version_esperada integer, p_nota text, p_actor uuid, p_etiqueta text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.dulabs_cms_entidades;
  v public.dulabs_cms_versiones;
  v_antes jsonb;
  v_nueva integer;
begin
  if p_tenant is null or p_id is null or p_version is null or p_version_esperada is null then
    return jsonb_build_object('resultado', 'invalido');
  end if;
  e := public.dulabs_cms_bloquear(p_tenant, p_id);
  if e.id is null then return jsonb_build_object('resultado', 'no_encontrada'); end if;
  if e.archivada_at is not null then return jsonb_build_object('resultado', 'archivada'); end if;
  if coalesce(e.version_activa, 0) <> p_version_esperada then
    return jsonb_build_object('resultado', 'conflicto', 'rev', e.rev, 'version_activa', e.version_activa);
  end if;
  select * into v from public.dulabs_cms_versiones where entidad_id = e.id and id_tenant = e.id_tenant and version = p_version;
  if v.id is null then return jsonb_build_object('resultado', 'version_no_encontrada'); end if;
  v_antes := public.dulabs_cms_contenido_activo(e.id_tenant, e.id);
  select coalesce(max(version), 0) + 1 into v_nueva from public.dulabs_cms_versiones where entidad_id = e.id and id_tenant = e.id_tenant;
  insert into public.dulabs_cms_versiones (id_tenant, entidad_id, version, contenido, checksum, accion, restaurada_de, nota, creado_por, creado_por_etiqueta)
  values (e.id_tenant, e.id, v_nueva, v.contenido, v.checksum, 'restaurar', p_version, p_nota, p_actor, p_etiqueta);
  update public.dulabs_cms_entidades
     set version_activa = v_nueva, estado = 'publicada', rev = e.rev + 1,
         updated_at = now(), updated_by = p_actor, published_at = now(), published_by = p_actor
   where id = e.id and id_tenant = e.id_tenant;
  perform public.dulabs_cms_auditar(e.id_tenant, e.tipo, e.id, 'restaurar', v_nueva, p_nota, v_antes, v.contenido, p_actor, p_etiqueta);
  return jsonb_build_object('resultado', 'ok', 'version', v_nueva, 'entidad', public.dulabs_cms_entidad_json(e.id_tenant, e.id));
end;
$$;

-- PAUSAR / REANUDAR: publicada <-> pausada (la versión activa se conserva; pausada no la ve nadie).
create or replace function public.dulabs_cms_pausar(p_tenant uuid, p_id uuid, p_actor uuid, p_etiqueta text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.dulabs_cms_entidades;
begin
  if p_tenant is null or p_id is null then return jsonb_build_object('resultado', 'invalido'); end if;
  e := public.dulabs_cms_bloquear(p_tenant, p_id);
  if e.id is null then return jsonb_build_object('resultado', 'no_encontrada'); end if;
  if e.estado <> 'publicada' then return jsonb_build_object('resultado', 'estado_invalido', 'estado', e.estado); end if;
  update public.dulabs_cms_entidades set estado = 'pausada', rev = e.rev + 1, updated_at = now(), updated_by = p_actor where id = e.id and id_tenant = e.id_tenant;
  perform public.dulabs_cms_auditar(e.id_tenant, e.tipo, e.id, 'pausar', e.version_activa, null, jsonb_build_object('estado', 'publicada'), jsonb_build_object('estado', 'pausada'), p_actor, p_etiqueta);
  return jsonb_build_object('resultado', 'ok', 'entidad', public.dulabs_cms_entidad_json(e.id_tenant, e.id));
end;
$$;

create or replace function public.dulabs_cms_reanudar(p_tenant uuid, p_id uuid, p_actor uuid, p_etiqueta text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.dulabs_cms_entidades;
begin
  if p_tenant is null or p_id is null then return jsonb_build_object('resultado', 'invalido'); end if;
  e := public.dulabs_cms_bloquear(p_tenant, p_id);
  if e.id is null then return jsonb_build_object('resultado', 'no_encontrada'); end if;
  if e.estado <> 'pausada' then return jsonb_build_object('resultado', 'estado_invalido', 'estado', e.estado); end if;
  update public.dulabs_cms_entidades set estado = 'publicada', rev = e.rev + 1, updated_at = now(), updated_by = p_actor where id = e.id and id_tenant = e.id_tenant;
  perform public.dulabs_cms_auditar(e.id_tenant, e.tipo, e.id, 'reanudar', e.version_activa, null, jsonb_build_object('estado', 'pausada'), jsonb_build_object('estado', 'publicada'), p_actor, p_etiqueta);
  return jsonb_build_object('resultado', 'ok', 'entidad', public.dulabs_cms_entidad_json(e.id_tenant, e.id));
end;
$$;

-- DESPUBLICAR: deja de estar en vivo y vuelve a borrador. Si no había borrador pendiente, el contenido que estaba publicado pasa a ser el borrador
-- (no se pierde nada: las versiones siguen en el historial).
create or replace function public.dulabs_cms_despublicar(p_tenant uuid, p_id uuid, p_actor uuid, p_etiqueta text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.dulabs_cms_entidades;
  v_activo jsonb;
begin
  if p_tenant is null or p_id is null then return jsonb_build_object('resultado', 'invalido'); end if;
  e := public.dulabs_cms_bloquear(p_tenant, p_id);
  if e.id is null then return jsonb_build_object('resultado', 'no_encontrada'); end if;
  if e.estado not in ('publicada', 'pausada') then return jsonb_build_object('resultado', 'estado_invalido', 'estado', e.estado); end if;
  v_activo := public.dulabs_cms_contenido_activo(e.id_tenant, e.id);
  update public.dulabs_cms_entidades
     set estado = 'borrador', version_activa = null, borrador = coalesce(e.borrador, v_activo), rev = e.rev + 1, updated_at = now(), updated_by = p_actor
   where id = e.id and id_tenant = e.id_tenant;
  perform public.dulabs_cms_auditar(e.id_tenant, e.tipo, e.id, 'despublicar', e.version_activa, null, jsonb_build_object('estado', e.estado, 'version', e.version_activa), jsonb_build_object('estado', 'borrador'), p_actor, p_etiqueta);
  return jsonb_build_object('resultado', 'ok', 'entidad', public.dulabs_cms_entidad_json(e.id_tenant, e.id));
end;
$$;

-- ARCHIVAR / DESARCHIVAR: saca un elemento (que NO esté en vivo) de las listas. No se borra nada.
create or replace function public.dulabs_cms_archivar(p_tenant uuid, p_id uuid, p_actor uuid, p_etiqueta text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.dulabs_cms_entidades;
begin
  if p_tenant is null or p_id is null then return jsonb_build_object('resultado', 'invalido'); end if;
  e := public.dulabs_cms_bloquear(p_tenant, p_id);
  if e.id is null then return jsonb_build_object('resultado', 'no_encontrada'); end if;
  if e.estado <> 'borrador' then return jsonb_build_object('resultado', 'estado_invalido', 'estado', e.estado); end if;
  if e.archivada_at is not null then return jsonb_build_object('resultado', 'estado_invalido', 'estado', 'archivada'); end if;
  update public.dulabs_cms_entidades set archivada_at = now(), rev = e.rev + 1, updated_at = now(), updated_by = p_actor where id = e.id and id_tenant = e.id_tenant;
  perform public.dulabs_cms_auditar(e.id_tenant, e.tipo, e.id, 'archivar', null, null, jsonb_build_object('archivada', false), jsonb_build_object('archivada', true), p_actor, p_etiqueta);
  return jsonb_build_object('resultado', 'ok', 'entidad', public.dulabs_cms_entidad_json(e.id_tenant, e.id));
end;
$$;

create or replace function public.dulabs_cms_desarchivar(p_tenant uuid, p_id uuid, p_actor uuid, p_etiqueta text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.dulabs_cms_entidades;
begin
  if p_tenant is null or p_id is null then return jsonb_build_object('resultado', 'invalido'); end if;
  e := public.dulabs_cms_bloquear(p_tenant, p_id);
  if e.id is null then return jsonb_build_object('resultado', 'no_encontrada'); end if;
  if e.archivada_at is null then return jsonb_build_object('resultado', 'estado_invalido', 'estado', e.estado); end if;
  update public.dulabs_cms_entidades set archivada_at = null, rev = e.rev + 1, updated_at = now(), updated_by = p_actor where id = e.id and id_tenant = e.id_tenant;
  perform public.dulabs_cms_auditar(e.id_tenant, e.tipo, e.id, 'desarchivar', null, null, jsonb_build_object('archivada', true), jsonb_build_object('archivada', false), p_actor, p_etiqueta);
  return jsonb_build_object('resultado', 'ok', 'entidad', public.dulabs_cms_entidad_json(e.id_tenant, e.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Lecturas del editor (incluyen borradores)
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_cms_listar(p_tenant uuid, p_tipo text default null, p_estado text default null, p_incluir_archivadas boolean default false)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(public.dulabs_cms_entidad_json(e.id_tenant, e.id) order by e.updated_at desc, e.id), '[]'::jsonb)
    from public.dulabs_cms_entidades e
   where e.id_tenant = p_tenant
     and (p_tipo is null or e.tipo = p_tipo)
     and (p_estado is null or e.estado = p_estado)
     and (p_incluir_archivadas or e.archivada_at is null);
$$;

create or replace function public.dulabs_cms_obtener(p_tenant uuid, p_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select public.dulabs_cms_entidad_json(p_tenant, p_id);
$$;

create or replace function public.dulabs_cms_versiones_listar(p_tenant uuid, p_id uuid, p_limite integer default 50)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x.fila order by x.version desc), '[]'::jsonb)
    from (
      select v.version,
             jsonb_build_object('id', v.id, 'entidad_id', v.entidad_id, 'version', v.version, 'contenido', v.contenido, 'checksum', v.checksum, 'accion', v.accion,
                                'restaurada_de', v.restaurada_de, 'nota', v.nota, 'creado_por', v.creado_por, 'creado_por_etiqueta', v.creado_por_etiqueta, 'created_at', v.created_at) as fila
        from public.dulabs_cms_versiones v
       where v.id_tenant = p_tenant and v.entidad_id = p_id
       order by v.version desc
       limit greatest(1, least(coalesce(p_limite, 50), 200))
    ) x;
$$;

create or replace function public.dulabs_cms_version(p_tenant uuid, p_id uuid, p_version integer)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object('id', v.id, 'entidad_id', v.entidad_id, 'version', v.version, 'contenido', v.contenido, 'checksum', v.checksum, 'accion', v.accion,
                             'restaurada_de', v.restaurada_de, 'nota', v.nota, 'creado_por', v.creado_por, 'creado_por_etiqueta', v.creado_por_etiqueta, 'created_at', v.created_at)
    from public.dulabs_cms_versiones v
   where v.id_tenant = p_tenant and v.entidad_id = p_id and v.version = p_version;
$$;

create or replace function public.dulabs_cms_auditoria_listar(p_tenant uuid, p_id uuid default null, p_limite integer default 50, p_antes_de bigint default null)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x.fila order by x.id desc), '[]'::jsonb)
    from (
      select a.id,
             jsonb_build_object('id', a.id, 'entidad_tipo', a.entidad_tipo, 'entidad_id', a.entidad_id, 'accion', a.accion, 'version', a.version, 'nota', a.nota,
                                'antes', a.antes, 'despues', a.despues, 'actor_user_id', a.actor_user_id, 'actor_etiqueta', a.actor_etiqueta, 'created_at', a.created_at) as fila
        from public.dulabs_cms_auditoria a
       where a.id_tenant = p_tenant
         and (p_id is null or a.entidad_id = p_id)
         and (p_antes_de is null or a.id < p_antes_de)
       order by a.id desc
       limit greatest(1, least(coalesce(p_limite, 50), 200))
    ) x;
$$;

-- ---------------------------------------------------------------------------
-- LECTURA PÚBLICA: lo ÚNICO que consumen la tienda, el precio efectivo del pedido y ARIA.
-- Solo elementos publicados (no borradores, no pausados, no archivados), con su versión activa, y solo si el módulo está habilitado para el negocio.
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_cms_lectura_activa(p_tenant uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if p_tenant is null or not exists (select 1 from public.dulabs_tenant_modulos m where m.id_tenant = p_tenant and m.modulo = 'cms_comercial' and m.habilitado) then
    return jsonb_build_object('habilitado', false, 'entidades', '[]'::jsonb, 'assets', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'habilitado', true,
    'entidades', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'tipo', e.tipo, 'clave', e.clave, 'estado', e.estado, 'version', v.version, 'checksum', v.checksum,
                                          'contenido', v.contenido, 'publicada_at', v.created_at, 'creada_at', e.created_at) order by e.tipo, e.clave)
        from public.dulabs_cms_entidades e
        join public.dulabs_cms_versiones v on v.entidad_id = e.id and v.id_tenant = e.id_tenant and v.version = e.version_activa
       where e.id_tenant = p_tenant and e.estado = 'publicada' and e.archivada_at is null), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'storage_path', a.storage_path, 'mime_type', a.mime_type, 'ancho', a.ancho, 'alto', a.alto) order by a.created_at, a.id)
        from public.dulabs_cms_assets a
       where a.id_tenant = p_tenant and a.estado = 'listo'), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Imágenes
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_cms_asset_json(p_tenant uuid, p_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object('id', a.id, 'id_tenant', a.id_tenant, 'storage_path', a.storage_path, 'mime_type', a.mime_type, 'bytes', a.bytes, 'ancho', a.ancho,
                            'alto', a.alto, 'estado', a.estado, 'nombre_original', a.nombre_original, 'created_at', a.created_at)
    from public.dulabs_cms_assets a
   where a.id = p_id and a.id_tenant = p_tenant;
$$;

-- El servidor decide el id y la ruta; el navegador solo sube a esa ruta.
create or replace function public.dulabs_cms_asset_crear(p_tenant uuid, p_id uuid, p_storage_path text, p_mime text, p_bytes integer, p_ancho integer, p_alto integer, p_nombre text, p_actor uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_tenant is null or p_id is null or p_storage_path is null or p_mime is null or p_bytes is null or p_ancho is null or p_alto is null then
    return jsonb_build_object('resultado', 'invalido');
  end if;
  begin
    insert into public.dulabs_cms_assets (id, id_tenant, storage_path, mime_type, bytes, ancho, alto, nombre_original, created_by)
    values (p_id, p_tenant, p_storage_path, p_mime, p_bytes, p_ancho, p_alto, p_nombre, p_actor);
  exception
    when unique_violation then return jsonb_build_object('resultado', 'existente');
    when check_violation then return jsonb_build_object('resultado', 'invalido');
  end;
  return jsonb_build_object('resultado', 'ok', 'asset', public.dulabs_cms_asset_json(p_tenant, p_id));
end;
$$;

-- El servidor verificó el archivo subido (tipo, tamaño, firma y dimensiones reales): queda listo para usarse y se audita.
create or replace function public.dulabs_cms_asset_confirmar(p_tenant uuid, p_id uuid, p_bytes integer, p_ancho integer, p_alto integer, p_actor uuid, p_etiqueta text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  a public.dulabs_cms_assets;
begin
  if p_tenant is null or p_id is null or p_bytes is null or p_ancho is null or p_alto is null then
    return jsonb_build_object('resultado', 'invalido');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dulabs_cms:a:' || p_tenant::text || ':' || p_id::text, 0));
  select * into a from public.dulabs_cms_assets where id = p_id and id_tenant = p_tenant for update;
  if a.id is null then return jsonb_build_object('resultado', 'no_encontrada'); end if;
  if a.estado = 'listo' then return jsonb_build_object('resultado', 'ok', 'asset', public.dulabs_cms_asset_json(p_tenant, p_id)); end if;
  begin
    update public.dulabs_cms_assets set estado = 'listo', bytes = p_bytes, ancho = p_ancho, alto = p_alto, confirmed_at = now() where id = a.id and id_tenant = a.id_tenant;
  exception when check_violation then
    return jsonb_build_object('resultado', 'invalido');
  end;
  perform public.dulabs_cms_auditar(p_tenant, 'imagen', p_id, 'subir_imagen', null, null, null,
                                    jsonb_build_object('mime_type', a.mime_type, 'bytes', p_bytes, 'ancho', p_ancho, 'alto', p_alto, 'nombre_original', a.nombre_original), p_actor, p_etiqueta);
  return jsonb_build_object('resultado', 'ok', 'asset', public.dulabs_cms_asset_json(p_tenant, p_id));
end;
$$;

create or replace function public.dulabs_cms_asset_obtener(p_tenant uuid, p_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select public.dulabs_cms_asset_json(p_tenant, p_id);
$$;

create or replace function public.dulabs_cms_assets_listar(p_tenant uuid, p_limite integer default 200)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(public.dulabs_cms_asset_json(x.id_tenant, x.id) order by x.created_at desc, x.id), '[]'::jsonb)
    from (
      select a.id, a.id_tenant, a.created_at from public.dulabs_cms_assets a
       where a.id_tenant = p_tenant and a.estado = 'listo'
       order by a.created_at desc, a.id
       limit greatest(1, least(coalesce(p_limite, 200), 500))
    ) x;
$$;

-- ============================================================
-- 7. PERMISOS: solo service_role ejecuta estas funciones
-- ============================================================
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'dulabs\_cms\_%'
  loop
    execute format('revoke all on function %s from public', r.firma);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', r.firma);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', r.firma);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', r.firma);
    end if;
  end loop;
end;
$$;

commit;
