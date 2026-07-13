-- Embedded Signup v4 · columnas de tenant y credenciales por negocio.
-- Ejecutar en Supabase (SQL Editor).

-- 1. Renombrar waba_id → whatsapp_business_account_id (idempotente)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dulabs_clientes_config'
      and column_name = 'waba_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dulabs_clientes_config'
      and column_name = 'whatsapp_business_account_id'
  ) then
    alter table public.dulabs_clientes_config
      rename column waba_id to whatsapp_business_account_id;
  end if;
end $$;

-- 2. Columnas nuevas del flujo de onboarding
alter table public.dulabs_clientes_config
  add column if not exists id_tenant uuid not null default gen_random_uuid(),
  add column if not exists meta_permanent_token text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists dulabs_clientes_config_id_tenant_idx
  on public.dulabs_clientes_config (id_tenant);

comment on column public.dulabs_clientes_config.id_tenant is
  'Identificador del tenant. Cuando exista Supabase Auth, debe poblarse con auth.users.id.';
comment on column public.dulabs_clientes_config.meta_permanent_token is
  'Business Integration System User Access Token de larga duración emitido por Meta en el Embedded Signup.';

-- 3. updated_at automático en cada UPDATE
create or replace function public.dulabs_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists dulabs_clientes_config_updated_at on public.dulabs_clientes_config;
create trigger dulabs_clientes_config_updated_at
  before update on public.dulabs_clientes_config
  for each row execute function public.dulabs_set_updated_at();
