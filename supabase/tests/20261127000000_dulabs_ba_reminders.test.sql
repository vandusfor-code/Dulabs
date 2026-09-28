-- Business Agent 2.0, FASE 8 — verificación de 20261127000000_dulabs_ba_reminders.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO. Ver scripts/verify-ba-migration-chain.sh.

\set ON_ERROR_STOP 1

do $$
declare
  t1 constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  t2 constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  k1 constant text := repeat('a', 32);
  k2 constant text := repeat('b', 32);
  k3 constant text := repeat('c', 32);
  cita timestamptz := now() + interval '1 day';
  c record;
  n integer;
  ok boolean;
  rid uuid;
begin
  -- 1. Programar; la MISMA solicitud es idempotente; otra hora ACTUALIZA el mismo recordatorio (uno activo por cita).
  select * into c from dulabs_ba_reminder_schedule(t1, 'flow-1', 'pn:573', 'pn', '573', 'cita-1', cita, 'Corte', cita - interval '1 hour', 'America/Bogota', 'Te recuerdo tu cita', k1);
  if c.outcome <> 'scheduled' then raise exception 'FAIL 1 programar %', c.outcome; end if;
  rid := c.reminder_id;
  select * into c from dulabs_ba_reminder_schedule(t1, 'flow-1', 'pn:573', 'pn', '573', 'cita-1', cita, 'Corte', cita - interval '1 hour', 'America/Bogota', 'Te recuerdo tu cita', k1);
  if c.outcome <> 'unchanged' or c.reminder_id <> rid then raise exception 'FAIL 1 repetición %', c.outcome; end if;
  select * into c from dulabs_ba_reminder_schedule(t1, 'flow-1', 'pn:573', 'pn', '573', 'cita-1', cita, 'Corte', cita - interval '2 hour', 'America/Bogota', 'Te recuerdo tu cita', k2);
  if c.outcome <> 'updated' or c.reminder_id <> rid then raise exception 'FAIL 1 actualización %', c.outcome; end if;
  select count(*) into n from dulabs_ba_reminders where id_tenant = t1 and anchor_ref = 'cita-1' and status = 'scheduled';
  if n <> 1 then raise exception 'FAIL 1 activos %', n; end if;
  raise notice 'PASS 1 programar es idempotente y una nueva hora actualiza el ÚNICO recordatorio activo de la cita';

  -- 2. Reglas: después de la cita o en el pasado se rechaza (y el CHECK lo garantiza aunque se inserte directo).
  select * into c from dulabs_ba_reminder_schedule(t1, 'flow-1', 'pn:573', 'pn', '573', 'cita-2', cita, null, cita + interval '1 minute', 'America/Bogota', 'x', k3);
  if c.outcome <> 'after_appointment' then raise exception 'FAIL 2 después de la cita %', c.outcome; end if;
  select * into c from dulabs_ba_reminder_schedule(t1, 'flow-1', 'pn:573', 'pn', '573', 'cita-2', cita, null, now() - interval '1 hour', 'America/Bogota', 'x', k3);
  if c.outcome <> 'in_past' then raise exception 'FAIL 2 pasado %', c.outcome; end if;
  begin
    insert into dulabs_ba_reminders (id_tenant, agent_id, conversation_id, phone_number_id, telefono_cliente, anchor_ref, appointment_start, remind_at, timezone, message, idempotency_key)
    values (t1, 'f', 'c', 'p', 't', 'a', cita, cita, 'UTC', 'x', repeat('d', 32));
    raise exception 'FAIL 2 el CHECK no rechazó';
  exception when check_violation then null;
  end;
  raise notice 'PASS 2 un recordatorio siempre es anterior a la cita y nunca en el pasado';

  -- 3. Reprogramar la cita mueve el recordatorio; cancelar la cita lo cancela; otro tenant no toca nada.
  select dulabs_ba_reminder_reschedule(t2, 'pn:573', 'cita-1', cita + interval '1 day', 60) into n;
  if n <> 0 then raise exception 'FAIL 3 otro tenant reprogramó'; end if;
  select dulabs_ba_reminder_reschedule(t1, 'pn:573', 'cita-1', cita + interval '1 day', 60) into n;
  if n <> 1 then raise exception 'FAIL 3 reprogramar %', n; end if;
  if (select remind_at from dulabs_ba_reminders where id = rid) <> cita + interval '1 day' - interval '60 minutes' then raise exception 'FAIL 3 hora nueva'; end if;
  select dulabs_ba_reminder_cancel(t2, 'pn:573', null) into n;
  if n <> 0 then raise exception 'FAIL 3 otro tenant canceló'; end if;
  select dulabs_ba_reminder_cancel(t1, 'pn:573', 'cita-1') into n;
  if n <> 1 or (select status from dulabs_ba_reminders where id = rid) <> 'cancelled' then raise exception 'FAIL 3 cancelar'; end if;
  begin
    update dulabs_ba_reminders set status = 'scheduled' where id = rid;
    raise exception 'FAIL 3 se reabrió un recordatorio cancelado';
  exception when check_violation then null;
  end;
  raise notice 'PASS 3 el recordatorio sigue el ciclo de vida de la cita (reprogramar / cancelar), por tenant';

  -- 4. Despacho: claim con lease, fencing por attempts, y un envío a medias NUNCA se reenvía (unknown).
  select * into c from dulabs_ba_reminder_schedule(t1, 'flow-1', 'pn:999', 'pn', '999', 'cita-9', now() + interval '2 hour', null, now() + interval '30 minute', 'America/Bogota', 'x', repeat('e', 32));
  update dulabs_ba_reminders set remind_at = now() - interval '1 second' where id = c.reminder_id;
  select count(*) into n from dulabs_ba_reminder_claim_due(10, 30);
  if n <> 1 then raise exception 'FAIL 4 claim %', n; end if;
  select count(*) into n from dulabs_ba_reminder_claim_due(10, 30);
  if n <> 0 then raise exception 'FAIL 4 doble claim'; end if;
  select dulabs_ba_reminder_complete(t1, c.reminder_id, 2, 'sent', null, null) into ok;
  if ok then raise exception 'FAIL 4 attempt equivocado cerró'; end if;
  select dulabs_ba_reminder_complete(t1, c.reminder_id, 1, 'retry', 'SEND_FAILED', now() - interval '1 second') into ok;
  if not ok or (select status from dulabs_ba_reminders where id = c.reminder_id) <> 'scheduled' then raise exception 'FAIL 4 reintento'; end if;
  select count(*) into n from dulabs_ba_reminder_claim_due(10, 30);
  if n <> 1 then raise exception 'FAIL 4 reclaim'; end if;
  update dulabs_ba_reminders set lease_until = now() - interval '1 second' where id = c.reminder_id;
  select count(*) into n from dulabs_ba_reminder_claim_due(10, 30);
  if n <> 0 or (select status from dulabs_ba_reminders where id = c.reminder_id) <> 'unknown' then raise exception 'FAIL 4 lease vencido debe quedar unknown'; end if;
  raise notice 'PASS 4 despacho con lease + fencing; reintento acotado; un envío a medias queda unknown (no se reenvía)';

  -- 5. Seguridad: RLS sin políticas; anon/authenticated sin EXECUTE.
  if not (select relrowsecurity from pg_class where relname = 'dulabs_ba_reminders') then raise exception 'FAIL 5 RLS'; end if;
  if exists (select 1 from pg_policies where tablename = 'dulabs_ba_reminders') then raise exception 'FAIL 5 políticas'; end if;
  if has_function_privilege('anon', 'public.dulabs_ba_reminder_claim_due(integer, integer)', 'execute') then raise exception 'FAIL 5 anon ejecuta'; end if;
  if has_function_privilege('authenticated', 'public.dulabs_ba_reminder_schedule(uuid, text, text, text, text, text, timestamptz, text, timestamptz, text, text, text)', 'execute') then raise exception 'FAIL 5 authenticated ejecuta'; end if;
  raise notice 'PASS 5 RLS sin políticas; funciones solo para service_role';
end;
$$;
