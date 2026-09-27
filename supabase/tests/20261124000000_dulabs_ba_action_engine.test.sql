-- Business Agent 2.0, FASE 4 — verificación de 20261124000000_dulabs_ba_action_engine.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO. Ver scripts/verify-ba-action-engine.sh (prepara roles, la función
-- dulabs_flow_set_updated_at, aplica la migración dos veces, corre este archivo y la concurrencia real).

\set ON_ERROR_STOP 1

do $$
declare
  t1 constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  t2 constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  k1 constant text := repeat('a', 32);
  k2 constant text := repeat('b', 32);
  k3 constant text := repeat('c', 32);
  h1 constant text := repeat('1', 64);
  h2 constant text := repeat('2', 64);
  c record;
  ok boolean;
begin
  -- 1. Primer claim gana; el segundo con la misma clave ve la ejecución en curso.
  select * into c from dulabs_ba_action_claim(t1, 'flow-1', 'pn:573', 'crear_cita_nylas_generico', '1.0.0', k1, h1, 30, false);
  if c.outcome <> 'claimed' or c.attempt <> 1 then raise exception 'FAIL 1 primer claim %', c.outcome; end if;
  select * into c from dulabs_ba_action_claim(t1, 'flow-1', 'pn:573', 'crear_cita_nylas_generico', '1.0.0', k1, h1, 30, false);
  if c.outcome <> 'in_progress' then raise exception 'FAIL 1 segundo claim %', c.outcome; end if;
  raise notice 'PASS 1 una sola ejecución por (tenant, clave); la segunda ve in_progress';

  -- 2. Completar con fencing: attempt equivocado no escribe; el correcto sí; luego replay devuelve el resultado.
  select dulabs_ba_action_complete(t1, c.execution_id, 2, 'SUCCEEDED', '{"x":1}', null, false) into ok;
  if ok then raise exception 'FAIL 2 attempt equivocado escribió'; end if;
  select dulabs_ba_action_complete(t2, c.execution_id, 1, 'SUCCEEDED', '{"x":1}', null, false) into ok;
  if ok then raise exception 'FAIL 2 otro tenant completó la ejecución'; end if;
  select dulabs_ba_action_complete(t1, c.execution_id, 1, 'SUCCEEDED', '{"x":1}', null, false) into ok;
  if not ok then raise exception 'FAIL 2 complete correcto no escribió'; end if;
  select * into c from dulabs_ba_action_claim(t1, 'flow-1', 'pn:573', 'crear_cita_nylas_generico', '1.0.0', k1, h1, 30, false);
  if c.outcome <> 'completed' or c.result->>'x' <> '1' then raise exception 'FAIL 2 replay %', c.outcome; end if;
  select dulabs_ba_action_complete(t1, c.execution_id, 1, 'FAILED', '{}', 'X', false) into ok;
  if ok then raise exception 'FAIL 2 se pisó un resultado final'; end if;
  raise notice 'PASS 2 fencing por attempt y tenant; replay devuelve el resultado guardado sin ejecutar';

  -- 3. Misma clave con otros argumentos u otro tenant.
  select * into c from dulabs_ba_action_claim(t1, 'flow-1', 'pn:573', 'crear_cita_nylas_generico', '1.0.0', k1, h2, 30, false);
  if c.outcome <> 'mismatch' then raise exception 'FAIL 3 mismatch %', c.outcome; end if;
  select * into c from dulabs_ba_action_claim(t2, 'flow-1', 'pn:573', 'crear_cita_nylas_generico', '1.0.0', k1, h1, 30, false);
  if c.outcome <> 'claimed' then raise exception 'FAIL 3 la clave de otro tenant no es independiente %', c.outcome; end if;
  raise notice 'PASS 3 argumentos distintos = mismatch; la clave es por tenant';

  -- 4. Lease vencido: una escritura NO se re-ejecuta (desenlace desconocido); una lectura se retoma.
  select * into c from dulabs_ba_action_claim(t1, 'flow-1', 'pn:573', 'crear_cita_nylas_generico', '1.0.0', k2, h1, 30, false);
  update dulabs_ba_action_executions set lease_until = now() - interval '1 second' where id = c.execution_id;
  select * into c from dulabs_ba_action_claim(t1, 'flow-1', 'pn:573', 'crear_cita_nylas_generico', '1.0.0', k2, h1, 30, false);
  if c.outcome <> 'unknown' or c.status <> 'TIMED_OUT' then raise exception 'FAIL 4 escritura retomada: % %', c.outcome, c.status; end if;
  select * into c from dulabs_ba_action_claim(t1, 'flow-1', 'pn:573', 'crear_cita_nylas_generico', '1.0.0', k2, h1, 30, false);
  if c.outcome <> 'unknown' then raise exception 'FAIL 4 escritura desconocida re-ejecutable %', c.outcome; end if;
  select * into c from dulabs_ba_action_claim(t1, 'flow-1', 'pn:573', 'buscar_disponibilidad_nylas_generico', '1.0.0', k3, h1, 30, true);
  update dulabs_ba_action_executions set lease_until = now() - interval '1 second' where id = c.execution_id;
  select * into c from dulabs_ba_action_claim(t1, 'flow-1', 'pn:573', 'buscar_disponibilidad_nylas_generico', '1.0.0', k3, h1, 30, true);
  if c.outcome <> 'claimed' or c.attempt <> 2 then raise exception 'FAIL 4 lectura no retomada % %', c.outcome, c.attempt; end if;
  raise notice 'PASS 4 lease vencido: escritura = OUTCOME_UNKNOWN (no se re-ejecuta); lectura se retoma (attempt 2)';

  -- 5. Fallo reintentable: lectura se retoma; escritura no.
  select dulabs_ba_action_complete(t1, c.execution_id, 2, 'FAILED', '{}', 'EXTERNAL_ERROR', true) into ok;
  select * into c from dulabs_ba_action_claim(t1, 'flow-1', 'pn:573', 'buscar_disponibilidad_nylas_generico', '1.0.0', k3, h1, 30, true);
  if c.outcome <> 'claimed' or c.attempt <> 3 then raise exception 'FAIL 5 lectura reintentable % %', c.outcome, c.attempt; end if;
  raise notice 'PASS 5 fallo reintentable de una lectura se retoma';

  -- 6. Identidad inmutable y datos validados.
  begin
    update dulabs_ba_action_executions set id_tenant = t2 where id = c.execution_id;
    raise exception 'FAIL 6 cambio de tenant aceptado';
  exception when check_violation then null;
  end;
  begin
    perform dulabs_ba_action_claim(t1, 'flow-1', 'pn:573', 'crear cita; drop', '1.0.0', repeat('d', 32), h1, 30, false);
    raise exception 'FAIL 6 acción con caracteres inválidos aceptada';
  exception when check_violation then null;
  end;
  begin
    perform dulabs_ba_action_claim(t1, 'flow-1', 'pn:573', 'x', '1.0.0', 'no-hex', h1, 30, false);
    raise exception 'FAIL 6 clave inválida aceptada';
  exception when check_violation then null;
  end;
  begin
    perform dulabs_ba_action_complete(t1, c.execution_id, 3, 'RUNNING', '{}', null, false);
    raise exception 'FAIL 6 estado final inválido aceptado';
  exception when check_violation then null;
  end;
  raise notice 'PASS 6 identidad inmutable y entradas validadas por la base';

  -- 7. Candado de reserva: uno a la vez; otro holder espera; vencido se puede tomar; solo el holder libera.
  if not dulabs_ba_booking_lock_acquire(t1, 'booking:2026-09-27', 'A', 30) then raise exception 'FAIL 7 A no tomó'; end if;
  if dulabs_ba_booking_lock_acquire(t1, 'booking:2026-09-27', 'B', 30) then raise exception 'FAIL 7 B tomó un candado vigente'; end if;
  if not dulabs_ba_booking_lock_acquire(t2, 'booking:2026-09-27', 'B', 30) then raise exception 'FAIL 7 candado no es por tenant'; end if;
  if dulabs_ba_booking_lock_release(t1, 'booking:2026-09-27', 'B') then raise exception 'FAIL 7 B liberó el candado de A'; end if;
  update dulabs_ba_booking_locks set lease_until = now() - interval '1 second' where id_tenant = t1;
  if not dulabs_ba_booking_lock_acquire(t1, 'booking:2026-09-27', 'B', 30) then raise exception 'FAIL 7 candado vencido no se pudo tomar'; end if;
  if not dulabs_ba_booking_lock_release(t1, 'booking:2026-09-27', 'B') then raise exception 'FAIL 7 holder no liberó'; end if;
  raise notice 'PASS 7 candado de reserva: exclusión, por tenant, lease y liberación solo del holder';
end;
$$;

-- 8. RLS y permisos: anon no ve filas ni puede ejecutar las funciones.
grant select on public.dulabs_ba_action_executions to anon;
set role anon;
do $$
declare n integer;
begin
  select count(*) into n from public.dulabs_ba_action_executions;
  if n <> 0 then raise exception 'FAIL 8 anon ve % ejecuciones', n; end if;
  begin
    perform public.dulabs_ba_action_claim('aaaaaaaa-0000-4000-8000-00000000000a', 'f', 'c', 'x', '1', repeat('e', 32), repeat('1', 64), 30, false);
    raise exception 'FAIL 8 anon ejecutó dulabs_ba_action_claim';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 8 RLS: anon no ve ejecuciones ni puede reclamar';
end;
$$;
reset role;
revoke select on public.dulabs_ba_action_executions from anon;
