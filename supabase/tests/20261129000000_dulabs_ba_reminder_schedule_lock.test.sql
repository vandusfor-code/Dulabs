-- Business Agent 2.0 — verificación de 20261129000000_dulabs_ba_reminder_schedule_lock.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO. La carrera real (sesiones en paralelo) la prueba
-- scripts/verify-ba-concurrency.sh (C3, 5 rondas × 10 sesiones); aquí: el contrato de la función no cambió.

\set ON_ERROR_STOP 1

do $$
declare
  t1 constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  cita timestamptz := now() + interval '3 hour';
  c record;
begin
  -- 1. La función lleva el candado por (tenant, conversación, cita).
  if (select prosrc from pg_proc where oid = 'public.dulabs_ba_reminder_schedule(uuid, text, text, text, text, text, timestamptz, text, timestamptz, text, text, text)'::regprocedure) not like '%pg_advisory_xact_lock%' then
    raise exception 'FAIL 1 sin candado';
  end if;
  raise notice 'PASS 1 dulabs_ba_reminder_schedule serializa por (tenant, conversación, cita)';

  -- 2. Contrato intacto: scheduled → unchanged → updated (otra operación, misma cita) → closed_* tras cancelar.
  select * into c from dulabs_ba_reminder_schedule(t1, 'f', 'pn:1', 'pn', '1', 'cita-1', cita, null, now() + interval '1 hour', 'America/Bogota', 'x', repeat('a', 32));
  if c.outcome <> 'scheduled' then raise exception 'FAIL 2 scheduled %', c.outcome; end if;
  select * into c from dulabs_ba_reminder_schedule(t1, 'f', 'pn:1', 'pn', '1', 'cita-1', cita, null, now() + interval '1 hour', 'America/Bogota', 'x', repeat('a', 32));
  if c.outcome <> 'unchanged' then raise exception 'FAIL 2 unchanged %', c.outcome; end if;
  select * into c from dulabs_ba_reminder_schedule(t1, 'f', 'pn:1', 'pn', '1', 'cita-1', cita, null, now() + interval '90 minute', 'America/Bogota', 'x', repeat('b', 32));
  if c.outcome <> 'updated' then raise exception 'FAIL 2 updated %', c.outcome; end if;
  perform dulabs_ba_reminder_cancel(t1, 'pn:1', null);
  -- La fila activa conserva la clave de la operación que la creó ('a'): repetir ESA operación tras cancelar = cerrada.
  select * into c from dulabs_ba_reminder_schedule(t1, 'f', 'pn:1', 'pn', '1', 'cita-1', cita, null, now() + interval '90 minute', 'America/Bogota', 'x', repeat('a', 32));
  if c.outcome <> 'closed_cancelled' then raise exception 'FAIL 2 closed %', c.outcome; end if;
  -- La firma de 13 argumentos (tono) sigue delegando en esta.
  select * into c from dulabs_ba_reminder_schedule(t1, 'f', 'pn:2', 'pn', '2', 'cita-2', cita, null, now() + interval '1 hour', 'America/Bogota', 'x', repeat('c', 32), 'formal');
  if c.outcome <> 'scheduled' or (select tone from dulabs_ba_reminders where id = c.reminder_id) <> 'formal' then raise exception 'FAIL 2 tono'; end if;
  raise notice 'PASS 2 contrato intacto: scheduled / unchanged / updated / closed_* y la firma con tono';

  -- 3. Permisos.
  if has_function_privilege('anon', 'public.dulabs_ba_reminder_schedule(uuid, text, text, text, text, text, timestamptz, text, timestamptz, text, text, text)', 'execute')
     or not has_function_privilege('service_role', 'public.dulabs_ba_reminder_schedule(uuid, text, text, text, text, text, timestamptz, text, timestamptz, text, text, text)', 'execute') then
    raise exception 'FAIL 3 permisos';
  end if;
  raise notice 'PASS 3 permisos solo para service_role';
end;
$$;
