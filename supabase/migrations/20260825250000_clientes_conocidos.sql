-- Registro liviano de clientas conocidas por número, para que el bot pueda
-- saludarlas por su nombre en cualquier conversación futura -- no solo
-- dentro de la ventana de 24h que ya cubre el historial de chat reciente
-- (ver lib/historial-conversacion.ts). Se llena SOLO con nombres que la
-- clienta dio de verdad al agendar (no con el nombre de perfil de WhatsApp,
-- que no es confiable).
create table if not exists public.dulabs_clientes_conocidos (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null,
  telefono_cliente text not null,
  nombre text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_clientes_conocidos_unico unique (phone_number_id, telefono_cliente)
);

alter table public.dulabs_clientes_conocidos enable row level security;

comment on table public.dulabs_clientes_conocidos is
  'Nombre conocido de una clienta por número de WhatsApp, para reconocerla en conversaciones futuras. Se actualiza con el nombre más reciente que dio al agendar.';
