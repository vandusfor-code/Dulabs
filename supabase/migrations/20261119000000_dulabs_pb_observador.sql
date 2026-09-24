-- Publi Bordados — Fase 2A: observador SHADOW de WhatsApp Coexistence.
--
-- 100 % ADITIVO. No toca ninguna tabla existente. Sin esta migración (o sin fila en
-- dulabs_pb_config, o con PUBLIBORDADOS_ENABLED distinto de "true") el webhook se comporta
-- exactamente igual: el observador no hace nada.
--
--   dulabs_pb_config              activación POR NÚMERO (sin secretos: ni tokens ni API keys).
--                                 En la Fase 2A solo existe el modo shadow (check shadow_mode).
--   dulabs_pb_observaciones       una fila por evento observado del número (mensaje del cliente,
--                                 eco, estado de entrega, evento desconocido). NUNCA texto, media,
--                                 URLs ni teléfonos: solo wamid, roles, tiempos, tipo y la clave de
--                                 conversación (hash). Reentregas de Meta => la misma fila con
--                                 `entregas` + 1 (sin duplicación lógica).
--   dulabs_pb_mensajes_enviados   registro de los wamid que enviará el agente de PB (Fase 2B). En la
--                                 Fase 2A queda VACÍA: sirve para clasificar un eco como AI_MESSAGE
--                                 por wamid (señal estructural, nunca por texto).
--   dulabs_pb_clave_conversacion  la MISMA clave que calcula el backend (lib/publibordados/observador/clave.ts).
--   dulabs_pb_observar            inserción idempotente en lote (solo para números con config habilitada).
--   dulabs_pb_observaciones_purgar  retención (por defecto 30 días).
--
-- Rollback:
--   drop function if exists public.dulabs_pb_observaciones_purgar(integer);
--   drop function if exists public.dulabs_pb_observar(jsonb);
--   drop function if exists public.dulabs_pb_clave_conversacion(uuid, text, text);
--   drop table if exists public.dulabs_pb_observaciones;
--   drop table if exists public.dulabs_pb_mensajes_enviados;
--   drop table if exists public.dulabs_pb_config;
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md).

begin;

create table if not exists public.dulabs_pb_config (
  phone_number_id text primary key check (char_length(phone_number_id) between 1 and 64),
  id_tenant uuid not null,
  enabled boolean not null default false,
  -- Fase 2A: solo observación. Permitir otro modo exige una migración nueva y revisada.
  shadow_mode boolean not null default true check (shadow_mode),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dulabs_pb_config is
  'Publi Bordados (Fase 2A) — activación del observador shadow por phone_number_id. Sin secretos. Además requiere PUBLIBORDADOS_ENABLED=true en el servidor. Solo service_role.';

create table if not exists public.dulabs_pb_mensajes_enviados (
  wamid text primary key check (char_length(wamid) between 1 and 200),
  id_tenant uuid not null,
  phone_number_id text not null check (char_length(phone_number_id) between 1 and 64),
  conversation_key text not null check (conversation_key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

comment on table public.dulabs_pb_mensajes_enviados is
  'Publi Bordados — wamid de cada mensaje que envíe el agente de PB (vacía en la Fase 2A). Un eco con un wamid de aquí es AI_MESSAGE. Solo service_role.';

create table if not exists public.dulabs_pb_observaciones (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null check (char_length(phone_number_id) between 1 and 64),
  -- Idempotencia semántica: msg:<wamid> | echo:<wamid> | status:<wamid>:<estado> | unk:<sha256>.
  clave text not null check (char_length(clave) between 5 and 280),
  conversation_key text check (conversation_key is null or conversation_key ~ '^[0-9a-f]{64}$'),
  event_type text not null check (event_type in (
    'CLIENT_MESSAGE', 'HUMAN_MESSAGE_ECHO', 'AI_MESSAGE', 'PLATFORM_MESSAGE_ECHO', 'ECHO_UNCLASSIFIED', 'STATUS', 'UNKNOWN_EVENT')),
  direction text not null check (direction in ('entrante', 'saliente', 'ninguna')),
  classification text check (classification is null or classification in ('AI', 'HUMAN', 'PLATFORM', 'UNKNOWN')),
  evidencia text check (evidencia is null or char_length(evidencia) <= 80),
  wamid text check (wamid is null or char_length(wamid) <= 200),
  related_wamid text check (related_wamid is null or char_length(related_wamid) <= 200),
  remitente text not null check (remitente in ('cliente', 'negocio', 'desconocido')),
  destinatario text not null check (destinatario in ('cliente', 'negocio', 'desconocido')),
  -- Campo del webhook tal como llegó (messages, smb_message_echoes, history, …) y arreglo del value.
  source text not null check (char_length(source) between 1 and 60),
  array_key text check (array_key is null or char_length(array_key) <= 60),
  event_timestamp timestamptz,
  received_at timestamptz not null,
  latencia_ms bigint,
  entregas integer not null default 1 check (entregas >= 1),
  ultima_recepcion_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  created_at timestamptz not null default now(),
  constraint dulabs_pb_observaciones_evento_unico unique (phone_number_id, clave)
);

create index if not exists dulabs_pb_observaciones_conversacion_idx
  on public.dulabs_pb_observaciones (phone_number_id, conversation_key, event_timestamp);
create index if not exists dulabs_pb_observaciones_creado_idx
  on public.dulabs_pb_observaciones (created_at);

comment on table public.dulabs_pb_observaciones is
  'Publi Bordados (Fase 2A) — observaciones shadow de Coexistence. Sin texto, media, URLs ni teléfonos (conversation_key = dulabs_pb_clave_conversacion). Reentrega de Meta => entregas + 1. Solo service_role.';

alter table public.dulabs_pb_config enable row level security;
alter table public.dulabs_pb_mensajes_enviados enable row level security;
alter table public.dulabs_pb_observaciones enable row level security;
revoke all on table public.dulabs_pb_config from anon, authenticated;
revoke all on table public.dulabs_pb_mensajes_enviados from anon, authenticated;
revoke all on table public.dulabs_pb_observaciones from anon, authenticated;

-- Misma clave que lib/publibordados/observador/clave.ts (probado con el mismo vector en ambos lados).
create or replace function public.dulabs_pb_clave_conversacion(p_tenant uuid, p_phone_number_id text, p_wa_id text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to(
    'dulabs:pb:v1:' || lower(p_tenant::text) || ':' || p_phone_number_id || ':' || regexp_replace(coalesce(p_wa_id, ''), '\D', '', 'g'),
    'UTF8')), 'hex')
$$;

-- Inserta un lote de observaciones. Solo acepta filas cuyo (phone_number_id, id_tenant) tenga
-- config HABILITADA (defensa en profundidad: el backend ya lo verificó). Una clave repetida no
-- crea otra fila: suma `entregas` y actualiza `ultima_recepcion_at`.
create or replace function public.dulabs_pb_observar(p_filas jsonb)
returns table (clave text, nueva boolean)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if jsonb_typeof(p_filas) is distinct from 'array' then
    raise exception 'dulabs_pb_observar: se esperaba un arreglo';
  end if;
  return query
  insert into public.dulabs_pb_observaciones as o (
    id_tenant, phone_number_id, clave, conversation_key, event_type, direction, classification, evidencia,
    wamid, related_wamid, remitente, destinatario, source, array_key, event_timestamp, received_at,
    latencia_ms, ultima_recepcion_at, metadata)
  select (f ->> 'id_tenant')::uuid, f ->> 'phone_number_id', f ->> 'clave', f ->> 'conversation_key',
         f ->> 'event_type', f ->> 'direction', f ->> 'classification', f ->> 'evidencia',
         f ->> 'wamid', f ->> 'related_wamid', f ->> 'remitente', f ->> 'destinatario', f ->> 'source',
         f ->> 'array_key', (f ->> 'event_timestamp')::timestamptz, (f ->> 'received_at')::timestamptz,
         (f ->> 'latencia_ms')::bigint, (f ->> 'received_at')::timestamptz, coalesce(f -> 'metadata', '{}'::jsonb)
    from jsonb_array_elements(p_filas) f
   where exists (
     select 1 from public.dulabs_pb_config c
      where c.phone_number_id = f ->> 'phone_number_id'
        and c.id_tenant = (f ->> 'id_tenant')::uuid
        and c.enabled)
  on conflict on constraint dulabs_pb_observaciones_evento_unico do update
    set entregas = o.entregas + 1,
        ultima_recepcion_at = greatest(o.ultima_recepcion_at, excluded.ultima_recepcion_at)
  returning o.clave, (o.entregas = 1);
end
$$;

create or replace function public.dulabs_pb_observaciones_purgar(p_dias integer default 30)
returns bigint
language sql
volatile
set search_path = public, pg_temp
as $$
  with borradas as (
    delete from public.dulabs_pb_observaciones
     where created_at < now() - make_interval(days => greatest(coalesce(p_dias, 30), 1))
    returning 1
  )
  select count(*) from borradas
$$;

revoke all on function public.dulabs_pb_clave_conversacion(uuid, text, text) from public, anon, authenticated;
revoke all on function public.dulabs_pb_observar(jsonb) from public, anon, authenticated;
revoke all on function public.dulabs_pb_observaciones_purgar(integer) from public, anon, authenticated;
grant execute on function public.dulabs_pb_clave_conversacion(uuid, text, text) to service_role;
grant execute on function public.dulabs_pb_observar(jsonb) to service_role;
grant execute on function public.dulabs_pb_observaciones_purgar(integer) to service_role;

commit;
