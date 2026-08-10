-- Captación automática de leads por campaña de WhatsApp (SÍ/NO + RUT/
-- teléfono/compañía). Migración puramente aditiva: no toca ninguna tabla
-- existente.
--
-- Mismo patrón arquitectónico que el bot de encuestas
-- (20260730090000_survey_bot.sql): config por número + tabla de sesión
-- determinística, chequeada en el webhook ANTES del gate de ia_pausada —
-- así funciona incluso en números conectados a DuMo (ia_pausada=true, ver
-- forward_to_dumo), exactamente como ya lo pidió el usuario.
--
-- dulabs_campaign_leads ya trae los campos con el shape exacto acordado
-- para el futuro payload a DuMo (POST /api/whatsapp/lead-intake, contrato
-- definido en la sesión pero todavía sin implementar del lado de DuMo):
-- dulabs_session_id = id de esta fila, dulabs_tenant_id = id_tenant,
-- wa_id = telefono_cliente, etc. dumo_sync_status queda en
-- 'not_applicable' hasta que ese endpoint exista.

create table if not exists public.dulabs_campaign_bot_config (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null,
  plantilla_id bigint not null references public.dulabs_plantillas(id) on delete cascade,

  campaign_label text not null default 'Campaña',

  -- Deben calzar EXACTO con los textos reales de los botones QUICK_REPLY
  -- de la plantilla de Meta (case-insensitive al comparar, ver
  -- lib/campaign-lead-engine.ts).
  yes_button_text text not null default 'SÍ',
  no_button_text text not null default 'NO',

  ask_data_template text not null default
    E'¡Claro! 😊 Para validar en el sistema si puedes aplicar a la oferta, confírmame por favor:\n\n📄 Número de RUT\n📱 Número de teléfono\n📡 Compañía actual',
  confirm_template text not null default
    E'✅ ¡Perfecto! Ya tenemos tus datos.\n\nEn un momento una de nuestras asesoras se pondrá en contacto contigo para validar la oferta y brindarte toda la información. 😊',
  -- Nula = no se envía nada al presionar NO (el usuario pidió verificar
  -- reutilización antes de mandar un mensaje aquí; queda opcional).
  decline_template text,

  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dulabs_campaign_bot_config_unica unique (phone_number_id, plantilla_id)
);

create index if not exists dulabs_campaign_bot_config_tenant_idx
  on public.dulabs_campaign_bot_config (id_tenant);

alter table public.dulabs_campaign_bot_config enable row level security;

drop policy if exists tenant_select on public.dulabs_campaign_bot_config;
create policy tenant_select on public.dulabs_campaign_bot_config
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));

comment on table public.dulabs_campaign_bot_config is
  'Configuración del bot de captación de leads por campaña: qué plantilla dispara el flujo, textos de sus botones SÍ/NO, y los mensajes del bot (solicitud de datos / confirmación / rechazo opcional). Una fila por (número, plantilla).';

-- Estado del motor de captación por participante (mapea 1:1 con
-- CampaignLeadSession de lib/campaign-lead-engine.ts).

create table if not exists public.dulabs_campaign_leads (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null,
  telefono_cliente text not null,

  campana_id bigint references public.dulabs_campanas(id) on delete set null,
  plantilla_id bigint references public.dulabs_plantillas(id) on delete set null,

  estado text not null default 'waiting_response'
    check (estado in ('waiting_response', 'requesting_data', 'lead_captured', 'not_interested', 'expired')),

  customer_name text,
  rut text,
  phone_provided text,
  current_company_raw text,
  -- Enum de operadores que ya usa DuMo (claro|movistar|entel|wom|virgin|vtr|gtd),
  -- o null si no se pudo mapear con confianza — current_company_raw nunca
  -- se pierde aunque este campo quede vacío.
  current_operator text,

  captured_at timestamptz,

  dumo_sync_status text not null default 'not_applicable'
    check (dumo_sync_status in ('not_applicable', 'pending', 'synced', 'error')),
  dumo_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dulabs_campaign_leads_unica unique (phone_number_id, telefono_cliente)
);

create index if not exists dulabs_campaign_leads_numero_idx
  on public.dulabs_campaign_leads (phone_number_id);
create index if not exists dulabs_campaign_leads_tenant_idx
  on public.dulabs_campaign_leads (id_tenant);
create index if not exists dulabs_campaign_leads_pendientes_sync_idx
  on public.dulabs_campaign_leads (dumo_sync_status)
  where dumo_sync_status = 'pending';

alter table public.dulabs_campaign_leads enable row level security;

drop policy if exists tenant_select on public.dulabs_campaign_leads;
create policy tenant_select on public.dulabs_campaign_leads
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));

comment on table public.dulabs_campaign_leads is
  'Progreso determinístico de cada participante en el flujo de captación de leads por campaña (una fila por phone_number_id+telefono_cliente). El backend (webhook), nunca la IA, decide y persiste el estado. Los campos rut/phone_provided/current_company_raw/current_operator ya tienen el shape exacto del futuro payload a DuMo.';
