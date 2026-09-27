-- DuLabs Business — Business Agent 2.0, FASE 4: Action Engine (registro de ejecuciones + candado de reserva).
--
-- Tablas NUEVAS, aditivas. NO modifica ninguna tabla existente.
--
-- 1. dulabs_ba_action_executions — una fila por (tenant, idempotency_key): la clave es determinista por operación
--    (tenant + conversación + objetivo + acción + argumentos, ver conversation/actions.ts), así que un webhook
--    duplicado, un reintento o un worker reiniciado encuentran la MISMA fila y nunca ejecutan dos veces.
--    La lógica atómica vive en funciones (dulabs_ba_action_claim / _complete) para que la garantía la dé Postgres:
--      * el primer INSERT gana (ON CONFLICT DO NOTHING); los demás leen la fila con FOR UPDATE;
--      * completado → se devuelve el resultado guardado (replay), sin ejecutar;
--      * en curso con lease vigente → in_progress;
--      * lease vencido / timeout: una LECTURA se puede retomar (attempt + 1); una ESCRITURA NO se re-ejecuta
--        (desenlace desconocido → TIMED_OUT / OUTCOME_UNKNOWN);
--      * _complete exige status RUNNING y el MISMO attempt (fencing): un worker viejo no pisa el resultado de otro.
-- 2. dulabs_ba_booking_locks — candado con lease por (tenant, clave de agenda): serializa "verificar calendario →
--    crear evento" entre conversaciones del mismo negocio para la misma fecha. Evita la doble reserva ENTRE
--    conversaciones del Business Agent; no puede impedir una reserva hecha fuera de DuLabs directamente en el
--    calendario (el handler revalida el calendario justo antes de crear, pero esa ventana existe y está documentada).
--
-- SEGURIDAD: RLS habilitada sin políticas (solo service_role); funciones sin EXECUTE para public/anon/authenticated.
-- RECUPERACIÓN: todo es aditivo. Para revertir: drop function ...; drop table dulabs_ba_booking_locks,
--   dulabs_ba_action_executions; (no hay datos de otras tablas involucrados).

create table if not exists public.dulabs_ba_action_executions (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  agent_id text not null check (char_length(agent_id) between 1 and 64),
  conversation_id text not null check (char_length(conversation_id) between 1 and 120),
  action text not null check (action ~ '^[a-z][a-z0-9_]{0,79}$'),
  contract_version text not null check (char_length(contract_version) between 1 and 20),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{32}$'),
  arguments_hash text not null check (arguments_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'TIMED_OUT')),
  attempt integer not null default 1 check (attempt between 1 and 10),
  retryable boolean not null default false,
  lease_until timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 32768)),
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_]{1,60}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_ba_action_executions_key unique (id_tenant, idempotency_key),
  constraint dulabs_ba_action_executions_running_lease check (status <> 'RUNNING' or lease_until is not null)
);

create index if not exists dulabs_ba_action_executions_conversacion_idx
  on public.dulabs_ba_action_executions (id_tenant, conversation_id, created_at desc);

comment on table public.dulabs_ba_action_executions is
  'Ejecuciones del Action Engine del Business Agent (FASE 4). Una fila por (tenant, idempotency_key determinista). Sin datos del cliente en claro: argumentos por hash; result guarda solo los datos que la acción declara.';

create or replace function public.dulabs_ba_action_executions_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id_tenant <> old.id_tenant or new.idempotency_key <> old.idempotency_key or new.action <> old.action
     or new.arguments_hash <> old.arguments_hash or new.agent_id <> old.agent_id or new.conversation_id <> old.conversation_id then
    raise exception 'dulabs_ba_action_executions: la identidad de la ejecución no se puede cambiar' using errcode = 'check_violation';
  end if;
  if new.attempt < old.attempt then
    raise exception 'dulabs_ba_action_executions: attempt no puede retroceder' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists dulabs_ba_action_executions_guard on public.dulabs_ba_action_executions;
create trigger dulabs_ba_action_executions_guard
  before update on public.dulabs_ba_action_executions
  for each row execute function public.dulabs_ba_action_executions_guard();

drop trigger if exists dulabs_ba_action_executions_updated_at on public.dulabs_ba_action_executions;
create trigger dulabs_ba_action_executions_updated_at
  before update on public.dulabs_ba_action_executions
  for each row execute function public.dulabs_flow_set_updated_at();

alter table public.dulabs_ba_action_executions enable row level security;

-- ---------------------------------------------------------------------------
-- Claim atómico
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_ba_action_claim(
  p_tenant uuid,
  p_agent text,
  p_conversation text,
  p_action text,
  p_contract_version text,
  p_key text,
  p_args_hash text,
  p_lease_seconds integer,
  p_retakeable boolean
)
returns table (outcome text, execution_id uuid, attempt integer, status text, result jsonb)
language plpgsql
as $$
declare
  r public.dulabs_ba_action_executions%rowtype;
begin
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 300 then
    raise exception 'dulabs_ba_action_claim: lease fuera de rango' using errcode = 'check_violation';
  end if;

  insert into public.dulabs_ba_action_executions
    (id_tenant, agent_id, conversation_id, action, contract_version, idempotency_key, arguments_hash, status, attempt, lease_until, started_at)
  values
    (p_tenant, p_agent, p_conversation, p_action, p_contract_version, p_key, p_args_hash, 'RUNNING', 1, now() + make_interval(secs => p_lease_seconds), now())
  on conflict (id_tenant, idempotency_key) do nothing
  returning * into r;
  if found then
    return query select 'claimed'::text, r.id, r.attempt, r.status, null::jsonb;
    return;
  end if;

  select * into r from public.dulabs_ba_action_executions e
   where e.id_tenant = p_tenant and e.idempotency_key = p_key
   for update;

  -- La misma clave con otra operación: nunca se reutiliza el resultado de otra solicitud.
  if r.arguments_hash <> p_args_hash or r.action <> p_action or r.agent_id <> p_agent or r.conversation_id <> p_conversation then
    return query select 'mismatch'::text, r.id, r.attempt, r.status, null::jsonb;
    return;
  end if;

  if r.status in ('SUCCEEDED', 'REJECTED') or (r.status = 'FAILED' and not (p_retakeable and r.retryable)) then
    return query select 'completed'::text, r.id, r.attempt, r.status, r.result;
    return;
  end if;

  if r.status = 'RUNNING' and r.lease_until > now() then
    return query select 'in_progress'::text, r.id, r.attempt, r.status, null::jsonb;
    return;
  end if;

  -- RUNNING con lease vencido, TIMED_OUT o FAILED reintentable.
  if p_retakeable and r.attempt < 10 then
    update public.dulabs_ba_action_executions e
       set status = 'RUNNING', attempt = r.attempt + 1, lease_until = now() + make_interval(secs => p_lease_seconds),
           started_at = now(), completed_at = null, result = null, error_code = null, retryable = false
     where e.id = r.id
    returning * into r;
    return query select 'claimed'::text, r.id, r.attempt, r.status, null::jsonb;
    return;
  end if;

  -- Una escritura cuyo worker desapareció: NO se re-ejecuta. Desenlace desconocido.
  if r.status = 'RUNNING' then
    update public.dulabs_ba_action_executions e
       set status = 'TIMED_OUT', error_code = 'OUTCOME_UNKNOWN', completed_at = now(), lease_until = null
     where e.id = r.id
    returning * into r;
  end if;
  return query select 'unknown'::text, r.id, r.attempt, r.status, r.result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cierre con fencing: solo el dueño del attempt vigente puede escribir el resultado.
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_ba_action_complete(
  p_tenant uuid,
  p_execution uuid,
  p_attempt integer,
  p_status text,
  p_result jsonb,
  p_error_code text,
  p_retryable boolean
)
returns boolean
language plpgsql
as $$
begin
  if p_status not in ('SUCCEEDED', 'FAILED', 'REJECTED', 'TIMED_OUT') then
    raise exception 'dulabs_ba_action_complete: estado final inválido %', p_status using errcode = 'check_violation';
  end if;
  update public.dulabs_ba_action_executions e
     set status = p_status, result = p_result, error_code = p_error_code, retryable = coalesce(p_retryable, false),
         completed_at = now(), lease_until = null
   where e.id = p_execution and e.id_tenant = p_tenant and e.status = 'RUNNING' and e.attempt = p_attempt;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Candado de reserva (lease)
-- ---------------------------------------------------------------------------
create table if not exists public.dulabs_ba_booking_locks (
  id_tenant uuid not null,
  lock_key text not null check (char_length(lock_key) between 1 and 200),
  holder text not null check (char_length(holder) between 1 and 80),
  lease_until timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (id_tenant, lock_key)
);

comment on table public.dulabs_ba_booking_locks is
  'Candado con lease del Action Engine (FASE 4): serializa verificar-calendario → crear-evento por (tenant, fecha) entre conversaciones del Business Agent.';

alter table public.dulabs_ba_booking_locks enable row level security;

create or replace function public.dulabs_ba_booking_lock_acquire(p_tenant uuid, p_key text, p_holder text, p_seconds integer)
returns boolean
language plpgsql
as $$
declare
  v boolean;
begin
  if p_seconds is null or p_seconds < 1 or p_seconds > 300 then
    raise exception 'dulabs_ba_booking_lock_acquire: lease fuera de rango' using errcode = 'check_violation';
  end if;
  insert into public.dulabs_ba_booking_locks as l (id_tenant, lock_key, holder, lease_until)
  values (p_tenant, p_key, p_holder, now() + make_interval(secs => p_seconds))
  on conflict (id_tenant, lock_key) do update
     set holder = excluded.holder, lease_until = excluded.lease_until
   where l.lease_until < now() or l.holder = excluded.holder
  returning true into v;
  return coalesce(v, false);
end;
$$;

create or replace function public.dulabs_ba_booking_lock_release(p_tenant uuid, p_key text, p_holder text)
returns boolean
language plpgsql
as $$
begin
  delete from public.dulabs_ba_booking_locks l where l.id_tenant = p_tenant and l.lock_key = p_key and l.holder = p_holder;
  return found;
end;
$$;

revoke all on function public.dulabs_ba_action_claim(uuid, text, text, text, text, text, text, integer, boolean) from public;
revoke all on function public.dulabs_ba_action_complete(uuid, uuid, integer, text, jsonb, text, boolean) from public;
revoke all on function public.dulabs_ba_booking_lock_acquire(uuid, text, text, integer) from public;
revoke all on function public.dulabs_ba_booking_lock_release(uuid, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.dulabs_ba_action_claim(uuid, text, text, text, text, text, text, integer, boolean) from anon';
    execute 'revoke all on function public.dulabs_ba_action_complete(uuid, uuid, integer, text, jsonb, text, boolean) from anon';
    execute 'revoke all on function public.dulabs_ba_booking_lock_acquire(uuid, text, text, integer) from anon';
    execute 'revoke all on function public.dulabs_ba_booking_lock_release(uuid, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.dulabs_ba_action_claim(uuid, text, text, text, text, text, text, integer, boolean) from authenticated';
    execute 'revoke all on function public.dulabs_ba_action_complete(uuid, uuid, integer, text, jsonb, text, boolean) from authenticated';
    execute 'revoke all on function public.dulabs_ba_booking_lock_acquire(uuid, text, text, integer) from authenticated';
    execute 'revoke all on function public.dulabs_ba_booking_lock_release(uuid, text, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.dulabs_ba_action_claim(uuid, text, text, text, text, text, text, integer, boolean) to service_role';
    execute 'grant execute on function public.dulabs_ba_action_complete(uuid, uuid, integer, text, jsonb, text, boolean) to service_role';
    execute 'grant execute on function public.dulabs_ba_booking_lock_acquire(uuid, text, text, integer) to service_role';
    execute 'grant execute on function public.dulabs_ba_booking_lock_release(uuid, text, text) to service_role';
  end if;
end;
$$;
