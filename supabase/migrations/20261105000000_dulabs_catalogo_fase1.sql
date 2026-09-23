-- DuLabs Catálogo — Fase 1 (autorizado, "APROBACIÓN TÉCNICA — FASE 1 CATÁLOGO").
--
-- Evoluciona la fuente de verdad EXISTENTE de productos
-- (dulabs_inventario_productos, 20260923000000) en vez de crear una tabla
-- paralela: ya la consumen AMORE (tienda, compra por WhatsApp, ventas,
-- importación Excel), el Business Agent (ProductsModule) y el compilador del
-- agente (cotización). TODO es ADITIVO:
--   - ninguna columna existente se renombra, elimina ni cambia de tipo;
--   - las columnas nuevas son nullable o tienen default, y los defaults
--     preservan EXACTAMENTE el comportamiento actual (controla_stock = true);
--   - ningún consumidor actual necesita cambiar para seguir funcionando.
--
-- Reglas protegidas en la CAPA DE DATOS (no en la app), para que valgan sin
-- importar quién escriba (catálogo, AMORE, Business Agent, importaciones,
-- futuras APIs o herramientas del agente):
--   1. `referencia` comercial (DL-000001...) asignada por trigger BEFORE
--      INSERT con un contador por tenant bloqueado por fila (INSERT ... ON
--      CONFLICT DO UPDATE ... RETURNING): dos inserciones concurrentes del
--      mismo tenant se serializan y NUNCA obtienen el mismo número. El valor
--      que mande el caller se ignora. UNIQUE(id_tenant, referencia) es la
--      segunda barrera y un CHECK de formato la tercera.
--   2. `referencia` es INMUTABLE (trigger BEFORE UPDATE).
--   3. Auditoría append-only (dulabs_catalogo_eventos) escrita por trigger
--      AFTER INSERT/UPDATE/DELETE en la MISMA transacción del cambio.
--   4. Media de producto aislada por tenant (FK compuesta) y con la ruta de
--      Storage obligatoriamente bajo {id_tenant}/{producto_id}/.
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver
-- PENDING_MIGRATIONS.md). Transacción EXPLÍCITA a propósito: el backfill de
-- referencias, el SET NOT NULL y la creación de triggers deben aplicarse
-- todos o ninguno. El primer ALTER TABLE toma un lock ACCESS EXCLUSIVE sobre
-- dulabs_inventario_productos hasta el COMMIT: las lecturas/escrituras de
-- AMORE y del Business Agent esperan (milisegundos con el volumen actual),
-- nunca ven un estado intermedio.

begin;

-- ============================================================
-- 1. MÓDULOS POR TENANT
-- ============================================================
-- Mecanismo GENÉRICO para habilitar módulos del dashboard por tenant, sin
-- hardcodear ningún negocio en el código. Catálogo es el primer módulo.
create table if not exists public.dulabs_tenant_modulos (
  id_tenant uuid not null,
  modulo text not null check (modulo ~ '^[a-z][a-z0-9_]{1,39}$'),
  habilitado boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id_tenant, modulo)
);

alter table public.dulabs_tenant_modulos enable row level security;

comment on table public.dulabs_tenant_modulos is
  'Módulos del dashboard habilitados por tenant (ej. modulo = ''catalogo''). Sin fila o habilitado = false => módulo apagado. Solo el backend (service_role) la lee; el tenant siempre sale de la membresía, nunca del frontend.';

-- ============================================================
-- 2. CATEGORÍAS
-- ============================================================
create table if not exists public.dulabs_catalogo_categorias (
  id uuid not null default gen_random_uuid(),
  id_tenant uuid not null,
  nombre text not null check (char_length(btrim(nombre)) between 1 and 60),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id_tenant, id)
);

create unique index if not exists dulabs_catalogo_categorias_nombre_uq
  on public.dulabs_catalogo_categorias (id_tenant, lower(btrim(nombre)));

alter table public.dulabs_catalogo_categorias enable row level security;

comment on table public.dulabs_catalogo_categorias is
  'Categorías del catálogo por tenant. Nombre único por tenant sin distinguir mayúsculas. dulabs_inventario_productos.categoria (texto legado) se mantiene sincronizado con el nombre de la categoría por el servicio del catálogo.';

-- ============================================================
-- 3. SECUENCIAS DE REFERENCIA
-- ============================================================
create table if not exists public.dulabs_catalogo_secuencias (
  id_tenant uuid primary key,
  prefijo text not null default 'DL' check (prefijo ~ '^[A-Z]{1,6}$'),
  ultimo_numero bigint not null default 0 check (ultimo_numero >= 0),
  updated_at timestamptz not null default now()
);

alter table public.dulabs_catalogo_secuencias enable row level security;

comment on table public.dulabs_catalogo_secuencias is
  'Contador de referencias comerciales por tenant. Solo lo escribe el trigger dulabs_catalogo_asignar_referencia (lock de fila vía INSERT ... ON CONFLICT DO UPDATE). prefijo configurable por tenant (default DL).';

-- Formato canónico: PREFIJO-000001. Nunca trunca: a partir de 1.000.000
-- simplemente usa más dígitos (lpad a secas cortaría el número).
create or replace function public.dulabs_catalogo_formatear_referencia(p_prefijo text, p_numero bigint)
returns text
language sql
immutable
as $$
  select p_prefijo || '-' || lpad(p_numero::text, greatest(6, char_length(p_numero::text)), '0')
$$;

-- ============================================================
-- 4. COLUMNAS ADITIVAS EN dulabs_inventario_productos
-- ============================================================
alter table public.dulabs_inventario_productos
  add column if not exists referencia text,
  add column if not exists precio_mayor integer check (precio_mayor is null or precio_mayor >= 0),
  add column if not exists material text check (material is null or char_length(material) <= 80),
  add column if not exists color text check (color is null or char_length(color) <= 80),
  add column if not exists categoria_id uuid,
  add column if not exists controla_stock boolean not null default true,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid,
  add column if not exists escritura_id uuid;

comment on column public.dulabs_inventario_productos.referencia is
  'Referencia comercial (ej. DL-000184), asignada por la BD, única por tenant e inmutable. NO es la PK (la PK sigue siendo (id_tenant, id)).';
comment on column public.dulabs_inventario_productos.precio is
  'COP, entero >= 0. El negocio no maneja centavos. Para el Catálogo es el precio DETAL (retail); los consumidores existentes lo siguen leyendo igual.';
comment on column public.dulabs_inventario_productos.precio_mayor is
  'Precio al por MAYOR (wholesale) en COP, entero >= 0, opcional. El mismo producto tiene ambos precios: nunca se duplica un producto por tener dos precios.';
comment on column public.dulabs_inventario_productos.controla_stock is
  'true (default, comportamiento histórico) = stock se valida (cotización, tienda, ventas). false = el negocio no controla inventario desde DuLabs: la cotización no marca stock insuficiente ni "agotado". Los productos creados desde el Catálogo nacen en false.';
comment on column public.dulabs_inventario_productos.escritura_id is
  'Token de escritura: cada escritura del Catálogo lo renueva junto con updated_by. Si una escritura NO lo renueva (AMORE, ventas, Business Agent), la auditoría la registra sin actor y updated_by se limpia -- así nunca se atribuye a un usuario un cambio que no hizo.';

-- FK compuesta: un producto solo puede apuntar a una categoría de su MISMO
-- tenant. MATCH SIMPLE: categoria_id null (todos los productos existentes)
-- no se valida.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dulabs_inventario_productos_categoria_fk') then
    alter table public.dulabs_inventario_productos
      add constraint dulabs_inventario_productos_categoria_fk
      foreign key (id_tenant, categoria_id)
      references public.dulabs_catalogo_categorias (id_tenant, id);
  end if;
end $$;

-- ============================================================
-- 5. BACKFILL DE REFERENCIAS (productos existentes)
-- ============================================================
-- Se ejecuta ANTES de crear los triggers (el de inmutabilidad rechazaría
-- este UPDATE y el de auditoría lo registraría como un cambio de usuario).
-- No toca updated_at: asignar la referencia no es una modificación del
-- negocio.
insert into public.dulabs_catalogo_secuencias (id_tenant)
select distinct p.id_tenant from public.dulabs_inventario_productos p
on conflict (id_tenant) do nothing;

with pendientes as (
  select p.id_tenant,
         p.id,
         s.prefijo,
         s.ultimo_numero + row_number() over (partition by p.id_tenant order by p.created_at, p.id) as numero
  from public.dulabs_inventario_productos p
  join public.dulabs_catalogo_secuencias s on s.id_tenant = p.id_tenant
  where p.referencia is null
)
update public.dulabs_inventario_productos p
set referencia = public.dulabs_catalogo_formatear_referencia(pe.prefijo, pe.numero)
from pendientes pe
where p.id_tenant = pe.id_tenant and p.id = pe.id;

update public.dulabs_catalogo_secuencias s
set ultimo_numero = m.maximo, updated_at = now()
from (
  select id_tenant, max(substring(referencia from '([0-9]+)$')::bigint) as maximo
  from public.dulabs_inventario_productos
  where referencia is not null
  group by id_tenant
) m
where s.id_tenant = m.id_tenant and m.maximo > s.ultimo_numero;

alter table public.dulabs_inventario_productos alter column referencia set not null;

create unique index if not exists dulabs_inventario_productos_referencia_uq
  on public.dulabs_inventario_productos (id_tenant, referencia);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dulabs_inventario_productos_referencia_formato') then
    alter table public.dulabs_inventario_productos
      add constraint dulabs_inventario_productos_referencia_formato
      check (referencia ~ '^[A-Z]{1,6}-[0-9]{6,}$');
  end if;
end $$;

-- Índices del listado del Catálogo (orden por recientes, filtro por categoría).
create index if not exists dulabs_inventario_productos_tenant_created_idx
  on public.dulabs_inventario_productos (id_tenant, created_at desc, id);
create index if not exists dulabs_inventario_productos_tenant_categoria_idx
  on public.dulabs_inventario_productos (id_tenant, categoria_id)
  where categoria_id is not null;

-- ============================================================
-- 6. TRIGGERS DE PRODUCTO: referencia + inmutabilidad
-- ============================================================
-- security definer: el contador y la auditoría tienen RLS sin policies; la
-- regla debe valer sin importar el rol que haga el INSERT/UPDATE.
create or replace function public.dulabs_catalogo_asignar_referencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefijo text;
  v_numero bigint;
begin
  -- Lock de fila sobre el contador del tenant hasta el fin de la
  -- transacción: inserciones concurrentes del mismo tenant se serializan.
  insert into public.dulabs_catalogo_secuencias as s (id_tenant, ultimo_numero)
  values (new.id_tenant, 1)
  on conflict (id_tenant) do update
    set ultimo_numero = s.ultimo_numero + 1, updated_at = now()
  returning s.prefijo, s.ultimo_numero into v_prefijo, v_numero;

  -- Siempre se sobreescribe: la referencia NUNCA la decide el caller.
  new.referencia := public.dulabs_catalogo_formatear_referencia(v_prefijo, v_numero);
  return new;
end;
$$;

drop trigger if exists dulabs_catalogo_asignar_referencia on public.dulabs_inventario_productos;
create trigger dulabs_catalogo_asignar_referencia
  before insert on public.dulabs_inventario_productos
  for each row execute function public.dulabs_catalogo_asignar_referencia();

create or replace function public.dulabs_catalogo_proteger_producto()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.referencia is distinct from old.referencia then
    raise exception using errcode = 'CT001', message = 'referencia_inmutable';
  end if;
  -- created_by es histórico: nadie lo reescribe.
  new.created_by := old.created_by;
  -- Escritura que no renovó el token (AMORE, RPC de ventas, Business
  -- Agent): no hay actor verificable, se limpia updated_by para no
  -- atribuirle el cambio al último usuario del Catálogo.
  if new.escritura_id is not distinct from old.escritura_id then
    new.updated_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists dulabs_catalogo_proteger_producto on public.dulabs_inventario_productos;
create trigger dulabs_catalogo_proteger_producto
  before update on public.dulabs_inventario_productos
  for each row execute function public.dulabs_catalogo_proteger_producto();

-- ============================================================
-- 7. AUDITORÍA APPEND-ONLY
-- ============================================================
create table if not exists public.dulabs_catalogo_eventos (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  producto_id uuid not null,
  referencia text,
  accion text not null check (accion in ('creado', 'actualizado', 'eliminado')),
  actor_user_id uuid,
  cambios jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists dulabs_catalogo_eventos_producto_idx
  on public.dulabs_catalogo_eventos (id_tenant, producto_id, created_at desc);

alter table public.dulabs_catalogo_eventos enable row level security;

comment on table public.dulabs_catalogo_eventos is
  'Auditoría APPEND-ONLY de dulabs_inventario_productos, escrita por trigger en la misma transacción del cambio (cubre todos los caminos de escritura). creado/eliminado guardan la fila completa; actualizado guarda solo {columna: {antes, despues}}. actor_user_id = usuario de Supabase Auth, null si la escritura no vino del Catálogo. Sin FK al producto a propósito: el historial sobrevive al borrado físico.';

create or replace function public.dulabs_catalogo_eventos_inmutables()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = 'CT002', message = 'auditoria_append_only';
end;
$$;

drop trigger if exists dulabs_catalogo_eventos_inmutables on public.dulabs_catalogo_eventos;
create trigger dulabs_catalogo_eventos_inmutables
  before update or delete on public.dulabs_catalogo_eventos
  for each row execute function public.dulabs_catalogo_eventos_inmutables();

create or replace function public.dulabs_catalogo_auditar_producto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_excluidas text[] := array['updated_at', 'updated_by', 'escritura_id'];
  v_cambios jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.dulabs_catalogo_eventos (id_tenant, producto_id, referencia, accion, actor_user_id, cambios)
    values (new.id_tenant, new.id, new.referencia, 'creado', new.created_by, to_jsonb(new) - v_excluidas);
    return new;
  elsif tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('antes', o.value, 'despues', n.value)), '{}'::jsonb)
      into v_cambios
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value
      and not (n.key = any (v_excluidas));
    if v_cambios = '{}'::jsonb then
      return new;
    end if;
    insert into public.dulabs_catalogo_eventos (id_tenant, producto_id, referencia, accion, actor_user_id, cambios)
    values (
      new.id_tenant, new.id, new.referencia, 'actualizado',
      case when new.escritura_id is distinct from old.escritura_id then new.updated_by else null end,
      v_cambios
    );
    return new;
  else
    insert into public.dulabs_catalogo_eventos (id_tenant, producto_id, referencia, accion, actor_user_id, cambios)
    values (old.id_tenant, old.id, old.referencia, 'eliminado', null, to_jsonb(old) - v_excluidas);
    return old;
  end if;
end;
$$;

drop trigger if exists dulabs_catalogo_auditar_producto on public.dulabs_inventario_productos;
create trigger dulabs_catalogo_auditar_producto
  after insert or update or delete on public.dulabs_inventario_productos
  for each row execute function public.dulabs_catalogo_auditar_producto();

-- ============================================================
-- 8. MEDIA DE PRODUCTO
-- ============================================================
-- Imágenes en Storage (bucket EXISTENTE inventario-productos, misma
-- convención {id_tenant}/{producto_id}/{uuid}.{ext}); aquí solo la ruta y
-- la metadata, nunca el binario. ON DELETE CASCADE: el Business Agent borra
-- productos físicamente y ese borrado no debe empezar a fallar.
create table if not exists public.dulabs_catalogo_media (
  id uuid not null default gen_random_uuid(),
  id_tenant uuid not null,
  producto_id uuid not null,
  storage_path text not null check (char_length(storage_path) between 1 and 512),
  thumb_path text check (thumb_path is null or char_length(thumb_path) between 1 and 512),
  es_principal boolean not null default false,
  orden integer not null default 0 check (orden >= 0),
  mime_type text not null check (mime_type in ('image/webp', 'image/jpeg', 'image/png')),
  bytes integer check (bytes is null or bytes > 0),
  ancho integer check (ancho is null or ancho > 0),
  alto integer check (alto is null or alto > 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (id_tenant, id),
  foreign key (id_tenant, producto_id)
    references public.dulabs_inventario_productos (id_tenant, id)
    on delete cascade,
  -- La ruta SIEMPRE vive bajo el tenant y el producto dueños de la fila.
  constraint dulabs_catalogo_media_ruta_tenant check (
    storage_path like (id_tenant::text || '/' || producto_id::text || '/%')
    and (thumb_path is null or thumb_path like (id_tenant::text || '/' || producto_id::text || '/%'))
  )
);

create unique index if not exists dulabs_catalogo_media_principal_uq
  on public.dulabs_catalogo_media (id_tenant, producto_id)
  where es_principal;
create unique index if not exists dulabs_catalogo_media_ruta_uq
  on public.dulabs_catalogo_media (storage_path);
create index if not exists dulabs_catalogo_media_producto_idx
  on public.dulabs_catalogo_media (id_tenant, producto_id, orden);

alter table public.dulabs_catalogo_media enable row level security;

comment on table public.dulabs_catalogo_media is
  'Imágenes de productos del Catálogo (principal + adicionales, ordenadas). La principal se refleja en dulabs_inventario_productos.foto_url para los consumidores existentes. Se escribe SOLO vía dulabs_catalogo_adjuntar_media / dulabs_catalogo_eliminar_media (atómicas).';

-- Adjunta una imagen ya subida y verificada por el backend. Atómica: lock
-- del producto, promoción de principal y sincronización de foto_url en una
-- sola transacción. p_url_base = URL pública del bucket (termina en '/').
create or replace function public.dulabs_catalogo_adjuntar_media(
  p_tenant uuid,
  p_producto uuid,
  p_storage_path text,
  p_thumb_path text,
  p_mime_type text,
  p_bytes integer,
  p_ancho integer,
  p_alto integer,
  p_principal boolean,
  p_actor uuid,
  p_url_base text
) returns public.dulabs_catalogo_media
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hay_principal boolean;
  v_principal boolean;
  v_orden integer;
  v_media public.dulabs_catalogo_media;
begin
  perform 1 from public.dulabs_inventario_productos
  where id_tenant = p_tenant and id = p_producto
  for update;
  if not found then
    raise exception using errcode = 'CT003', message = 'producto_no_encontrado';
  end if;

  select exists (
    select 1 from public.dulabs_catalogo_media
    where id_tenant = p_tenant and producto_id = p_producto and es_principal
  ) into v_hay_principal;

  v_principal := coalesce(p_principal, false) or not v_hay_principal;

  if v_principal and v_hay_principal then
    update public.dulabs_catalogo_media
    set es_principal = false
    where id_tenant = p_tenant and producto_id = p_producto and es_principal;
  end if;

  select coalesce(max(orden) + 1, 0) into v_orden
  from public.dulabs_catalogo_media
  where id_tenant = p_tenant and producto_id = p_producto;

  insert into public.dulabs_catalogo_media
    (id_tenant, producto_id, storage_path, thumb_path, es_principal, orden, mime_type, bytes, ancho, alto, created_by)
  values
    (p_tenant, p_producto, p_storage_path, p_thumb_path, v_principal, v_orden, p_mime_type, p_bytes, p_ancho, p_alto, p_actor)
  returning * into v_media;

  if v_principal then
    update public.dulabs_inventario_productos
    set foto_url = p_url_base || p_storage_path,
        updated_at = now(),
        updated_by = p_actor,
        escritura_id = gen_random_uuid()
    where id_tenant = p_tenant and id = p_producto;
  end if;

  return v_media;
end;
$$;

-- Elimina una imagen. Si era la principal, promueve la siguiente por orden
-- (o deja foto_url en null si no queda ninguna). Devuelve la fila borrada
-- para que el backend elimine los objetos de Storage.
create or replace function public.dulabs_catalogo_eliminar_media(
  p_tenant uuid,
  p_media uuid,
  p_actor uuid,
  p_url_base text
) returns public.dulabs_catalogo_media
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media public.dulabs_catalogo_media;
  v_siguiente public.dulabs_catalogo_media;
begin
  select * into v_media from public.dulabs_catalogo_media
  where id_tenant = p_tenant and id = p_media;
  if not found then
    raise exception using errcode = 'CT004', message = 'media_no_encontrada';
  end if;

  perform 1 from public.dulabs_inventario_productos
  where id_tenant = p_tenant and id = v_media.producto_id
  for update;

  delete from public.dulabs_catalogo_media where id_tenant = p_tenant and id = p_media;

  if v_media.es_principal then
    select * into v_siguiente from public.dulabs_catalogo_media
    where id_tenant = p_tenant and producto_id = v_media.producto_id
    order by orden, created_at
    limit 1;

    if found then
      update public.dulabs_catalogo_media set es_principal = true
      where id_tenant = p_tenant and id = v_siguiente.id;
    end if;

    update public.dulabs_inventario_productos
    set foto_url = case when v_siguiente.id is null then null else p_url_base || v_siguiente.storage_path end,
        updated_at = now(),
        updated_by = p_actor,
        escritura_id = gen_random_uuid()
    where id_tenant = p_tenant and id = v_media.producto_id;
  end if;

  return v_media;
end;
$$;

revoke all on function public.dulabs_catalogo_adjuntar_media(uuid, uuid, text, text, text, integer, integer, integer, boolean, uuid, text) from public;
grant execute on function public.dulabs_catalogo_adjuntar_media(uuid, uuid, text, text, text, integer, integer, integer, boolean, uuid, text) to service_role;
revoke all on function public.dulabs_catalogo_eliminar_media(uuid, uuid, uuid, text) from public;
grant execute on function public.dulabs_catalogo_eliminar_media(uuid, uuid, uuid, text) to service_role;

commit;
