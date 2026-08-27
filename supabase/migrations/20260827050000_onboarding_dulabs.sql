-- Onboarding automático por WhatsApp cuando un pago de DuLabs queda
-- confirmado (ver app/api/wompi/webhook/route.ts). Migración puramente
-- aditiva: no toca ninguna tabla existente.
--
-- Mismo patrón que dulabs_campaign_leads (20260810090000_campaign_lead_capture.sql):
-- tabla de sesión determinística + función de creación idempotente. La
-- diferencia clave es la clave de unicidad: aquí es UN tenant = UNA sesión
-- para siempre (nunca más de una bienvenida, ni siquiera en renovaciones
-- mensuales futuras), no "una activa a la vez" como en campañas.

alter table public.dulabs_suscripciones
  add column if not exists telefono_onboarding text;

comment on column public.dulabs_suscripciones.telefono_onboarding is
  'Teléfono capturado en el checkout (normalizado con lib/marketplace-store.ts normalizarTelefono) para enviar el onboarding automático por WhatsApp cuando el pago se confirme.';

create table if not exists public.dulabs_onboarding_sesiones (
  id bigint generated always as identity primary key,
  id_tenant uuid not null unique,
  phone_number_id text not null,
  telefono_cliente text not null,
  plan text not null,

  estado text not null default 'menu_enviado'
    check (estado in ('menu_enviado', 'esperando_negocio', 'esperando_idea', 'esperando_adicional', 'completado', 'soporte_solicitado')),

  business_description text,
  implementation_idea text,
  additional_information text,

  iniciado_at timestamptz not null default now(),
  completado_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dulabs_onboarding_sesiones_telefono_idx
  on public.dulabs_onboarding_sesiones (phone_number_id, telefono_cliente);

alter table public.dulabs_onboarding_sesiones enable row level security;

comment on table public.dulabs_onboarding_sesiones is
  'Progreso determinístico del onboarding automático post-pago (bienvenida -> 3 preguntas -> fin, o bienvenida -> soporte -> fin). UN tenant = UNA sola sesión para siempre (constraint unique en id_tenant) -- así una renovación mensual nunca genera una segunda bienvenida. El backend decide y persiste el estado, nunca la IA (lib/onboarding-engine.ts es una función pura sin IA).';

-- Único punto de inserción: si el tenant ya tiene sesión (de una compra
-- anterior o de un reintento del mismo webhook), no inserta nada y
-- devuelve 0 filas -- el llamador usa eso para decidir si debe mandar la
-- bienvenida o no (mismo criterio que dulabs_crear_campaign_lead_idempotente).
create or replace function public.dulabs_crear_onboarding_sesion_idempotente(
  p_tenant uuid,
  p_phone_number_id text,
  p_telefono_cliente text,
  p_plan text
)
returns setof public.dulabs_onboarding_sesiones
language sql
security definer
set search_path = public
as $$
  insert into public.dulabs_onboarding_sesiones (id_tenant, phone_number_id, telefono_cliente, plan)
  values (p_tenant, p_phone_number_id, p_telefono_cliente, p_plan)
  on conflict (id_tenant) do nothing
  returning *;
$$;

revoke all on function public.dulabs_crear_onboarding_sesion_idempotente(uuid, text, text, text) from public;
grant execute on function public.dulabs_crear_onboarding_sesion_idempotente(uuid, text, text, text) to service_role;

comment on function public.dulabs_crear_onboarding_sesion_idempotente(uuid, text, text, text) is
  'Único punto de inserción para dulabs_onboarding_sesiones. Si el tenant ya tiene sesión, no devuelve ninguna fila (0 filas = "no se creó, no mandar bienvenida"). Si es la primera vez, crea la fila y la devuelve.';
