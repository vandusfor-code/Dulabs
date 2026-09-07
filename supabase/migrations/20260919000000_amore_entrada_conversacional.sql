-- AMORE (autorizado, Fase 9) — estado mínimo del "puente" conversacional
-- (bienvenida 1/2 -> Agenda V2 directa u -> Gemini con clasificación de
-- intención). Deliberadamente EXCLUSIVA de AMORE (aunque tenant_id es real,
-- nunca hardcodeado en la tabla) -- ningún otro tenant crea filas acá.
--
-- Migración puramente aditiva: no toca ninguna tabla existente
-- (dulabs_agenda_v2_sesiones, dulabs_chat_conversaciones, etc.).

create table if not exists public.dulabs_amore_entrada (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  telefono_cliente text not null,
  -- 'inicio': recién se mostró el menú 1/2, esperando esa respuesta.
  -- 'gemini': conversación normal (Gemini clasifica cada mensaje entre
  -- CONSULTA/TRIGGER_AGENDA) -- también el estado "de regreso" después de
  -- que Agenda V2 entrega el control (o termina una reserva), para que el
  -- siguiente mensaje jamás vuelva a mostrar la bienvenida.
  modo text not null default 'inicio' check (modo in ('inicio', 'gemini')),
  ultimo_wamid_procesado text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Una sola fila por conversación real -- se actualiza in place, nunca se
-- acumula historial (a diferencia de dulabs_agenda_v2_sesiones, acá no hay
-- "reservas" que auditar, solo el modo actual del puente).
create unique index if not exists dulabs_amore_entrada_unica
  on public.dulabs_amore_entrada (tenant_id, telefono_cliente);

alter table public.dulabs_amore_entrada enable row level security;

comment on table public.dulabs_amore_entrada is
  'AMORE (Fase 9) -- estado del puente conversacional (bienvenida 1/2, luego Gemini clasificando CONSULTA/TRIGGER_AGENDA) que decide cuándo entregar el control a Agenda V2. Ver lib/amore-entrada-router.ts.';
