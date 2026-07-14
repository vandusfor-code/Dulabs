-- Suscripciones recurrentes (Wompi) y registro de pagos por tenant.

create table if not exists public.dulabs_suscripciones (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  plan text not null,
  precio_cop integer not null,
  wompi_payment_source_id text not null,
  wompi_customer_email text not null,
  estado text not null default 'activa', -- activa | vencida | cancelada
  fecha_proximo_cobro date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_suscripciones_tenant_unico unique (id_tenant)
);

alter table public.dulabs_suscripciones enable row level security;

comment on table public.dulabs_suscripciones is
  'Suscripción activa por tenant: plan, payment_source de Wompi para cobro recurrente, y fecha del próximo cobro.';
comment on column public.dulabs_suscripciones.wompi_payment_source_id is
  'ID de la "fuente de pago" tokenizada en Wompi, reutilizado cada mes para el cobro recurrente (recurrent: true).';

create table if not exists public.dulabs_pagos (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  wompi_transaction_id text not null unique,
  monto_cop integer not null,
  estado text not null, -- APPROVED | DECLINED | PENDING | ERROR | VOIDED
  created_at timestamptz not null default now()
);

create index if not exists dulabs_pagos_tenant_idx on public.dulabs_pagos (id_tenant);
alter table public.dulabs_pagos enable row level security;

comment on table public.dulabs_pagos is
  'Historial de transacciones de Wompi (cobro inicial + cobros mensuales recurrentes), actualizado por el webhook de eventos.';
