-- Business Agent 2.0, FASE 9 — verificación de 20261128000000_dulabs_ba_production_hardening.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO. Ver scripts/verify-ba-migration-chain.sh.

\set ON_ERROR_STOP 1

do $$
declare
  t1 constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  t2 constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  cita timestamptz := now() + interval '3 hour';
  c record;
  rid uuid;
  att integer;
  s text;
  n integer;
  ok boolean;
begin
  -- 1. Reprogramar un recordatorio YA tomado por el despachador: begin_send NO envía; vuelve a 'scheduled' con la hora nueva.
  select * into c from dulabs_ba_reminder_schedule(t1, 'f', 'pn:1', 'pn', '1', 'cita-1', cita, 'Corte', now() + interval '30 minute', 'America/Bogota', 'x', repeat('a', 32), 'formal');
  rid := c.reminder_id;
  if (select tone from dulabs_ba_reminders where id = rid) <> 'formal' then raise exception 'FAIL 1 tono'; end if;
  update dulabs_ba_reminders set remind_at = now() - interval '1 second' where id = rid;
  select attempts into att from dulabs_ba_reminder_claim_due(10, 30) where id = rid;
  if att is null then raise exception 'FAIL 1 claim'; end if;
  select dulabs_ba_reminder_reschedule(t1, 'pn:1', 'cita-1', cita + interval '1 day', 60) into n;
  if n <> 1 then raise exception 'FAIL 1 reschedule %', n; end if;
  select dulabs_ba_reminder_begin_send(t1, rid, att) into s;
  if s <> 'rescheduled' then raise exception 'FAIL 1 begin_send %', s; end if;
  if (select status from dulabs_ba_reminders where id = rid) <> 'scheduled' or (select appointment_start from dulabs_ba_reminders where id = rid) <> cita + interval '1 day' then raise exception 'FAIL 1 estado tras reprogramar'; end if;
  raise notice 'PASS 1 reprogramar durante el envío: el recordatorio de la hora vieja NO se envía; queda para la hora nueva';

  -- 2. Cancelar un recordatorio ya tomado: begin_send lo cierra como cancelado.
  update dulabs_ba_reminders set remind_at = now() - interval '1 second' where id = rid;
  select attempts into att from dulabs_ba_reminder_claim_due(10, 30) where id = rid;
  select dulabs_ba_reminder_cancel(t2, 'pn:1', null) into n;
  if n <> 0 then raise exception 'FAIL 2 otro tenant canceló'; end if;
  select dulabs_ba_reminder_cancel(t1, 'pn:1', null) into n;
  select dulabs_ba_reminder_begin_send(t1, rid, att) into s;
  if s <> 'cancelled' or (select status from dulabs_ba_reminders where id = rid) <> 'cancelled' then raise exception 'FAIL 2 %', s; end if;
  select dulabs_ba_reminder_begin_send(t1, rid, att) into s;
  if s <> 'lost' then raise exception 'FAIL 2 segunda llamada %', s; end if;
  raise notice 'PASS 2 cancelar durante el envío: no se envía; un begin_send tardío devuelve lost';

  -- 3. Reprogramar a un momento que ya pasó: el recordatorio viejo se cancela (nunca se dispara a la hora vieja).
  select * into c from dulabs_ba_reminder_schedule(t1, 'f', 'pn:3', 'pn', '3', 'cita-3', cita, null, now() + interval '30 minute', 'America/Bogota', 'x', repeat('c', 32), 'cercano');
  select dulabs_ba_reminder_reschedule(t1, 'pn:3', 'cita-3', now() + interval '10 minute', 60) into n;
  if (select status from dulabs_ba_reminders where id = c.reminder_id) <> 'cancelled' then raise exception 'FAIL 3'; end if;
  raise notice 'PASS 3 reprogramar a un momento pasado cancela el recordatorio';

  -- 4. Desenlace desconocido: queda 'unknown' con verificación pendiente; encontrado → 'sent'; no encontrado → sigue unknown.
  select * into c from dulabs_ba_reminder_schedule(t1, 'f', 'pn:4', 'pn', '4', 'cita-4', cita, null, now() + interval '30 minute', 'America/Bogota', 'x', repeat('d', 32), 'cercano');
  update dulabs_ba_reminders set remind_at = now() - interval '1 second' where id = c.reminder_id;
  select attempts into att from dulabs_ba_reminder_claim_due(10, 30) where id = c.reminder_id;
  select dulabs_ba_reminder_complete(t1, c.reminder_id, att, 'unknown', 'SEND_OUTCOME_UNKNOWN', null) into ok;
  if (select verification from dulabs_ba_reminders where id = c.reminder_id) <> 'pending' then raise exception 'FAIL 4 pending'; end if;
  select count(*) into n from dulabs_ba_reminder_unverified(10);
  if n <> 1 then raise exception 'FAIL 4 unverified %', n; end if;
  begin
    update dulabs_ba_reminders set status = 'scheduled' where id = c.reminder_id;
    raise exception 'FAIL 4 un unknown volvió a scheduled';
  exception when check_violation then null;
  end;
  select dulabs_ba_reminder_resolve_unknown(t1, c.reminder_id, false) into ok;
  if (select status || '/' || verification from dulabs_ba_reminders where id = c.reminder_id) <> 'unknown/not_found' then raise exception 'FAIL 4 not_found'; end if;
  select dulabs_ba_reminder_resolve_unknown(t1, c.reminder_id, true) into ok;
  if (select status || '/' || verification from dulabs_ba_reminders where id = c.reminder_id) <> 'sent/verified_sent' then raise exception 'FAIL 4 found'; end if;
  raise notice 'PASS 4 desenlace desconocido: se verifica; nunca vuelve a programarse (no hay reenvío ciego)';

  -- 5. Límite de uso: atómico por ventana; el 4.º golpe con límite 3 se rechaza; otra clave es independiente.
  for i in 1..3 loop
    select * into c from dulabs_ba_rate_limit_hit('contact', 't1:abc', 60, 3);
    if not c.allowed then raise exception 'FAIL 5 golpe % rechazado', i; end if;
  end loop;
  select * into c from dulabs_ba_rate_limit_hit('contact', 't1:abc', 60, 3);
  if c.allowed or c.hits <> 4 then raise exception 'FAIL 5 cuarto golpe'; end if;
  select * into c from dulabs_ba_rate_limit_hit('contact', 't2:abc', 60, 3);
  if not c.allowed then raise exception 'FAIL 5 otra clave'; end if;
  raise notice 'PASS 5 límites de uso atómicos por (ámbito, clave, ventana)';

  -- 6. Uso por tenant y día: acumulación atómica; valores negativos rechazados.
  perform dulabs_ba_usage_record(t1, current_date, 1, 1, 100, 20, 18, 1, 0, 0, 350);
  perform dulabs_ba_usage_record(t1, current_date, 1, 2, 200, 40, 36, 0, 1, 1, 650);
  select turns + ai_calls + input_tokens + actions + action_errors + turn_errors into n from dulabs_ba_usage_daily where id_tenant = t1 and day = current_date;
  if n <> 2 + 3 + 300 + 1 + 1 + 1 then raise exception 'FAIL 6 acumulado %', n; end if;
  begin
    perform dulabs_ba_usage_record(t1, current_date, -1, 0, 0, 0, 0, 0, 0, 0, 0);
    raise exception 'FAIL 6 negativo aceptado';
  exception when check_violation then null;
  end;
  raise notice 'PASS 6 uso por tenant y día acumulado atómicamente';

  -- 7. Incidentes: código y referencia validados; misma (tenant, ref, código) no se duplica.
  insert into dulabs_ba_incidents (id_tenant, ref, correlation_id, code, error_class, dependency) values (t1, 'AB12CD34', 'corr-00000001', 'BA-INTEGRATION-PROVIDER_ERROR', 'INTEGRATION', 'calendar');
  begin
    insert into dulabs_ba_incidents (id_tenant, ref, correlation_id, code, error_class) values (t1, 'AB12CD34', 'corr-00000001', 'BA-INTEGRATION-PROVIDER_ERROR', 'INTEGRATION');
    raise exception 'FAIL 7 duplicado';
  exception when unique_violation then null;
  end;
  begin
    insert into dulabs_ba_incidents (id_tenant, ref, correlation_id, code, error_class) values (t1, 'x', 'corr-00000001', 'stack trace…', 'SYSTEM');
    raise exception 'FAIL 7 formato';
  exception when check_violation then null;
  end;
  raise notice 'PASS 7 incidentes con referencia de soporte (sin duplicados, formato estable)';

  -- 8. Latidos y seguridad.
  perform dulabs_ba_job_heartbeat('reminders_dispatch', true, '{"sent":1}');
  if not (select last_ok from dulabs_ba_job_runs where job = 'reminders_dispatch') then raise exception 'FAIL 8 heartbeat'; end if;
  if exists (select 1 from pg_class where relname in ('dulabs_ba_rate_counters', 'dulabs_ba_usage_daily', 'dulabs_ba_incidents', 'dulabs_ba_job_runs') and not relrowsecurity) then raise exception 'FAIL 8 RLS'; end if;
  if has_function_privilege('anon', 'public.dulabs_ba_rate_limit_hit(text, text, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_ba_reminder_begin_send(uuid, uuid, integer)', 'execute') then raise exception 'FAIL 8 permisos'; end if;
  raise notice 'PASS 8 latido de jobs; RLS y permisos solo para service_role';

  -- 9. Rollback seguro (funciones de 20261125): v1 → v2 → volver a v1 sin borrar historia; v2 sigue disponible.
  select * into c from dulabs_ba_publish_business_model(t1, 'rb', 0, '{"schemaVersion":"business-agent.business-model/1.0.0"}', repeat('c', 64),
    jsonb_build_object('artifactSchema', 'business-agent.artifact/1.0.0', 'compilerVersion', '5.0.0', 'source', 'business_model', 'tenantId', t1::text, 'agentId', 'rb',
      'version', jsonb_build_object('ref', 'ubm-v1', 'publishedVersion', 1), 'checksum', repeat('a', 64), 'executionFingerprint', repeat('b', 32)), repeat('a', 64), repeat('b', 32));
  select * into c from dulabs_ba_publish_business_model(t1, 'rb', 1, '{"schemaVersion":"business-agent.business-model/1.0.0"}', repeat('d', 64),
    jsonb_build_object('artifactSchema', 'business-agent.artifact/1.0.0', 'compilerVersion', '5.0.0', 'source', 'business_model', 'tenantId', t1::text, 'agentId', 'rb',
      'version', jsonb_build_object('ref', 'ubm-v2', 'publishedVersion', 2), 'checksum', repeat('e', 64), 'executionFingerprint', repeat('f', 32)), repeat('e', 64), repeat('f', 32));
  if c.outcome <> 'published' or c.published_version <> 2 then raise exception 'FAIL 9 publicar v2'; end if;
  if not dulabs_ba_activate_business_model_version(t1, 'rb', 1) then raise exception 'FAIL 9 rollback'; end if;
  if (select published_version from dulabs_ba_active_business_artifact(t1, 'rb')) <> 1 then raise exception 'FAIL 9 activa'; end if;
  if (select count(*) from dulabs_ba_business_models where id_tenant = t1 and agent_id = 'rb') <> 2
     or (select count(*) from dulabs_ba_agent_artifacts where id_tenant = t1 and agent_id = 'rb') <> 2 then raise exception 'FAIL 9 historia'; end if;
  if dulabs_ba_latest_model_version(t1, 'rb') <> 2 then raise exception 'FAIL 9 última'; end if;
  begin
    delete from dulabs_ba_business_models where id_tenant = t1 and agent_id = 'rb' and version = 2;
    raise exception 'FAIL 9 se pudo borrar una versión';
  exception when check_violation then null;
  end;
  if dulabs_ba_activate_business_model_version(t2, 'rb', 2) then raise exception 'FAIL 9 otro tenant activó'; end if;
  if not dulabs_ba_activate_business_model_version(t1, 'rb', 2) then raise exception 'FAIL 9 volver a v2'; end if;
  if (select published_version from dulabs_ba_active_business_artifact(t1, 'rb')) <> 2 then raise exception 'FAIL 9 activa v2'; end if;
  raise notice 'PASS 9 rollback v2 → v1 → v2 sin borrar historia (versiones inmutables; otro tenant no puede activar)';
end;
$$;
