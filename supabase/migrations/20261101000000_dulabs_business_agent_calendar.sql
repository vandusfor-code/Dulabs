-- DuLabs Business — Agent Compiler, Bloque 15A: calendario self-service (Nylas).
--
-- Tablas NUEVAS, aditivas. NO modifican dulabs_flows/versions/clientes_config
-- ni ninguna tabla existente. Reutilizan la app Nylas existente (una API key
-- app-level server-side sirve muchos grants por cuenta — ver lib/nylas/*): aquí
-- se persiste el grant POR TENANT (self-service), no un grant global.
--
-- SEGURIDAD: grant_id y state son SECRETOS (permiten acceso al calendario del
-- tenant / CSRF). Igual que dulabs_flow_credentials: RLS habilitada SIN política
-- para `authenticated` → solo service_role lee/escribe. La UI obtiene el estado
-- (sin grant_id) por la Authoring API, nunca leyendo estas tablas directo.

-- ---------------------------------------------------------------------------
-- 1. Conexión de calendario por tenant (1:1). grant_id = credencial durable.
-- ---------------------------------------------------------------------------
create table if not exists public.dulabs_business_agent_calendar_connections (
  tenant_id uuid not null,
  provider text not null default 'nylas' check (provider in ('nylas')),
  grant_id text,
  account_email text,
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'revoked', 'error')),
  selected_calendar_id text,
  selected_calendar_name text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id)
);

comment on table public.dulabs_business_agent_calendar_connections is
  'Conexión de calendario (Nylas) por tenant para el Business Agent. grant_id es SECRETO (service_role-only). Una conexión por tenant (upsert).';
comment on column public.dulabs_business_agent_calendar_connections.grant_id is
  'Grant de Nylas (por cuenta). Credencial: nunca se expone al cliente ni se loguea. La app Nylas (NYLAS_API_KEY) lo usa server-side para /v3/grants/{grant_id}/*.';

-- ---------------------------------------------------------------------------
-- 2. States OAuth de un solo uso (CSRF/replay). tenant-bound + expiry.
-- ---------------------------------------------------------------------------
create table if not exists public.dulabs_business_agent_calendar_oauth_states (
  state text primary key,
  tenant_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists dulabs_ba_calendar_oauth_states_expiry_idx
  on public.dulabs_business_agent_calendar_oauth_states (expires_at);

comment on table public.dulabs_business_agent_calendar_oauth_states is
  'State OAuth de un solo uso para el connect de calendario. El tenant del callback se deriva de aquí (nunca del query). Consumo atómico (UPDATE ... WHERE consumed_at IS NULL). service_role-only.';

-- ---------------------------------------------------------------------------
-- RLS: habilitada SIN política authenticated (secretos) → solo service_role.
-- Mismo criterio que dulabs_flow_credentials.
-- ---------------------------------------------------------------------------
alter table public.dulabs_business_agent_calendar_connections enable row level security;
alter table public.dulabs_business_agent_calendar_oauth_states enable row level security;

-- updated_at trigger (convención DuLabs) — reutiliza la función del Flow Store.
drop trigger if exists dulabs_ba_calendar_connections_updated_at on public.dulabs_business_agent_calendar_connections;
create trigger dulabs_ba_calendar_connections_updated_at
  before update on public.dulabs_business_agent_calendar_connections
  for each row execute function public.dulabs_flow_set_updated_at();
