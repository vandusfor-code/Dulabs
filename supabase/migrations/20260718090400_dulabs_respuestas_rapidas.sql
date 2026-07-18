-- Respuestas rápidas: snippets de texto reutilizables que un miembro del
-- equipo (admin/agente) inserta en el compose box del Inbox con un atajo.
-- No son plantillas de WhatsApp (no requieren aprobación de Meta) — texto
-- interno plano. No hay campo de nombre del cliente en el esquema (los
-- clientes de WhatsApp solo se identifican por telefono_cliente), así que
-- no hace falta ningún motor de variables/merge fields.

create table public.dulabs_respuestas_rapidas (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  atajo text not null,
  mensaje text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_respuestas_rapidas_tenant_atajo_key unique (tenant_id, atajo)
);

create index dulabs_respuestas_rapidas_tenant_id_idx
  on public.dulabs_respuestas_rapidas (tenant_id);

comment on table public.dulabs_respuestas_rapidas is
  'Snippets de texto reutilizables por tenant, insertados manualmente en el compose box del Inbox. Solo admin/agente los ven y gestionan (lectura no envía mensajes).';

alter table public.dulabs_respuestas_rapidas enable row level security;

create policy tenant_select on public.dulabs_respuestas_rapidas
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());
