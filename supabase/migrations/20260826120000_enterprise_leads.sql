-- Formulario de contacto Enterprise de la landing (sección "¿Necesitas algo
-- más?"): captura solicitudes de proyectos a medida (CRM, sistemas
-- internos, integraciones...), distinto de los leads de campañas de
-- WhatsApp (dulabs_campaign_leads, que es para clientes de un tenant) --
-- estos son leads propios de DuLabs, sin id_tenant.
--
-- Migración puramente aditiva: no toca ninguna tabla existente.

create table if not exists public.dulabs_enterprise_leads (
  id bigint generated always as identity primary key,
  nombre text not null,
  empresa text not null,
  correo text not null,
  telefono text,
  necesidad text not null,
  detalle text,
  -- nuevo -> contactado -> ganado | descartado (seguimiento manual, no hay
  -- automatización de estado todavía).
  estado text not null default 'nuevo',
  created_at timestamptz not null default now()
);

create index if not exists dulabs_enterprise_leads_created_idx
  on public.dulabs_enterprise_leads (created_at desc);

alter table public.dulabs_enterprise_leads enable row level security;
