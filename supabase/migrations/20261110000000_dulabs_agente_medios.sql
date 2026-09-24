-- DuLabs — Fase 9: registro de las fotos de producto que envía el agente.
--
-- 100 % ADITIVO. No toca tablas existentes. Sin esta tabla el agente sigue
-- funcionando: envía fotos igual, pero si el cliente responde a una foto
-- ("quiero este") no puede saber cuál es y le pregunta (nunca adivina).
--
--   dulabs_agente_medios_enviados: cada foto que sale por WhatsApp queda
--   ligada a su wamid (el id que Meta asigna al mensaje):
--
--     wamid -> negocio + número + cliente -> referencia + producto interno + canal
--
--   Cuando el cliente responde citando la foto, Meta entrega context.id = ese
--   wamid; el backend busca SOLO dentro de la misma conversación (negocio,
--   número y cliente). Una foto de otro negocio o de otro cliente no existe
--   para esta conversación.
--
--   id_producto es interno (auditoría y detección de referencias
--   reasignadas): nunca se expone al modelo ni al cliente.
--
-- Rollback:
--   drop table if exists public.dulabs_agente_medios_enviados;
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md).

begin;

create table if not exists public.dulabs_agente_medios_enviados (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null check (char_length(phone_number_id) between 1 and 64),
  wa_id text not null check (wa_id ~ '^[0-9]{6,20}$'),
  -- wamid de Meta: único por mensaje (una foto = un mensaje).
  wamid text not null check (char_length(wamid) between 1 and 200),
  referencia text not null check (referencia ~ '^[A-Z]{1,6}-[0-9]{6,}$'),
  id_producto uuid,
  canal text not null check (canal in ('retail', 'wholesale')),
  turno integer not null check (turno >= 0),
  created_at timestamptz not null default now(),
  constraint dulabs_agente_medios_enviados_wamid unique (wamid)
);

-- Búsqueda por la foto citada, siempre dentro de la conversación.
create index if not exists dulabs_agente_medios_enviados_conversacion_idx
  on public.dulabs_agente_medios_enviados (phone_number_id, wa_id, created_at desc);
create index if not exists dulabs_agente_medios_enviados_tenant_idx
  on public.dulabs_agente_medios_enviados (id_tenant, created_at desc);

comment on table public.dulabs_agente_medios_enviados is
  'Fase 9 — fotos de producto enviadas por el agente: wamid -> referencia/producto/canal de UNA conversación. Resuelve "quiero este" cuando el cliente responde a una foto. Solo service_role.';

alter table public.dulabs_agente_medios_enviados enable row level security;
revoke all on table public.dulabs_agente_medios_enviados from anon, authenticated;

commit;
