-- DuLabs Developer V1 -- Fase 12 (Billing & Subscriptions, Wompi). Migración
-- PURAMENTE ADITIVA. No modifica ni borra nada de Business/AMORE ni de Fases
-- 1-11. Introduce el namespace de billing de Developer (dulabs_dev_billing_*),
-- AISLADO del stack Wompi de Business (dulabs_pagos / dulabs_suscripciones).
--
-- Fuente de verdad (no se duplica):
--   - Entitlements / límites  -> dulabs_dev_plans + resolverEntitlementsDeWorkspace (Fase 11).
--   - Estado de suscripción (active/past_due/canceled), plan y período
--     (periodo_inicio/fin, cancelar_al_fin_periodo, numeros_adicionales)
--     -> dulabs_dev_accounts (Fase 11). NO se duplican aquí.
--   - Estas tablas guardan SOLO lo específico de billing/Wompi: cliente +
--     fuente de pago tokenizada, intervalo de cobro, historial de pagos
--     (USD canónico + COP cobrado + FX) y el event-log de webhooks.
--
-- Precio canónico en USD (dulabs_dev_plans.precio_mensual_usd); el precio anual
-- = x10 se DERIVA en el helper de pricing (no se persiste columna anual). El
-- cobro real es en COP vía Wompi con la tasa FX resuelta server-side y
-- registrada por transacción. Todas las tablas: RLS activa SIN políticas ->
-- solo service_role (mismo criterio que Fase 11).

-- ============================================================
-- 1. CLIENTE + FUENTE DE PAGO TOKENIZADA (por cuenta)
-- ============================================================
create table if not exists public.dulabs_dev_billing_customers (
  account_id uuid primary key references public.dulabs_dev_accounts (id) on delete cascade,
  wompi_customer_email text,
  -- ID de la fuente de pago tokenizada en Wompi (la tarjeta NUNCA se guarda
  -- acá ni pasa por nuestros servidores; se tokeniza en el navegador).
  wompi_payment_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.dulabs_dev_billing_customers enable row level security;
comment on table public.dulabs_dev_billing_customers is
  'DuLabs Developer V1 (Fase 12). Cliente de billing por cuenta: email y fuente de pago tokenizada en Wompi para cobro recurrente. RLS sin políticas -> solo service_role.';

-- ============================================================
-- 2. SUSCRIPCIÓN (SOLO campos de billing; estado/plan/período viven en accounts)
-- ============================================================
create table if not exists public.dulabs_dev_billing_subscriptions (
  account_id uuid primary key references public.dulabs_dev_accounts (id) on delete cascade,
  intervalo text not null default 'month' check (intervalo in ('month', 'year')),
  -- Precio USD canónico contratado (para renovación); el monto COP se recalcula
  -- con la FX vigente en cada cobro.
  precio_usd_cents integer not null check (precio_usd_cents >= 0),
  proximo_cobro date,
  -- Intención de downgrade a aplicar al FIN del período (opción A, Fase 11);
  -- NULL = sin downgrade pendiente.
  downgrade_a_plan text references public.dulabs_dev_plans (codigo),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.dulabs_dev_billing_subscriptions enable row level security;
comment on table public.dulabs_dev_billing_subscriptions is
  'DuLabs Developer V1 (Fase 12). Detalle de billing de la suscripción por cuenta (intervalo month/year, precio USD contratado, próximo cobro, downgrade pendiente). El estado/plan/período de la suscripción viven en dulabs_dev_accounts (Fase 11), NO se duplican. RLS sin políticas -> solo service_role.';

-- ============================================================
-- 3. PAGOS (checkout + historial; USD canónico + COP cobrado + FX; idempotencia)
-- ============================================================
create table if not exists public.dulabs_dev_billing_payments (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.dulabs_dev_accounts (id),
  -- reference único por intento (dulabs-dev-<accountId>-<ts>); correlaciona
  -- checkout <-> evento de webhook.
  reference text not null unique,
  provider text not null default 'wompi',
  -- id de la transacción del proveedor; único -> idempotencia (varios NULL
  -- permitidos por Postgres mientras el cobro aún no se crea).
  provider_transaction_id text unique,
  tipo text not null check (tipo in ('checkout', 'renewal', 'upgrade')),
  plan_codigo text not null references public.dulabs_dev_plans (codigo),
  intervalo text not null check (intervalo in ('month', 'year')),
  precio_usd_cents integer not null check (precio_usd_cents >= 0),
  monto_cop_cents integer not null check (monto_cop_cents >= 0),
  fx_rate numeric(14, 4) not null check (fx_rate > 0),
  moneda_cobro text not null default 'COP',
  estado text not null default 'PENDING' check (estado in ('PENDING', 'APPROVED', 'DECLINED', 'ERROR', 'VOIDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dulabs_dev_billing_payments_account_idx
  on public.dulabs_dev_billing_payments (account_id, created_at desc);
alter table public.dulabs_dev_billing_payments enable row level security;
comment on table public.dulabs_dev_billing_payments is
  'DuLabs Developer V1 (Fase 12). Historial de pagos Wompi de Developer (checkout inicial, renovaciones, upgrades). Guarda el precio USD canónico, el monto COP efectivamente cobrado y la tasa FX usada. Idempotencia por provider_transaction_id UNIQUE y reference UNIQUE. RLS sin políticas -> solo service_role.';

-- ============================================================
-- 4. EVENT-LOG DE WEBHOOKS (idempotencia / replay / orden / dead-letter / auditoría)
-- ============================================================
create table if not exists public.dulabs_dev_billing_events (
  id bigint generated always as identity primary key,
  provider text not null default 'wompi',
  -- Huella única del evento (para Wompi: el checksum del evento) -> dedup de
  -- reintentos/replays.
  provider_event_id text not null unique,
  type text,
  payload jsonb,
  signature_verified boolean not null default false,
  status text not null default 'received'
    check (status in ('received', 'processed', 'failed', 'dead_letter', 'ignored_duplicate')),
  attempts integer not null default 0,
  error text,
  correlation_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists dulabs_dev_billing_events_status_idx
  on public.dulabs_dev_billing_events (status, received_at);
alter table public.dulabs_dev_billing_events enable row level security;
comment on table public.dulabs_dev_billing_events is
  'DuLabs Developer V1 (Fase 12). Event-log de webhooks de billing (Wompi): se registra el evento ANTES de procesarlo. Idempotencia/replay por provider_event_id UNIQUE; dead-letter para reprocesamiento. Nunca contiene datos de tarjeta. RLS sin políticas -> solo service_role.';
