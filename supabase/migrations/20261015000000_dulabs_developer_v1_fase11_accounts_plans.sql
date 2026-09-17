-- DuLabs Developer V1 -- Fase 11 (Plans / Pricing / Subscriptions / Entitlements,
-- autorizado). Migración PURAMENTE ADITIVA. No borra ni modifica datos de
-- Business/AMORE. Introduce el modelo de CUENTA (la suscripción vive en la
-- cuenta y agrupa workspaces), overrides de Enterprise, columnas de plan
-- nuevas + re-seed alineado al pricing aprobado, y auditoría de cuenta.
--
-- Decisiones aprobadas (ver docs/DULABS_DEVELOPER_V1_PHASE_11_PLANS_PRICING_DESIGN.md):
--   - Suscripción por CUENTA. Números/mensajes/miembros/workspaces = límites
--     A NIVEL DE CUENTA (agregados across sus workspaces).
--   - DEVELOPER $19: 2 números, 20K msg, 1 workspace, 1 miembro, SIN adicionales.
--   - AGENCY $45: 5 números, 100K msg, 5 workspaces, 5 miembros, +$5/número adicional.
--   - ENTERPRISE $199+: límites por override (NULL = usar base). Sin cifras inventadas.
--   - Compat: workspace sin cuenta => DEVELOPER (sin backfill obligatorio).

-- ============================================================
-- 1. CUENTAS (la suscripción vive aquí)
-- ============================================================
create table if not exists public.dulabs_dev_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  plan_codigo text not null default 'DEVELOPER' references public.dulabs_dev_plans (codigo),
  estado text not null default 'active' check (estado in ('active', 'past_due', 'canceled')),
  -- Números adicionales COMPRADOS (Agency/Enterprise). Developer siempre 0.
  numeros_adicionales integer not null default 0 check (numeros_adicionales >= 0),
  periodo_inicio timestamptz,
  periodo_fin timestamptz,
  cancelar_al_fin_periodo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dulabs_dev_accounts_owner_idx on public.dulabs_dev_accounts (owner_user_id);

alter table public.dulabs_dev_accounts enable row level security;
-- RLS activo SIN políticas de select: el Dashboard lee siempre vía el backend
-- (service_role), nunca directo desde el navegador. Mismo criterio que
-- dulabs_auditoria_admin. Cero superficie de lectura cross-tenant desde el cliente.

comment on table public.dulabs_dev_accounts is
  'DuLabs Developer V1 (Fase 11). Cuenta de facturación: agrupa workspaces y porta la suscripción (plan, estado, números adicionales, período). Límites se cuentan a nivel de cuenta. RLS sin políticas -> solo service_role.';

-- ============================================================
-- 2. workspace -> cuenta (extensión aditiva de Fase 7)
-- ============================================================
-- Ausencia de fila o account_id NULL => workspace DEVELOPER sin cuenta (compat).
alter table public.dulabs_dev_workspace_plans
  add column if not exists account_id uuid references public.dulabs_dev_accounts (id);

create index if not exists dulabs_dev_workspace_plans_account_idx
  on public.dulabs_dev_workspace_plans (account_id);

comment on column public.dulabs_dev_workspace_plans.account_id is
  'DuLabs Developer V1 (Fase 11). Cuenta dueña del workspace. NULL = workspace legacy sin cuenta -> DEVELOPER por defecto. El plan efectivo se hereda de la cuenta, no de plan_codigo (legacy).';

-- ============================================================
-- 3. OVERRIDES de Enterprise (por cuenta)
-- ============================================================
create table if not exists public.dulabs_dev_plan_overrides (
  account_id uuid primary key references public.dulabs_dev_accounts (id) on delete cascade,
  numeros_incluidos integer check (numeros_incluidos is null or numeros_incluidos >= 0),
  mensajes_mensuales_incluidos integer check (mensajes_mensuales_incluidos is null or mensajes_mensuales_incluidos >= 0),
  max_workspaces integer check (max_workspaces is null or max_workspaces >= 0),
  max_members integer check (max_members is null or max_members >= 0),
  throughput_por_numero integer check (throughput_por_numero is null or throughput_por_numero >= 0),
  features jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dulabs_dev_plan_overrides enable row level security;

comment on table public.dulabs_dev_plan_overrides is
  'DuLabs Developer V1 (Fase 11). Overrides de límites por cuenta (Enterprise). NULL en una columna = usar el valor del plan base. Nunca se inventan cifras. RLS sin políticas -> solo service_role.';

-- ============================================================
-- 4. PLANES: columnas nuevas + re-seed alineado al pricing aprobado
-- ============================================================
alter table public.dulabs_dev_plans
  add column if not exists max_workspaces integer check (max_workspaces is null or max_workspaces >= 0);
alter table public.dulabs_dev_plans
  add column if not exists max_members integer check (max_members is null or max_members >= 0);
alter table public.dulabs_dev_plans
  add column if not exists permite_numeros_adicionales boolean not null default false;

-- Re-seed idempotente (UPDATE, nunca borra). Alinea el catálogo al pricing
-- definitivo aprobado. DEVELOPER hard-cap: permite_numeros_adicionales=false.
update public.dulabs_dev_plans set
  nombre = 'Developer',
  mensajes_mensuales_incluidos = 20000,
  numeros_incluidos = 2,
  mensajes_por_segundo_por_numero = 2,
  precio_numero_adicional_usd = null,
  precio_mensual_usd = 19.00,
  max_workspaces = 1,
  max_members = 1,
  permite_numeros_adicionales = false,
  updated_at = now()
where codigo = 'DEVELOPER';

update public.dulabs_dev_plans set
  nombre = 'Agency',
  mensajes_mensuales_incluidos = 100000,
  numeros_incluidos = 5,
  mensajes_por_segundo_por_numero = 2,
  precio_numero_adicional_usd = 5.00,
  precio_mensual_usd = 45.00,
  max_workspaces = 5,
  max_members = 5,
  permite_numeros_adicionales = true,
  updated_at = now()
where codigo = 'AGENCY';

update public.dulabs_dev_plans set
  nombre = 'Enterprise',
  mensajes_mensuales_incluidos = null,
  numeros_incluidos = null,
  mensajes_por_segundo_por_numero = null,
  precio_numero_adicional_usd = 5.00,
  precio_mensual_usd = 199.00,
  max_workspaces = null,
  max_members = null,
  permite_numeros_adicionales = true,
  updated_at = now()
where codigo = 'ENTERPRISE';

-- Alta defensiva por si algún entorno no tuviera el seed base de Fase 7.
insert into public.dulabs_dev_plans
  (codigo, nombre, mensajes_mensuales_incluidos, numeros_incluidos, mensajes_por_segundo_por_numero, precio_numero_adicional_usd, precio_mensual_usd, max_workspaces, max_members, permite_numeros_adicionales)
values
  ('DEVELOPER',  'Developer',  20000,  2,    2,    null, 19.00,  1,    1,    false),
  ('AGENCY',     'Agency',     100000, 5,    2,    5.00, 45.00,  5,    5,    true),
  ('ENTERPRISE', 'Enterprise', null,   null, null, 5.00, 199.00, null, null, true)
on conflict (codigo) do nothing;

-- ============================================================
-- 5. AUDITORÍA de cuenta (append-only)
-- ============================================================
create table if not exists public.dulabs_dev_account_audit (
  id bigint generated always as identity primary key,
  account_id uuid,
  actor_user_id uuid,
  accion text not null,
  antes jsonb,
  despues jsonb,
  motivo text,
  created_at timestamptz not null default now()
);

create index if not exists dulabs_dev_account_audit_account_idx
  on public.dulabs_dev_account_audit (account_id, created_at desc);

alter table public.dulabs_dev_account_audit enable row level security;

comment on table public.dulabs_dev_account_audit is
  'DuLabs Developer V1 (Fase 11). Registro append-only de acciones sobre la suscripción de una cuenta (CHANGE_PLAN, SET_ADDITIONAL_NUMBERS, SET_ESTADO, CREATE_WORKSPACE). Nunca contiene secretos. RLS sin políticas -> solo service_role.';
