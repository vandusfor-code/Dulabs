-- Bot comercial de Soluciones Financieras (tenant contacto@dulabs.co,
-- phone_number_id 1275440315656562, ver app/webhook-dulabs/route.ts):
-- plantilla con 3 botones de producto (Libre Inversión / Compra de Cartera /
-- Hipotecario) -> UNA pregunta fija por producto -> se guarda la respuesta
-- del cliente -> handoff a Charlotte (asesora humana).
--
-- Mismo patrón arquitectónico que dulabs_campaign_leads
-- (20260810090000_campaign_lead_capture.sql): tabla de sesión
-- determinística, chequeada en el webhook ANTES del gate de ia_pausada, con
-- índice único parcial para garantizar como mucho UNA solicitud activa por
-- cliente a la vez. A diferencia de dulabs_campaign_leads, este flujo no
-- necesita tabla de configuración aparte (dulabs_campaign_bot_config): los
-- 3 productos, la pregunta de cada uno y el mensaje de cierre son fijos
-- para este tenant específico (mismo criterio que el hardcoding de
-- "Daniela" en lib/especialista-solicitud-ia.ts), no un motor genérico
-- reconfigurable por campaña.
--
-- Migración puramente aditiva: no toca ninguna tabla existente.

create table if not exists public.dulabs_solicitudes_producto_financiero (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null,
  telefono_cliente text not null,

  producto text not null
    check (producto in ('libre_inversion', 'compra_cartera', 'hipotecario')),
  respuesta_cliente text,

  estado text not null default 'esperando_dato'
    check (estado in ('esperando_dato', 'pendiente_asesor')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dulabs_solicitudes_producto_financiero_numero_idx
  on public.dulabs_solicitudes_producto_financiero (phone_number_id);
create index if not exists dulabs_solicitudes_producto_financiero_tenant_idx
  on public.dulabs_solicitudes_producto_financiero (id_tenant);

-- Como mucho UNA solicitud activa (esperando_dato) por (phone_number_id,
-- telefono_cliente) a la vez -- una vez pendiente_asesor, un nuevo tap de
-- botón (otro producto, u otra sesión más adelante) crea una fila nueva; se
-- conserva el histórico completo, igual que dulabs_campaign_leads.
create unique index if not exists dulabs_solicitudes_producto_financiero_activa_idx
  on public.dulabs_solicitudes_producto_financiero (phone_number_id, telefono_cliente)
  where estado = 'esperando_dato';

alter table public.dulabs_solicitudes_producto_financiero enable row level security;

drop policy if exists tenant_select on public.dulabs_solicitudes_producto_financiero;
create policy tenant_select on public.dulabs_solicitudes_producto_financiero
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));

comment on table public.dulabs_solicitudes_producto_financiero is
  'Bot comercial de Soluciones Financieras: producto elegido por botón de plantilla, respuesta libre del cliente, y handoff a la asesora humana (Charlotte). Tenant específico (no un motor genérico de campañas).';
