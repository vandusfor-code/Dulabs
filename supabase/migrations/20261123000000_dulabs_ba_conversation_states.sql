-- DuLabs Business — Business Agent 2.0, FASE 3: estado conversacional explícito del Business Agent.
--
-- Tabla NUEVA, aditiva. NO modifica ninguna tabla existente.
--
-- POR QUÉ NO SE REUTILIZA dulabs_flow_executions
--   * Una ejecución del Flow Engine vive mientras el grafo corre (running / waiting_*); al completarse, el siguiente
--     mensaje abre OTRA ejecución con variables vacías. La memoria de la conversación (qué dato ya dio el cliente, qué
--     propuesta está pendiente) tiene que sobrevivir entre ejecuciones.
--   * Su state_version sube en cada transición de NODO; usarla también para el estado conversacional haría que la
--     máquina de estados y el motor del grafo se generen conflictos de versión entre sí dentro del mismo turno.
--   Se reutiliza el MISMO patrón: clave con tenant, concurrencia optimista por state_version, RLS solo service_role y el
--   trigger de updated_at del Flow Store.
--
-- MODELO DE CONFIANZA
--   * La clave (id_tenant, phone_number_id, telefono_cliente, agent_id) la fija el servidor desde el canal y el número
--     del tenant; nunca viene del payload ni de la IA. No existe acceso por un id suelto.
--   * `state` es el estado validado por el backend (schema business-agent.conversation-state/1.0.0): valores
--     normalizados, sin historial ni texto libre del cliente. El backend lo vuelve a validar al leerlo.
--   * La base impide que una fila cambie de clave y que la versión retroceda o salte (defensa en profundidad).
--
-- SEGURIDAD
--   * RLS habilitada SIN políticas para anon/authenticated => solo service_role (runtime del Business Agent).

create table if not exists public.dulabs_ba_conversation_states (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  phone_number_id text not null check (char_length(phone_number_id) between 1 and 64),
  telefono_cliente text not null check (char_length(telefono_cliente) between 5 and 40),
  agent_id text not null check (char_length(agent_id) between 1 and 64),
  agent_version text check (agent_version is null or char_length(agent_version) <= 64),
  status text not null check (status in (
    'NEW', 'COLLECTING_INFORMATION', 'AWAITING_CONFIRMATION', 'READY_FOR_ACTION', 'EXECUTING',
    'COMPLETED', 'CANCELLED', 'HANDOFF_PENDING', 'HANDED_OFF', 'PAUSED', 'ERROR'
  )),
  schema_version text not null check (char_length(schema_version) <= 80),
  state jsonb not null check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 65536),
  state_version integer not null default 1 check (state_version >= 1),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_ba_conversation_states_key unique (id_tenant, phone_number_id, telefono_cliente, agent_id),
  -- La columna `status` es un espejo consultable del estado: tiene que coincidir con el documento.
  constraint dulabs_ba_conversation_states_status_espejo check (state->>'status' = status)
);

-- Operación: conversaciones del tenant que esperan a una persona o quedaron en error.
create index if not exists dulabs_ba_conversation_states_atencion_idx
  on public.dulabs_ba_conversation_states (id_tenant, status, updated_at desc)
  where status in ('HANDOFF_PENDING', 'HANDED_OFF', 'PAUSED', 'ERROR');

comment on table public.dulabs_ba_conversation_states is
  'Estado conversacional explícito del Business Agent (FASE 3): objetivo, slots normalizados con su procedencia, confirmación y acción pendientes, handoff. Una fila por (tenant, número del negocio, cliente, agente). Concurrencia optimista por state_version.';
comment on column public.dulabs_ba_conversation_states.state_version is
  'Versión optimista: toda escritura es UPDATE ... WHERE state_version = esperado y la deja en esperado + 1.';

-- Integridad: la clave no cambia y la versión avanza exactamente de a 1.
create or replace function public.dulabs_ba_conversation_states_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id_tenant <> old.id_tenant
     or new.phone_number_id <> old.phone_number_id
     or new.telefono_cliente <> old.telefono_cliente
     or new.agent_id <> old.agent_id then
    raise exception 'dulabs_ba_conversation_states: la clave de la conversación no se puede cambiar'
      using errcode = 'check_violation';
  end if;
  if new.state_version <> old.state_version + 1 then
    raise exception 'dulabs_ba_conversation_states: state_version debe avanzar de % a %, no a %',
      old.state_version, old.state_version + 1, new.state_version
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists dulabs_ba_conversation_states_guard on public.dulabs_ba_conversation_states;
create trigger dulabs_ba_conversation_states_guard
  before update on public.dulabs_ba_conversation_states
  for each row execute function public.dulabs_ba_conversation_states_guard();

alter table public.dulabs_ba_conversation_states enable row level security;

-- updated_at (convención DuLabs) — reutiliza la función del Flow Store.
drop trigger if exists dulabs_ba_conversation_states_updated_at on public.dulabs_ba_conversation_states;
create trigger dulabs_ba_conversation_states_updated_at
  before update on public.dulabs_ba_conversation_states
  for each row execute function public.dulabs_flow_set_updated_at();
