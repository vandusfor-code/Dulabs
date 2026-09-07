-- AGENDA V2 (autorizado) — sesión de agenda AISLADA del Flow Engine.
--
-- Deliberadamente NO reutiliza dulabs_flow_executions (acoplada a
-- flow_id/flow_version_id/current_node_id -- conceptos de Flow Engine que
-- Agenda V2 no debe conocer) ni agrega columnas a dulabs_chat_conversaciones
-- (tabla del panel de mensajes, otro dueño, otro propósito). Es una tabla
-- nueva, pequeña, con UNA sola responsabilidad: el estado determinístico de
-- una reserva guiada por fuera del router de escenarios.
--
-- Multi-tenant desde el día 1 (sección 15 del pedido): tenant_id real,
-- nunca un tenant hardcodeado -- la primera activación real es solo AMORE,
-- pero la tabla no lo sabe ni lo necesita saber.
--
-- Migración puramente aditiva: no toca ninguna tabla existente.

create table if not exists public.dulabs_agenda_v2_sesiones (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  telefono_cliente text not null,
  activo boolean not null default true,
  step text not null default 'S1_SERVICIO'
    check (step in ('S1_SERVICIO', 'S2_PROFESIONAL', 'S3_DIA', 'S4_HORA', 'S5_CONFIRMAR')),
  servicio_id uuid,
  profesional_id bigint,
  fecha_iso text,
  slot_seleccionado jsonb,
  opciones_mostradas jsonb,
  -- Último wamid ya procesado por esta sesión (incluido el que la creó) --
  -- protección real contra duplicados de Baileys/WhatsApp (sección 14 del
  -- pedido), sin depender de ningún mecanismo del Flow Engine.
  ultimo_wamid_procesado text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Única sesión ACTIVA por conversación real (sección 1/8 del pedido) --
-- índice único PARCIAL: permite conservar el historial de sesiones ya
-- cerradas (nunca se borran, nunca quedan huérfanas "a medias"), mientras
-- Postgres garantiza que jamás haya dos filas activas para el mismo
-- (tenant_id, telefono_cliente) al mismo tiempo.
create unique index if not exists dulabs_agenda_v2_sesiones_activa_unica
  on public.dulabs_agenda_v2_sesiones (tenant_id, telefono_cliente)
  where activo;

create index if not exists dulabs_agenda_v2_sesiones_conversacion_idx
  on public.dulabs_agenda_v2_sesiones (tenant_id, telefono_cliente, created_at desc);

alter table public.dulabs_agenda_v2_sesiones enable row level security;

comment on table public.dulabs_agenda_v2_sesiones is
  'AGENDA V2 -- sesión determinística de agendamiento guiado, completamente aislada del Flow Engine. Mientras exista una fila activa para (tenant_id, telefono_cliente), TODOS los mensajes de esa conversación deben ir exclusivamente al controlador de Agenda V2 (ver lib/agenda-v2/), nunca a resolverEscenario/ejecutarBotWhatsAppQR.';
comment on column public.dulabs_agenda_v2_sesiones.ultimo_wamid_procesado is
  'Wamid del último mensaje real ya procesado por esta sesión (incluida la creación) -- si el mismo wamid vuelve a llegar (duplicado real de WhatsApp/Baileys), se ignora sin reprocesar ni reenviar nada.';
