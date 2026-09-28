-- DuLabs Business — Business Agent 2.0, corrección encontrada en la VERIFICACIÓN DE PRODUCCIÓN posterior a FASE 9.
--
-- DEFECTO: dulabs_ba_reminder_schedule (20261127) buscaba el recordatorio activo de la cita con SELECT … FOR UPDATE y,
-- si no existía, insertaba. Dos operaciones distintas para la MISMA cita en paralelo no encontraban fila que bloquear y
-- ambas insertaban: una fallaba con unique_violation (dulabs_ba_reminders_activo_uidx). El invariante (un solo activo)
-- se mantenía, pero la función lanzaba error en vez de devolver 'updated'. Reproducido: scripts/verify-ba-concurrency.sh
-- caso C3 (10 sesiones), 4 de 5 rondas con errores.
--
-- CORRECCIÓN: la MISMA función, con un candado transaccional por (tenant, conversación, cita) al inicio. La firma de 13
-- argumentos (20261128) delega en esta, así que queda cubierta. ADITIVA e idempotente (create or replace); requiere
-- 20261127. Permisos: iguales (se re-aplican).
-- RECUPERACIÓN: volver a ejecutar la definición de 20261127 (sin la línea del candado).

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
  -- FASE 9 (verificación de producción): serializa por (tenant, conversación, cita). Sin esto, dos operaciones
  -- DISTINTAS para la misma cita que llegan a la vez no encuentran fila activa que bloquear (FOR UPDATE sobre nada) y
  -- ambas insertan: la segunda falla con unique_violation en dulabs_ba_reminders_activo_uidx en vez de 'updated'.
  perform pg_advisory_xact_lock(hashtextextended('dulabs_ba_reminder:' || p_tenant::text || ':' || p_conversation || ':' || p_anchor, 0));
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

revoke all on function public.dulabs_ba_reminder_schedule(uuid, text, text, text, text, text, timestamptz, text, timestamptz, text, text, text) from public;
do $$
declare
  f constant text := 'public.dulabs_ba_reminder_schedule(uuid, text, text, text, text, text, timestamptz, text, timestamptz, text, text, text)';
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
end;
$$;
