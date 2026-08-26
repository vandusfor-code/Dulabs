-- Cuestionario operativo de un negocio (horarios reales del equipo,
-- prioridades de asignación, duraciones de servicio...) que el dueño llena
-- una sola vez para dejar el bot bien configurado, en vez de ir corrigiendo
-- por partes cada vez que aparece un caso nuevo. Acceso por token (mismo
-- criterio que dulabs_especialistas: el link ES la autenticación, sin
-- login). Una fila por negocio -- se sobreescribe con cada guardado, no se
-- versiona.

create table if not exists public.dulabs_config_bot (
  id bigint generated always as identity primary key,
  phone_number_id text not null unique,
  token text not null unique,
  respuestas jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dulabs_config_bot_token_idx on public.dulabs_config_bot (token);

alter table public.dulabs_config_bot enable row level security;
