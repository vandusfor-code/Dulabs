-- Du Labs · Du IA Business — tabla multi-tenant de configuración de clientes.
-- Ejecutar en Supabase (SQL Editor) o con `supabase db push`.

create extension if not exists "pgcrypto";

create table if not exists public.dulabs_clientes_config (
  id uuid primary key default gen_random_uuid(),
  nombre_negocio text not null,
  waba_id text not null,
  phone_number_id text not null,
  telefono_negocio text not null,
  prompt_ia text,
  api_key_ia text,
  estado_pausa boolean not null default false,
  pausado_hasta timestamptz,
  created_at timestamptz not null default now()
);

-- phone_number_id es la clave de enrutamiento del webhook: debe ser único.
create unique index if not exists dulabs_clientes_config_phone_number_id_idx
  on public.dulabs_clientes_config (phone_number_id);

create index if not exists dulabs_clientes_config_waba_id_idx
  on public.dulabs_clientes_config (waba_id);

-- RLS activo sin políticas: solo el service_role (backend de Du Labs) puede
-- leer/escribir. El anon key del frontend no tiene acceso a esta tabla.
alter table public.dulabs_clientes_config enable row level security;

comment on table public.dulabs_clientes_config is
  'Configuración por negocio (tenant) para el webhook central de WhatsApp de Du Labs.';
comment on column public.dulabs_clientes_config.estado_pausa is
  'true cuando el dueño intervino manualmente desde su celular (eco de coexistencia) y la IA debe guardar silencio.';
comment on column public.dulabs_clientes_config.pausado_hasta is
  'Fin de la ventana de pausa humana (ahora + 30 minutos desde el último eco).';
