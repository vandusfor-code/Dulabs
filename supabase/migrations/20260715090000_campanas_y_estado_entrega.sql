-- Campañas como entidad propia (para agrupar los envíos de una misma
-- transmisión) y estado real de entrega/lectura por mensaje, capturado
-- desde los webhooks de estado de Meta (sent | delivered | read | failed).

create table if not exists public.dulabs_campanas (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null,
  plantilla_id bigint not null references public.dulabs_plantillas (id),
  nombre text not null,
  destinatarios_total integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists dulabs_campanas_tenant_idx on public.dulabs_campanas (id_tenant, created_at desc);
alter table public.dulabs_campanas enable row level security;

comment on table public.dulabs_campanas is
  'Una fila por envío masivo (campaña/broadcast) de una plantilla a una lista de destinatarios.';

alter table public.dulabs_mensajes_log
  add column if not exists campana_id bigint references public.dulabs_campanas (id),
  add column if not exists wamid text,
  add column if not exists estado_entrega text not null default 'enviado', -- enviado | entregado | leido | fallido
  add column if not exists respondido boolean not null default false,
  add column if not exists entregado_at timestamptz,
  add column if not exists leido_at timestamptz;

create index if not exists dulabs_mensajes_log_wamid_idx on public.dulabs_mensajes_log (wamid) where wamid is not null;
create index if not exists dulabs_mensajes_log_campana_idx on public.dulabs_mensajes_log (campana_id) where campana_id is not null;

comment on column public.dulabs_mensajes_log.wamid is
  'ID del mensaje devuelto por la API de Meta al enviarlo; permite correlacionar los webhooks de estado (delivered/read) con esta fila.';
comment on column public.dulabs_mensajes_log.respondido is
  'true si un cliente respondió citando (swipe-to-reply) este mensaje específico (context.id de Meta).';
