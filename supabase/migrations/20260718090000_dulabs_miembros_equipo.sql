-- Tabla de miembros de equipo. tenant_id es el mismo id_tenant usado hoy en
-- dulabs_clientes_config / dulabs_suscripciones / dulabs_pagos / dulabs_campanas
-- / dulabs_plantillas (el alcance del equipo es TODO el tenant, no un número
-- en particular). user_id es UNIQUE: en esta fase cada usuario de Supabase
-- Auth pertenece a un solo tenant (no hay multi-tenencia por usuario todavía).
create table public.dulabs_miembros_equipo (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  nombre text,
  rol text not null default 'agente',
  estado text not null default 'invitado',
  invitado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_miembros_equipo_rol_check check (rol in ('admin', 'agente', 'lectura')),
  constraint dulabs_miembros_equipo_estado_check check (estado in ('invitado', 'activo', 'suspendido')),
  constraint dulabs_miembros_equipo_user_id_key unique (user_id),
  constraint dulabs_miembros_equipo_email_key unique (email)
);

create index dulabs_miembros_equipo_tenant_id_idx on public.dulabs_miembros_equipo (tenant_id);

comment on table public.dulabs_miembros_equipo is
  'Miembros de un equipo (tenant). tenant_id = id_tenant usado en el resto de dulabs_*. user_id es UNIQUE: esta fase asume que un usuario pertenece a un solo tenant.';
comment on column public.dulabs_miembros_equipo.rol is 'admin | agente | lectura';
comment on column public.dulabs_miembros_equipo.estado is 'invitado (invitación enviada, aún no confirmó su primer login) | activo | suspendido (acceso revocado, historial conservado)';
comment on column public.dulabs_miembros_equipo.email is 'Copia del correo al momento de invitar/provisionar, para listar el equipo sin llamar a la Admin API de Supabase en cada carga.';

alter table public.dulabs_miembros_equipo enable row level security;
