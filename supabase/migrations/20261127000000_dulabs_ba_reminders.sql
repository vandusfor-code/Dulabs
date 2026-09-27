-- DuLabs Business — Business Agent 2.0, FASE 8: recordatorios de cita que el cliente pide ("recuérdame mañana").
--
-- Tabla NUEVA, aditiva. NO modifica ninguna tabla existente. No depende de otras migraciones del Business Agent
-- (solo de la función dulabs_flow_set_updated_at del registro de flows, ya en producción).
--
-- dulabs_ba_reminders — un recordatorio ACTIVO por (tenant, conversación, cita). La lógica atómica vive en funciones:
--   * _schedule  crea o ACTUALIZA el recordatorio activo de esa cita (idempotente: la misma solicitud = 'unchanged');
--                exige que el momento sea anterior a la cita y no esté en el pasado.
--   * _cancel    cancela los recordatorios pendientes de una conversación (o de una cita): cita cancelada.
--   * _reschedule mueve el recordatorio pendiente al nuevo inicio de la cita (cita reprogramada).
--   * _claim_due toma los vencidos con lease (FOR UPDATE SKIP LOCKED: dos despachadores no toman el mismo). Uno que
--                quedó 'sending' con el lease vencido NO se reenvía: pasa a 'unknown' (pudo haberse enviado).
--   * _complete  cierre con fencing por attempt: sent / failed / reintento programado.
--
-- PII: se guarda el teléfono del cliente (hace falta para escribirle) y el nombre del servicio; nunca el texto de la
-- conversación. SEGURIDAD: RLS habilitada sin políticas (solo service_role); funciones sin EXECUTE para
-- public/anon/authenticated.
-- RECUPERACIÓN: drop function dulabs_ba_reminder_*; drop table dulabs_ba_reminders; (aditivo, sin datos de otras tablas).

create table if not exists public.dulabs_ba_reminders (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  agent_id text not null check (char_length(agent_id) between 1 and 64),
  conversation_id text not null check (char_length(conversation_id) between 1 and 120),
  phone_number_id text not null check (char_length(phone_number_id) between 1 and 40),
  telefono_cliente text not null check (char_length(telefono_cliente) between 1 and 40),
  anchor_ref text not null check (char_length(anchor_ref) between 1 and 120),
  appointment_start timestamptz not null,
  service text check (service is null or char_length(service) <= 200),
  remind_at timestamptz not null,
  timezone text not null check (char_length(timezone) between 1 and 64),
  message text not null check (char_length(message) between 1 and 500),
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'cancelled', 'failed', 'unknown')),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{32}$'),
  attempts integer not null default 0 check (attempts between 0 and 10),
  lease_until timestamptz,
  last_error text check (last_error is null or last_error ~ '^[A-Z0-9_]{1,60}$'),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_ba_reminders_key unique (id_tenant, idempotency_key),
  constraint dulabs_ba_reminders_antes_de_la_cita check (remind_at < appointment_start),
  constraint dulabs_ba_reminders_sending_lease check (status <> 'sending' or lease_until is not null)
);

-- Un solo recordatorio activo por cita y conversación.
create unique index if not exists dulabs_ba_reminders_activo_uidx
  on public.dulabs_ba_reminders (id_tenant, conversation_id, anchor_ref) where status in ('scheduled', 'sending');
create index if not exists dulabs_ba_reminders_vencidos_idx
  on public.dulabs_ba_reminders (remind_at) where status = 'scheduled';
create index if not exists dulabs_ba_reminders_conversacion_idx
  on public.dulabs_ba_reminders (id_tenant, conversation_id, created_at desc);

comment on table public.dulabs_ba_reminders is
  'Recordatorios de cita pedidos por el cliente al Business Agent (FASE 8). Un activo por (tenant, conversación, cita). Los despacha app/api/business-agent/reminders/dispatch con lease y fencing; un envío de desenlace desconocido nunca se repite.';

create or replace function public.dulabs_ba_reminders_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id_tenant <> old.id_tenant or new.conversation_id <> old.conversation_id or new.anchor_ref <> old.anchor_ref
     or new.idempotency_key <> old.idempotency_key or new.telefono_cliente <> old.telefono_cliente or new.phone_number_id <> old.phone_number_id then
    raise exception 'dulabs_ba_reminders: la identidad del recordatorio no se puede cambiar' using errcode = 'check_violation';
  end if;
  if old.status in ('sent', 'cancelled', 'failed', 'unknown') and new.status <> old.status then
    raise exception 'dulabs_ba_reminders: un recordatorio cerrado no se reabre' using errcode = 'check_violation';
  end if;
  if new.attempts < old.attempts then
    raise exception 'dulabs_ba_reminders: attempts no puede retroceder' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists dulabs_ba_reminders_guard on public.dulabs_ba_reminders;
create trigger dulabs_ba_reminders_guard
  before update on public.dulabs_ba_reminders
  for each row execute function public.dulabs_ba_reminders_guard();

drop trigger if exists dulabs_ba_reminders_updated_at on public.dulabs_ba_reminders;
create trigger dulabs_ba_reminders_updated_at
  before update on public.dulabs_ba_reminders
  for each row execute function public.dulabs_flow_set_updated_at();

alter table public.dulabs_ba_reminders enable row level security;

-- ---------------------------------------------------------------------------
-- Programar / actualizar (idempotente)
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_ba_reminder_schedule(
  p_tenant uuid,
  p_agent text,
  p_conversation text,
  p_phone_number_id text,
  p_telefono text,
  p_anchor text,
  p_appointment_start timestamptz,
  p_service text,
  p_remind_at timestamptz,
  p_timezone text,
  p_message text,
  p_key text
)
returns table (outcome text, reminder_id uuid, remind_at timestamptz)
language plpgsql
as $$
declare
  r public.dulabs_ba_reminders%rowtype;
begin
  if p_remind_at >= p_appointment_start then
    return query select 'after_appointment'::text, null::uuid, p_remind_at;
    return;
  end if;
  if p_remind_at < now() - interval '1 minute' then
    return query select 'in_past'::text, null::uuid, p_remind_at;
    return;
  end if;

  select * into r from public.dulabs_ba_reminders x
   where x.id_tenant = p_tenant and x.conversation_id = p_conversation and x.anchor_ref = p_anchor and x.status in ('scheduled', 'sending')
   for update;
  if found then
    if r.status = 'sending' then
      return query select 'already_sending'::text, r.id, r.remind_at;
      return;
    end if;
    if r.remind_at = p_remind_at and r.appointment_start = p_appointment_start then
      return query select 'unchanged'::text, r.id, r.remind_at;
      return;
    end if;
    update public.dulabs_ba_reminders x
       set remind_at = p_remind_at, appointment_start = p_appointment_start, service = p_service, message = p_message, timezone = p_timezone
     where x.id = r.id
    returning * into r;
    return query select 'updated'::text, r.id, r.remind_at;
    return;
  end if;

  insert into public.dulabs_ba_reminders
    (id_tenant, agent_id, conversation_id, phone_number_id, telefono_cliente, anchor_ref, appointment_start, service, remind_at, timezone, message, idempotency_key)
  values
    (p_tenant, p_agent, p_conversation, p_phone_number_id, p_telefono, p_anchor, p_appointment_start, p_service, p_remind_at, p_timezone, p_message, p_key)
  on conflict (id_tenant, idempotency_key) do nothing
  returning * into r;
  if found then
    return query select 'scheduled'::text, r.id, r.remind_at;
    return;
  end if;
  -- La MISMA solicitud ya se procesó (y el recordatorio ya no está activo: enviado o cancelado).
  select * into r from public.dulabs_ba_reminders x where x.id_tenant = p_tenant and x.idempotency_key = p_key;
  return query select ('closed_' || r.status)::text, r.id, r.remind_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancelar / reprogramar (ciclo de vida de la cita)
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_ba_reminder_cancel(p_tenant uuid, p_conversation text, p_anchor text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  update public.dulabs_ba_reminders x
     set status = 'cancelled'
   where x.id_tenant = p_tenant and x.conversation_id = p_conversation and x.status = 'scheduled'
     and (p_anchor is null or x.anchor_ref = p_anchor);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.dulabs_ba_reminder_reschedule(p_tenant uuid, p_conversation text, p_anchor text, p_new_start timestamptz, p_offset_minutes integer)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  if p_offset_minutes is null or p_offset_minutes < 15 or p_offset_minutes > 2880 then
    raise exception 'dulabs_ba_reminder_reschedule: anticipación fuera de rango' using errcode = 'check_violation';
  end if;
  update public.dulabs_ba_reminders x
     set appointment_start = p_new_start, remind_at = p_new_start - make_interval(mins => p_offset_minutes)
   where x.id_tenant = p_tenant and x.conversation_id = p_conversation and x.status = 'scheduled'
     and (p_anchor is null or x.anchor_ref = p_anchor)
     and p_new_start - make_interval(mins => p_offset_minutes) > now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Despacho: tomar vencidos (lease) y cerrar con fencing
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_ba_reminder_claim_due(p_limit integer, p_lease_seconds integer)
returns setof public.dulabs_ba_reminders
language plpgsql
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_lease_seconds is null or p_lease_seconds < 5 or p_lease_seconds > 300 then
    raise exception 'dulabs_ba_reminder_claim_due: parámetros fuera de rango' using errcode = 'check_violation';
  end if;
  -- Un envío que quedó a medias (lease vencido) pudo haber salido: NUNCA se reenvía.
  update public.dulabs_ba_reminders x
     set status = 'unknown', last_error = 'OUTCOME_UNKNOWN', lease_until = null
   where x.status = 'sending' and x.lease_until < now();
  return query
  update public.dulabs_ba_reminders x
     set status = 'sending', attempts = x.attempts + 1, lease_until = now() + make_interval(secs => p_lease_seconds)
   where x.id in (
     select y.id from public.dulabs_ba_reminders y
      where y.status = 'scheduled' and y.remind_at <= now() and y.attempts < 10
      order by y.remind_at
      limit p_limit
      for update skip locked
   )
  returning x.*;
end;
$$;

create or replace function public.dulabs_ba_reminder_complete(p_tenant uuid, p_id uuid, p_attempts integer, p_status text, p_error text, p_retry_at timestamptz)
returns boolean
language plpgsql
as $$
begin
  if p_status not in ('sent', 'failed', 'unknown', 'retry') then
    raise exception 'dulabs_ba_reminder_complete: estado inválido %', p_status using errcode = 'check_violation';
  end if;
  if p_status = 'retry' then
    update public.dulabs_ba_reminders x
       set status = 'scheduled', remind_at = least(coalesce(p_retry_at, now()), x.appointment_start - interval '1 minute'), lease_until = null, last_error = p_error
     where x.id = p_id and x.id_tenant = p_tenant and x.status = 'sending' and x.attempts = p_attempts
       and coalesce(p_retry_at, now()) < x.appointment_start;
    if found then return true; end if;
    -- Ya no hay tiempo para reintentar antes de la cita: se cierra como fallido.
    update public.dulabs_ba_reminders x
       set status = 'failed', lease_until = null, last_error = coalesce(p_error, 'NO_TIME_TO_RETRY')
     where x.id = p_id and x.id_tenant = p_tenant and x.status = 'sending' and x.attempts = p_attempts;
    return found;
  end if;
  update public.dulabs_ba_reminders x
     set status = p_status, lease_until = null, last_error = p_error, sent_at = case when p_status = 'sent' then now() else x.sent_at end
   where x.id = p_id and x.id_tenant = p_tenant and x.status = 'sending' and x.attempts = p_attempts;
  return found;
end;
$$;

revoke all on function public.dulabs_ba_reminder_schedule(uuid, text, text, text, text, text, timestamptz, text, timestamptz, text, text, text) from public;
revoke all on function public.dulabs_ba_reminder_cancel(uuid, text, text) from public;
revoke all on function public.dulabs_ba_reminder_reschedule(uuid, text, text, timestamptz, integer) from public;
revoke all on function public.dulabs_ba_reminder_claim_due(integer, integer) from public;
revoke all on function public.dulabs_ba_reminder_complete(uuid, uuid, integer, text, text, timestamptz) from public;
do $$
declare
  fns text[] := array[
    'public.dulabs_ba_reminder_schedule(uuid, text, text, text, text, text, timestamptz, text, timestamptz, text, text, text)',
    'public.dulabs_ba_reminder_cancel(uuid, text, text)',
    'public.dulabs_ba_reminder_reschedule(uuid, text, text, timestamptz, integer)',
    'public.dulabs_ba_reminder_claim_due(integer, integer)',
    'public.dulabs_ba_reminder_complete(uuid, uuid, integer, text, text, timestamptz)'
  ];
  f text;
begin
  foreach f in array fns loop
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end;
$$;
