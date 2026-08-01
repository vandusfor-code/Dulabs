-- Marketplace de Agentes de IA (ver lib/marketplace.ts): agentes prearmados
-- por rubro que el cliente compra aparte de su plan y activa en uno de sus
-- números de WhatsApp. El catálogo (7 agentes fijos del lanzamiento) vive en
-- código, no en la base — aquí solo se guardan las ACTIVACIONES reales.
--
-- Migración puramente aditiva: no modifica ni borra ninguna columna
-- existente. La configuración propia del número (prompt_sistema/
-- base_conocimiento/agente_id en dulabs_clientes_config) NUNCA se toca al
-- activar un agente del marketplace — solo se "sombrea" mientras
-- marketplace_activacion_id no sea null, y se restaura al desactivar.

create table if not exists public.dulabs_marketplace_activaciones (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null,
  agente_slug text not null,
  tipo_plan text not null check (tipo_plan in ('recurrente', 'mes')),
  estado text not null default 'activa' check (estado in ('activa', 'vencida', 'cancelada')),
  precio_cop int not null,
  -- Para 'recurrente': próxima fecha de cobro. Para 'mes': fecha de
  -- vencimiento tras la cual el agente se desactiva solo.
  fecha_proximo_cobro date,
  vence_at date,
  -- Número admin normalizado (solo dígitos, con código de país) y su nombre,
  -- leídos de la plantilla de configuración que sube el cliente.
  numero_admin text,
  nombre_admin text,
  -- Texto libre del negocio (de la plantilla): se usa como base de
  -- conocimiento del agente mientras esté activo.
  config_texto text,
  config_nombre_archivo text,
  -- Fuente de pago de Wompi para recobrar el plan recurrente sin volver a
  -- pedir la tarjeta.
  wompi_payment_source_id text,
  wompi_customer_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dulabs_marketplace_activaciones_tenant_idx
  on public.dulabs_marketplace_activaciones (id_tenant);

-- Regla de negocio: un solo agente del marketplace ACTIVO por número (las
-- filas 'vencida'/'cancelada' quedan como historial y no cuentan).
create unique index if not exists dulabs_marketplace_una_activa_por_numero
  on public.dulabs_marketplace_activaciones (phone_number_id)
  where estado = 'activa';

alter table public.dulabs_marketplace_activaciones enable row level security;

drop policy if exists tenant_select on public.dulabs_marketplace_activaciones;
create policy tenant_select on public.dulabs_marketplace_activaciones
  for select to authenticated
  using (id_tenant = public.dulabs_tenant_del_usuario());

comment on table public.dulabs_marketplace_activaciones is
  'Activaciones reales de agentes del Marketplace (catálogo fijo en lib/marketplace.ts). Una fila estado=activa por número (índice parcial único). La config propia del número no se borra: se restaura al poner clientes_config.marketplace_activacion_id en null.';

-- Qué activación del marketplace está "sombreando" la config propia de un
-- número. null = el número usa su propio agente/prompt (comportamiento de
-- hoy, sin cambios). Distinto de agente_id: agente_id es la config propia del
-- cliente; esto es un agente comprado que la reemplaza temporalmente.
alter table public.dulabs_clientes_config
  add column if not exists marketplace_activacion_id bigint
  references public.dulabs_marketplace_activaciones(id) on delete set null;
