-- Historial de mensajes (para la vista previa/actividad reciente del dashboard)
-- y plantillas de WhatsApp (para campañas de mensajes masivos).

create table if not exists public.dulabs_mensajes_log (
  id bigint generated always as identity primary key,
  phone_number_id text not null,
  telefono_cliente text not null,
  direccion text not null, -- 'entrante' | 'saliente'
  contenido text not null,
  created_at timestamptz not null default now()
);

create index if not exists dulabs_mensajes_log_numero_idx
  on public.dulabs_mensajes_log (phone_number_id, created_at desc);

alter table public.dulabs_mensajes_log enable row level security;

comment on table public.dulabs_mensajes_log is
  'Historial de mensajes entrantes (cliente) y salientes (IA o campaña) por número, para la vista de actividad reciente del dashboard.';

create table if not exists public.dulabs_plantillas (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null,
  whatsapp_business_account_id text not null,
  nombre text not null,
  categoria text not null, -- MARKETING | UTILITY | AUTHENTICATION
  idioma text not null default 'es_CO',
  cuerpo text not null,
  meta_template_id text,
  estado text not null default 'pendiente', -- pendiente | APPROVED | REJECTED
  created_at timestamptz not null default now(),
  constraint dulabs_plantillas_unica unique (whatsapp_business_account_id, nombre, idioma)
);

create index if not exists dulabs_plantillas_tenant_idx on public.dulabs_plantillas (id_tenant);
alter table public.dulabs_plantillas enable row level security;

comment on table public.dulabs_plantillas is
  'Plantillas de mensaje de WhatsApp creadas por cada negocio, sometidas a la API de Meta para aprobación, usadas luego en campañas de envío masivo.';
