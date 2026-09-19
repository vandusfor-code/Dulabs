-- DuLabs Business — Agent Compiler, R7: registro de las citas que crea el Business Agent
-- (base de "cancelar" y "reprogramar" por WhatsApp).
--
-- Tabla NUEVA, aditiva. NO modifica ninguna tabla existente. Hoy las citas que crea el agente
-- solo existen como eventos del calendario del negocio (Nylas) y como fila de idempotencia
-- (dulabs_idempotencia_reservas, no consultable por cliente): sin este registro el agente NO
-- puede saber cuáles son las citas de una persona, así que no puede cancelarlas ni moverlas
-- de forma segura.
--
-- MODELO DE CONFIANZA
--   * telefono_cliente = identidad del CANAL (el número de WhatsApp que escribe), la fija el
--     servidor desde la conversación. Nunca viene del payload ni de la IA.
--   * Toda operación (listar / cancelar / mover) filtra por (id_tenant, telefono_cliente): una
--     persona solo puede ver y tocar SUS citas, y un tenant nunca ve las de otro.
--   * calendar_id se guarda para detectar que el negocio reconectó OTRO calendario: en ese caso
--     el agente no opera sobre un evento de un calendario distinto (deriva a una persona).
--
-- SEGURIDAD
--   * RLS habilitada SIN política para anon/authenticated => solo service_role (la API/runtime
--     del Business Agent con el tenant de la sesión/conversación). Mismo criterio que
--     dulabs_business_agent_calendar y las tablas de conocimiento.

create table if not exists public.dulabs_ba_appointments (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  telefono_cliente text not null check (char_length(telefono_cliente) between 5 and 40),
  provider text not null default 'nylas' check (provider in ('nylas')),
  calendar_id text not null,
  event_id text not null,
  servicio text,
  nombre_cliente text,
  inicio timestamptz not null,
  fin timestamptz not null,
  estado text not null default 'confirmada' check (estado in ('confirmada', 'cancelada')),
  reprogramaciones integer not null default 0 check (reprogramaciones >= 0),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_ba_appointments_rango check (fin > inicio),
  -- Un evento del calendario pertenece a UNA cita registrada por tenant (idempotente ante replays).
  constraint dulabs_ba_appointments_evento_uniq unique (id_tenant, event_id)
);

-- Consulta caliente: "citas próximas y confirmadas de ESTA persona en ESTE negocio".
create index if not exists dulabs_ba_appointments_cliente_idx
  on public.dulabs_ba_appointments (id_tenant, telefono_cliente, inicio)
  where estado = 'confirmada';

comment on table public.dulabs_ba_appointments is
  'Citas creadas por el Business Agent (provider nylas), indexadas por tenant + teléfono del canal. Permite cancelar/reprogramar de forma segura sin que la IA elija ids. El calendario sigue siendo la fuente de verdad del horario; esta tabla es el índice de "de quién es cada evento".';
comment on column public.dulabs_ba_appointments.telefono_cliente is
  'Identidad del canal (número de WhatsApp) fijada por el servidor; nunca del payload/IA.';
comment on column public.dulabs_ba_appointments.calendar_id is
  'Calendario donde vive el evento; si el negocio reconecta otro calendario, el agente no opera sobre este evento.';

alter table public.dulabs_ba_appointments enable row level security;

-- updated_at trigger (convención DuLabs) — reutiliza la función del Flow Store.
drop trigger if exists dulabs_ba_appointments_updated_at on public.dulabs_ba_appointments;
create trigger dulabs_ba_appointments_updated_at
  before update on public.dulabs_ba_appointments
  for each row execute function public.dulabs_flow_set_updated_at();
