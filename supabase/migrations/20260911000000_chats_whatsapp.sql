-- Chats AMORE (autorizado) — persistencia REAL de conversaciones por
-- WhatsApp-QR. Auditado primero: dulabs_mensajes_log (Fase Meta Cloud API)
-- es un log plano por phone_number_id, sin id_tenant, sin hilos, sin
-- media, sin conteo de no leídos -- no sirve para esto sin romper su
-- propio uso real (vista de actividad del dashboard de Meta Cloud). Se
-- crean estructuras nuevas, GENÉRICAS por tenant (no exclusivas de AMORE),
-- namespaced como "chat_" para no confundirse con dulabs_mensajes_log.
--
-- El worker (proceso persistente, Baileys) es el ÚNICO escritor real de
-- estas tablas -- tanto mensajes entrantes como salientes se persisten
-- desde el mismo listener messages.upsert (ver worker/src/chats/), así que
-- un mensaje enviado por el panel y uno recibido del cliente pasan por el
-- mismo camino de verdad, nunca dos lógicas distintas.
create table if not exists public.dulabs_chat_conversaciones (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  telefono text not null,
  cliente_id bigint references public.dulabs_clientes_conocidos(id) on delete set null,
  nombre_visible text not null,
  ultimo_mensaje text,
  ultima_actividad timestamptz not null default now(),
  no_leidos integer not null default 0,
  -- "automatico"/"manual"/"requiere_atencion"/"archivada" (spec Fase 46).
  -- Ninguna respuesta automática del Flow Engine está conectada todavía a
  -- este canal (auditado: socket-baileys.ts nunca invocó el Flow Engine
  -- antes de esta fase) -- por eso una conversación NUEVA nace en
  -- "requiere_atencion", no en "automatico": sería falso decir que un bot
  -- la está atendiendo cuando ninguno existe conectado aún. El campo
  -- queda listo para que una fase futura de auto-respuesta real lo
  -- respete antes de contestar.
  estado text not null default 'requiere_atencion' check (estado in ('automatico', 'manual', 'requiere_atencion', 'archivada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_chat_conversaciones_unica unique (id_tenant, telefono)
);

create index if not exists dulabs_chat_conversaciones_tenant_actividad_idx
  on public.dulabs_chat_conversaciones (id_tenant, ultima_actividad desc);

alter table public.dulabs_chat_conversaciones enable row level security;

comment on table public.dulabs_chat_conversaciones is
  'Conversaciones reales de WhatsApp-QR (Chats AMORE), una fila por (tenant, teléfono). El worker es el único escritor.';

create table if not exists public.dulabs_chat_mensajes (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  conversacion_id bigint not null references public.dulabs_chat_conversaciones(id) on delete cascade,
  direccion text not null check (direccion in ('entrante', 'saliente')),
  tipo text not null check (tipo in ('texto', 'audio')),
  texto text,
  -- Ruta del objeto en Supabase Storage (bucket privado "chats-media"),
  -- NUNCA una URL pública -- se sirve solo mediante una API autenticada
  -- que verifica tenant/rol antes de generar una URL firmada.
  media_path text,
  mime_type text,
  duracion_seg integer,
  whatsapp_message_id text,
  -- "humano" (Jessica desde el panel) vs "automatico" (un futuro
  -- respondedor real) -- hoy TODO mensaje saliente es "humano" porque no
  -- existe todavía ningún respondedor automático conectado a este canal.
  origen text not null default 'humano' check (origen in ('humano', 'automatico')),
  estado text not null default 'enviado' check (estado in ('enviando', 'enviado', 'entregado', 'leido', 'error')),
  enviado_en timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists dulabs_chat_mensajes_conversacion_idx
  on public.dulabs_chat_mensajes (conversacion_id, enviado_en);
create index if not exists dulabs_chat_mensajes_tenant_idx
  on public.dulabs_chat_mensajes (id_tenant);

alter table public.dulabs_chat_mensajes enable row level security;

comment on table public.dulabs_chat_mensajes is
  'Mensajes reales de cada conversación de Chats AMORE (texto/audio), entrantes y salientes. El worker es el único escritor -- persiste ambas direcciones desde el mismo evento real de Baileys (messages.upsert), nunca dos caminos distintos.';
comment on column public.dulabs_chat_mensajes.media_path is
  'Ruta dentro del bucket privado "chats-media" (Supabase Storage), nunca una URL pública ni firmada de antemano.';

-- Bucket PRIVADO para audios/medios de Chats -- nunca se lee desde el
-- navegador con la anon key; toda descarga pasa por una API autenticada
-- server-side que usa la service role (ver app/api/agenda/[token]/chats/media).
insert into storage.buckets (id, name, public)
values ('chats-media', 'chats-media', false)
on conflict (id) do nothing;
