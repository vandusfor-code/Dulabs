-- DuLabs Business — Business Agent 2.0, FASE 9: hardening de producción.
--
-- ADITIVA e idempotente. Requiere 20261127000000_dulabs_ba_reminders (recordatorios). NO modifica tablas fuera del
-- Business Agent. Todo con RLS sin políticas (solo service_role) y funciones sin EXECUTE para public/anon/authenticated.
--
-- 1. Recordatorios — correcciones de FASE 9 (auditoría):
--    a) El texto se RENDERIZA AL ENVIAR (tono + servicio + inicio vigente de la cita). Antes el texto guardado al
--       programar quedaba con la hora vieja si la cita se reprogramaba. `message` queda como respaldo histórico.
--    b) Cancelar / reprogramar una cita cuyo recordatorio YA está 'sending' lo INVALIDA: el despachador pregunta
--       `dulabs_ba_reminder_begin_send` justo antes de enviar y, si fue invalidado, no envía (cancelado o reprogramado).
--    c) Envío de desenlace desconocido: se registra cuándo se tomó (`last_claimed_at`) y se VERIFICA contra el historial
--       de mensajes salientes antes de decidir; nunca se reenvía a ciegas.
-- 2. Límites de uso (rate limiting) por ventana fija, atómicos (sin memoria del proceso).
-- 3. Uso por tenant y día (llamadas de IA, tokens, costo estimado, acciones, errores, latencia) — observabilidad de costo.
-- 4. Incidentes: errores BA-* con referencia de soporte, localizables por tenant.
-- 5. Latidos de jobs (despacho de recordatorios) para readiness.
--
-- RECUPERACIÓN: drop de las funciones/tablas nuevas; las columnas nuevas de dulabs_ba_reminders son opcionales.

-- ---------------------------------------------------------------------------
-- 1. Recordatorios
-- ---------------------------------------------------------------------------
alter table public.dulabs_ba_reminders add column if not exists tone text check (tone is null or tone in ('profesional', 'cercano', 'casual', 'formal'));
alter table public.dulabs_ba_reminders add column if not exists invalidated_at timestamptz;
alter table public.dulabs_ba_reminders add column if not exists cancel_requested boolean not null default false;
alter table public.dulabs_ba_reminders add column if not exists last_claimed_at timestamptz;
alter table public.dulabs_ba_reminders add column if not exists verification text check (verification is null or verification in ('pending', 'verified_sent', 'not_found'));
alter table public.dulabs_ba_reminders add column if not exists provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200);

-- El guard de 20261127 impide reabrir un recordatorio cerrado. FASE 9 necesita UNA transición más, controlada: un
-- 'unknown' verificado como enviado pasa a 'sent' (nunca a 'scheduled').
create or replace function public.dulabs_ba_reminders_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id_tenant <> old.id_tenant or new.conversation_id <> old.conversation_id or new.anchor_ref <> old.anchor_ref
     or new.idempotency_key <> old.idempotency_key or new.telefono_cliente <> old.telefono_cliente or new.phone_number_id <> old.phone_number_id then
    raise exception 'dulabs_ba_reminders: la identidad del recordatorio no se puede cambiar' using errcode = 'check_violation';
  end if;
  if old.status in ('sent', 'cancelled', 'failed') and new.status <> old.status then
    raise exception 'dulabs_ba_reminders: un recordatorio cerrado no se reabre' using errcode = 'check_violation';
  end if;
  if old.status = 'unknown' and new.status <> old.status and new.status <> 'sent' then
    raise exception 'dulabs_ba_reminders: un envío desconocido solo puede resolverse como enviado (verificado)' using errcode = 'check_violation';
  end if;
  if new.attempts < old.attempts then
    raise exception 'dulabs_ba_reminders: attempts no puede retroceder' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Programar: igual que 20261127 + tono (el texto se renderiza al enviar). Firma nueva (13 args); la de 12 se conserva.
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
  p_key text,
  p_tone text
)
returns table (outcome text, reminder_id uuid, remind_at timestamptz)
language plpgsql
as $$
declare
  r record;
begin
  select * into r from public.dulabs_ba_reminder_schedule(p_tenant, p_agent, p_conversation, p_phone_number_id, p_telefono, p_anchor, p_appointment_start, p_service, p_remind_at, p_timezone, p_message, p_key);
  if r.reminder_id is not null and r.outcome in ('scheduled', 'updated', 'unchanged') then
    update public.dulabs_ba_reminders x set tone = p_tone where x.id = r.reminder_id and x.id_tenant = p_tenant and x.tone is distinct from p_tone;
  end if;
  return query select r.outcome, r.reminder_id, r.remind_at;
end;
$$;

create or replace function public.dulabs_ba_reminder_cancel(p_tenant uuid, p_conversation text, p_anchor text)
returns integer
language plpgsql
as $$
declare
  n integer;
  m integer;
begin
  update public.dulabs_ba_reminders x
     set status = 'cancelled'
   where x.id_tenant = p_tenant and x.conversation_id = p_conversation and x.status = 'scheduled'
     and (p_anchor is null or x.anchor_ref = p_anchor);
  get diagnostics n = row_count;
  -- Ya tomado por el despachador: se invalida (no se enviará; begin_send lo cierra como cancelado).
  update public.dulabs_ba_reminders x
     set invalidated_at = now(), cancel_requested = true
   where x.id_tenant = p_tenant and x.conversation_id = p_conversation and x.status = 'sending'
     and (p_anchor is null or x.anchor_ref = p_anchor);
  get diagnostics m = row_count;
  return n + m;
end;
$$;

create or replace function public.dulabs_ba_reminder_reschedule(p_tenant uuid, p_conversation text, p_anchor text, p_new_start timestamptz, p_offset_minutes integer)
returns integer
language plpgsql
as $$
declare
  n integer;
  m integer;
  v_at timestamptz;
begin
  if p_offset_minutes is null or p_offset_minutes < 15 or p_offset_minutes > 2880 then
    raise exception 'dulabs_ba_reminder_reschedule: anticipación fuera de rango' using errcode = 'check_violation';
  end if;
  v_at := p_new_start - make_interval(mins => p_offset_minutes);
  if v_at <= now() then
    -- El nuevo momento ya pasó: el recordatorio de la hora vieja NO debe dispararse.
    return public.dulabs_ba_reminder_cancel(p_tenant, p_conversation, p_anchor);
  end if;
  update public.dulabs_ba_reminders x
     set appointment_start = p_new_start, remind_at = v_at
   where x.id_tenant = p_tenant and x.conversation_id = p_conversation and x.status = 'scheduled'
     and (p_anchor is null or x.anchor_ref = p_anchor);
  get diagnostics n = row_count;
  update public.dulabs_ba_reminders x
     set appointment_start = p_new_start, remind_at = v_at, invalidated_at = now()
   where x.id_tenant = p_tenant and x.conversation_id = p_conversation and x.status = 'sending'
     and (p_anchor is null or x.anchor_ref = p_anchor);
  get diagnostics m = row_count;
  return n + m;
end;
$$;

-- Claim: igual que 20261127 + marca de tiempo del claim y verificación pendiente para los que quedan 'unknown'.
create or replace function public.dulabs_ba_reminder_claim_due(p_limit integer, p_lease_seconds integer)
returns setof public.dulabs_ba_reminders
language plpgsql
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_lease_seconds is null or p_lease_seconds < 5 or p_lease_seconds > 300 then
    raise exception 'dulabs_ba_reminder_claim_due: parámetros fuera de rango' using errcode = 'check_violation';
  end if;
  update public.dulabs_ba_reminders x
     set status = 'unknown', last_error = 'OUTCOME_UNKNOWN', lease_until = null, verification = 'pending'
   where x.status = 'sending' and x.lease_until < now();
  return query
  update public.dulabs_ba_reminders x
     set status = 'sending', attempts = x.attempts + 1, lease_until = now() + make_interval(secs => p_lease_seconds), last_claimed_at = now()
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

-- Justo antes de enviar: ¿sigue siendo válido? 'go' = enviar; 'cancelled' / 'rescheduled' / 'lost' = NO enviar.
create or replace function public.dulabs_ba_reminder_begin_send(p_tenant uuid, p_id uuid, p_attempts integer)
returns text
language plpgsql
as $$
declare
  r public.dulabs_ba_reminders%rowtype;
begin
  select * into r from public.dulabs_ba_reminders x where x.id = p_id and x.id_tenant = p_tenant for update;
  if not found or r.status <> 'sending' or r.attempts <> p_attempts then
    return 'lost';
  end if;
  if r.invalidated_at is null then
    return 'go';
  end if;
  if r.cancel_requested then
    update public.dulabs_ba_reminders x set status = 'cancelled', lease_until = null where x.id = p_id;
    return 'cancelled';
  end if;
  update public.dulabs_ba_reminders x set status = 'scheduled', lease_until = null, invalidated_at = null where x.id = p_id;
  return 'rescheduled';
end;
$$;

-- Cierre (igual que 20261127) + un 'unknown' queda con verificación pendiente.
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
    update public.dulabs_ba_reminders x
       set status = 'failed', lease_until = null, last_error = coalesce(p_error, 'NO_TIME_TO_RETRY')
     where x.id = p_id and x.id_tenant = p_tenant and x.status = 'sending' and x.attempts = p_attempts;
    return found;
  end if;
  update public.dulabs_ba_reminders x
     set status = p_status, lease_until = null, last_error = p_error,
         sent_at = case when p_status = 'sent' then now() else x.sent_at end,
         verification = case when p_status = 'unknown' then 'pending' else x.verification end
   where x.id = p_id and x.id_tenant = p_tenant and x.status = 'sending' and x.attempts = p_attempts;
  return found;
end;
$$;

-- Envíos de desenlace desconocido pendientes de verificar. La verificación es de SOLO LECTURA + resolve_unknown
-- idempotente: si dos despachadores verifican el mismo, ambos llegan al mismo resultado (nunca hay reenvío).
create or replace function public.dulabs_ba_reminder_unverified(p_limit integer)
returns setof public.dulabs_ba_reminders
language plpgsql
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'dulabs_ba_reminder_unverified: límite fuera de rango' using errcode = 'check_violation';
  end if;
  return query
  select * from public.dulabs_ba_reminders y
   where y.status = 'unknown' and y.verification = 'pending'
   order by y.updated_at
   limit p_limit
   for update skip locked;
end;
$$;

-- Resultado de la verificación: encontrado en el historial → 'sent'; no encontrado → sigue 'unknown' (NO se reenvía:
-- que no esté registrado no prueba que Meta no lo entregó).
create or replace function public.dulabs_ba_reminder_resolve_unknown(p_tenant uuid, p_id uuid, p_found boolean)
returns boolean
language plpgsql
as $$
begin
  if p_found then
    update public.dulabs_ba_reminders x set status = 'sent', verification = 'verified_sent', sent_at = coalesce(x.sent_at, now())
     where x.id = p_id and x.id_tenant = p_tenant and x.status = 'unknown';
  else
    update public.dulabs_ba_reminders x set verification = 'not_found'
     where x.id = p_id and x.id_tenant = p_tenant and x.status = 'unknown';
  end if;
  return found;
end;
$$;

-- Cierre con el id del mensaje del proveedor (cuando se conoce).
create or replace function public.dulabs_ba_reminder_mark_sent(p_tenant uuid, p_id uuid, p_attempts integer, p_provider_message_id text)
returns boolean
language plpgsql
as $$
begin
  update public.dulabs_ba_reminders x
     set status = 'sent', lease_until = null, last_error = null, sent_at = now(), provider_message_id = left(p_provider_message_id, 200)
   where x.id = p_id and x.id_tenant = p_tenant and x.status = 'sending' and x.attempts = p_attempts;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Límites de uso
-- ---------------------------------------------------------------------------
create table if not exists public.dulabs_ba_rate_counters (
  scope text not null check (scope ~ '^[a-z_]{1,40}$'),
  bucket_key text not null check (char_length(bucket_key) between 1 and 160),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (scope, bucket_key, window_start)
);
create index if not exists dulabs_ba_rate_counters_window_idx on public.dulabs_ba_rate_counters (window_start);
comment on table public.dulabs_ba_rate_counters is
  'Contadores de límites de uso del Business Agent (FASE 9) por ventana fija. bucket_key nunca lleva datos del cliente en claro (teléfono por hash).';
alter table public.dulabs_ba_rate_counters enable row level security;

create or replace function public.dulabs_ba_rate_limit_hit(p_scope text, p_key text, p_window_seconds integer, p_limit integer)
returns table (allowed boolean, hits integer, window_start timestamptz)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_start timestamptz;
  v_hits integer;
begin
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 or p_limit is null or p_limit < 1 then
    raise exception 'dulabs_ba_rate_limit_hit: parámetros fuera de rango' using errcode = 'check_violation';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.dulabs_ba_rate_counters as c (scope, bucket_key, window_start, hits)
  values (p_scope, p_key, v_start, 1)
  on conflict (scope, bucket_key, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hits;
  return query select v_hits <= p_limit, v_hits, v_start;
end;
$$;

create or replace function public.dulabs_ba_rate_counters_prune(p_older_than_seconds integer)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  delete from public.dulabs_ba_rate_counters c where c.window_start < now() - make_interval(secs => greatest(3600, p_older_than_seconds));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Uso por tenant y día (observabilidad de costo; NO es facturación)
-- ---------------------------------------------------------------------------
create table if not exists public.dulabs_ba_usage_daily (
  id_tenant uuid not null,
  day date not null,
  turns integer not null default 0 check (turns >= 0),
  ai_calls integer not null default 0 check (ai_calls >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  estimated_cost_micro_usd bigint not null default 0 check (estimated_cost_micro_usd >= 0),
  actions integer not null default 0 check (actions >= 0),
  action_errors integer not null default 0 check (action_errors >= 0),
  turn_errors integer not null default 0 check (turn_errors >= 0),
  latency_ms_total bigint not null default 0 check (latency_ms_total >= 0),
  updated_at timestamptz not null default now(),
  primary key (id_tenant, day)
);
comment on table public.dulabs_ba_usage_daily is
  'Uso del Business Agent por tenant y día (FASE 9): turnos, llamadas de IA, tokens, costo ESTIMADO, acciones, errores y latencia. Sin datos del cliente. No es facturación.';
alter table public.dulabs_ba_usage_daily enable row level security;

create or replace function public.dulabs_ba_usage_record(
  p_tenant uuid,
  p_day date,
  p_turns integer,
  p_ai_calls integer,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cost_micro_usd bigint,
  p_actions integer,
  p_action_errors integer,
  p_turn_errors integer,
  p_latency_ms bigint
)
returns void
language plpgsql
as $$
begin
  if least(p_turns, p_ai_calls, p_actions, p_action_errors, p_turn_errors) < 0 or least(p_input_tokens, p_output_tokens, p_cost_micro_usd, p_latency_ms) < 0 then
    raise exception 'dulabs_ba_usage_record: valores negativos' using errcode = 'check_violation';
  end if;
  insert into public.dulabs_ba_usage_daily as u (id_tenant, day, turns, ai_calls, input_tokens, output_tokens, estimated_cost_micro_usd, actions, action_errors, turn_errors, latency_ms_total)
  values (p_tenant, p_day, p_turns, p_ai_calls, p_input_tokens, p_output_tokens, p_cost_micro_usd, p_actions, p_action_errors, p_turn_errors, p_latency_ms)
  on conflict (id_tenant, day) do update set
    turns = u.turns + excluded.turns,
    ai_calls = u.ai_calls + excluded.ai_calls,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    estimated_cost_micro_usd = u.estimated_cost_micro_usd + excluded.estimated_cost_micro_usd,
    actions = u.actions + excluded.actions,
    action_errors = u.action_errors + excluded.action_errors,
    turn_errors = u.turn_errors + excluded.turn_errors,
    latency_ms_total = u.latency_ms_total + excluded.latency_ms_total,
    updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Incidentes (errores BA-* localizables por referencia de soporte)
-- ---------------------------------------------------------------------------
create table if not exists public.dulabs_ba_incidents (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  ref text not null check (ref ~ '^[A-Z0-9]{6,12}$'),
  correlation_id text not null check (char_length(correlation_id) between 8 and 64),
  agent_id text check (agent_id is null or char_length(agent_id) <= 64),
  published_version text check (published_version is null or char_length(published_version) <= 64),
  engine text check (engine is null or engine in ('graph_v1', 'state_machine_v1')),
  code text not null check (code ~ '^BA-[A-Z]+-[A-Z0-9_]{1,60}$'),
  error_class text not null check (error_class in ('USER', 'CONFIG', 'AI', 'INTEGRATION', 'SYSTEM', 'UNKNOWN')),
  dependency text check (dependency is null or dependency ~ '^[a-z_]{1,40}$'),
  cause text check (cause is null or char_length(cause) <= 120),
  occurred_at timestamptz not null default now(),
  constraint dulabs_ba_incidents_ref unique (id_tenant, ref, code)
);
create index if not exists dulabs_ba_incidents_lookup_idx on public.dulabs_ba_incidents (id_tenant, ref);
create index if not exists dulabs_ba_incidents_time_idx on public.dulabs_ba_incidents (occurred_at);
comment on table public.dulabs_ba_incidents is
  'Errores BA-* del Business Agent (FASE 9) con referencia de soporte: tenant, versión, motor, dependencia, causa y hora. Sin textos del cliente, sin secretos.';
alter table public.dulabs_ba_incidents enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Latidos de jobs
-- ---------------------------------------------------------------------------
create table if not exists public.dulabs_ba_job_runs (
  job text primary key check (job ~ '^[a-z_]{1,60}$'),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_ok boolean,
  last_summary jsonb check (last_summary is null or (jsonb_typeof(last_summary) = 'object' and pg_column_size(last_summary) <= 4096)),
  updated_at timestamptz not null default now()
);
alter table public.dulabs_ba_job_runs enable row level security;

create or replace function public.dulabs_ba_job_heartbeat(p_job text, p_ok boolean, p_summary jsonb)
returns void
language plpgsql
as $$
begin
  insert into public.dulabs_ba_job_runs as j (job, last_started_at, last_finished_at, last_ok, last_summary, updated_at)
  values (p_job, now(), now(), p_ok, p_summary, now())
  on conflict (job) do update set last_finished_at = now(), last_ok = excluded.last_ok, last_summary = excluded.last_summary, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
do $$
declare
  fns text[] := array[
    'public.dulabs_ba_reminder_schedule(uuid, text, text, text, text, text, timestamptz, text, timestamptz, text, text, text, text)',
    'public.dulabs_ba_reminder_cancel(uuid, text, text)',
    'public.dulabs_ba_reminder_reschedule(uuid, text, text, timestamptz, integer)',
    'public.dulabs_ba_reminder_claim_due(integer, integer)',
    'public.dulabs_ba_reminder_complete(uuid, uuid, integer, text, text, timestamptz)',
    'public.dulabs_ba_reminder_begin_send(uuid, uuid, integer)',
    'public.dulabs_ba_reminder_unverified(integer)',
    'public.dulabs_ba_reminder_resolve_unknown(uuid, uuid, boolean)',
    'public.dulabs_ba_reminder_mark_sent(uuid, uuid, integer, text)',
    'public.dulabs_ba_rate_limit_hit(text, text, integer, integer)',
    'public.dulabs_ba_rate_counters_prune(integer)',
    'public.dulabs_ba_usage_record(uuid, date, integer, integer, bigint, bigint, bigint, integer, integer, integer, bigint)',
    'public.dulabs_ba_job_heartbeat(text, boolean, jsonb)'
  ];
  f text;
begin
  foreach f in array fns loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end;
$$;
