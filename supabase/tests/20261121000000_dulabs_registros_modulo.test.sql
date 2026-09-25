-- Registros de módulo (respaldo/conciliación genérico) — verificación de 20261121000000_dulabs_registros_modulo.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas; tenants y números SINTÉTICOS).
-- Orden:
--   \i supabase/tests/20261120000000_dulabs_pb_solicitudes.prelude.sql   (tablas compartidas reales)
--   \i supabase/migrations/20261121000000_dulabs_registros_modulo.sql      (dos veces: idempotente)
--   \i supabase/tests/20261121000000_dulabs_registros_modulo.test.sql

\set ON_ERROR_STOP 1

do $$
declare
  t constant uuid := 'dddddddd-0000-4000-8000-000000000001';
  otro constant uuid := 'eeeeeeee-0000-4000-8000-000000000002';
  pn constant text := 'pid-sint-reg';
  pn_otro constant text := 'pid-sint-reg-otro';
  tel constant text := '573100000001';
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); e3 uuid := gen_random_uuid();
  campos constant jsonb := '{"nombre":"nombre","cantidad":"cantidad"}';
  j jsonb; id1 bigint; id2 bigint; n integer;
begin
  delete from dulabs_registros_modulo where tenant_id in (t, otro);
  delete from dulabs_flow_executions where tenant_id in (t, otro);
  delete from dulabs_clientes_config where id_tenant in (t, otro);
  insert into dulabs_clientes_config (id_tenant, phone_number_id) values (t, pn), (otro, pn_otro);
  insert into dulabs_flow_executions (tenant_id, id, flow_id, flow_version_id, execution_id, phone_number_id, telefono_cliente, status, variables)
  values (t, e1, gen_random_uuid(), gen_random_uuid(), 'r1', pn, tel, 'completed', '{"nombre":"Ana","cantidad":"20"}'),
         (t, e2, gen_random_uuid(), gen_random_uuid(), 'r2', pn, tel, 'completed', '{"nombre":"Luis"}'),
         (otro, e3, gen_random_uuid(), gen_random_uuid(), 'r3', pn_otro, tel, 'completed', '{}');

  -- 1. abrir crea UNA fila por (tenant, módulo, ejecución); abrir otra vez devuelve la misma.
  j := dulabs_registro_modulo_abrir(t, 'mod_prueba', e1, pn, tel, 'act', campos, 0);
  id1 := (j->>'id')::bigint;
  assert j->>'estado' = 'pendiente', '1: nace pendiente';
  j := dulabs_registro_modulo_abrir(t, 'mod_prueba', e1, pn, tel, 'act', campos, 0);
  assert (j->>'id')::bigint = id1, '1: idempotente';
  assert (select count(*) from dulabs_registros_modulo where tenant_id = t) = 1, '1: una sola fila';

  -- 2. abrir rechaza número ajeno y ejecución inexistente o de otra conversación.
  begin
    perform dulabs_registro_modulo_abrir(t, 'mod_prueba', e3, pn_otro, tel, 'act', campos, 0);
    raise exception '2a: debía rechazar número ajeno';
  exception when others then assert sqlerrm = 'registro_numero_ajeno', '2a: ' || sqlerrm; end;
  begin
    perform dulabs_registro_modulo_abrir(t, 'mod_prueba', gen_random_uuid(), pn, tel, 'act', campos, 0);
    raise exception '2b: debía rechazar ejecución inexistente';
  exception when others then assert sqlerrm = 'registro_ejecucion_inexistente', '2b: ' || sqlerrm; end;
  begin
    perform dulabs_registro_modulo_abrir(t, 'mod_prueba', e1, pn, '573199999999', 'act', campos, 0);
    raise exception '2c: debía rechazar otra conversación';
  exception when others then assert sqlerrm = 'registro_ejecucion_inexistente', '2c: ' || sqlerrm; end;

  -- 3. reclamar devuelve las variables de la ejecución ORIGINAL y pone lease; un segundo reclamo no la toma.
  j := dulabs_registro_modulo_reclamar(10, t, 60);
  assert jsonb_array_length(j) = 1, '3: una fila';
  assert j->0->'variables'->>'nombre' = 'Ana', '3: variables de la ejecución';
  assert jsonb_array_length(dulabs_registro_modulo_reclamar(10, t, 60)) = 0, '3: con lease no se vuelve a tomar';

  -- 4. resolver pendiente → reintento con espera; no cambia terminales.
  j := dulabs_registro_modulo_resolver(t, id1, 'pendiente', null, 'error_bd', 600);
  assert (j->>'actualizado')::boolean and (j->>'intentos')::int = 1, '4: ronda contada';
  assert (select proximo_intento_at > now() + interval '9 minutes' and lease_hasta is null from dulabs_registros_modulo where id = id1), '4: espera y sin lease';
  assert jsonb_array_length(dulabs_registro_modulo_reclamar(10, t, 60)) = 0, '4: no vence todavía';
  j := dulabs_registro_modulo_resolver(t, id1, 'registrado', '55', null, null);
  assert (select estado = 'registrado' and registro_id = '55' and resuelto_at is not null from dulabs_registros_modulo where id = id1), '4: registrado';
  j := dulabs_registro_modulo_resolver(t, id1, 'fallido', null, 'x', null);
  assert not (j->>'actualizado')::boolean, '4: un terminal no se pisa';

  -- 5. Aislamiento: otro tenant no resuelve, reencola ni ve filas ajenas.
  j := dulabs_registro_modulo_abrir(t, 'mod_prueba', e2, pn, tel, 'act', campos, 0);
  id2 := (j->>'id')::bigint;
  assert not (dulabs_registro_modulo_resolver(otro, id2, 'registrado', '1', null, null)->>'actualizado')::boolean, '5a: resolver ajeno';
  assert jsonb_array_length(dulabs_registro_modulo_reclamar(10, otro, 60)) = 0, '5b: reclamar solo del tenant';
  assert (dulabs_registro_modulo_resumen(otro, 'mod_prueba')->>'pendientes')::int = 0, '5c: resumen ajeno vacío';
  perform dulabs_registro_modulo_resolver(t, id2, 'fallido', null, 'datos_invalidos', null);
  assert not (dulabs_registro_modulo_reencolar(otro, id2)->>'reencolado')::boolean, '5d: reencolar ajeno';

  -- 6. Resumen visible y reencolar un fallido.
  j := dulabs_registro_modulo_resumen(t, 'mod_prueba');
  assert (j->>'pendientes')::int = 0 and (j->>'fallidos')::int = 1, '6: ' || j::text;
  assert j->'filas'->0->>'ultimoError' = 'datos_invalidos', '6: motivo visible';
  assert (dulabs_registro_modulo_reencolar(t, id2)->>'reencolado')::boolean, '6: reencolado';
  assert (dulabs_registro_modulo_resumen(t, 'mod_prueba')->>'pendientes')::int = 1, '6: vuelve a pendiente';

  -- 7. Constraints: estado y módulo válidos.
  begin
    perform dulabs_registro_modulo_resolver(t, id2, 'otro', null, null, null);
    raise exception '7a';
  exception when others then assert sqlerrm = 'registro_estado_invalido', '7a: ' || sqlerrm; end;
  begin
    perform dulabs_registro_modulo_abrir(t, 'Módulo Malo', e1, pn, tel, 'act', campos, 0);
    raise exception '7b';
  exception when check_violation then null; end;

  -- 8. Permisos: solo service_role.
  select count(*) into n from information_schema.routine_privileges
   where routine_name like 'dulabs_registro_modulo_%' and grantee in ('anon', 'authenticated', 'PUBLIC');
  assert n = 0, '8: sin EXECUTE para anon/authenticated/PUBLIC';
  assert not has_table_privilege('anon', 'public.dulabs_registros_modulo', 'select'), '8: tabla cerrada a anon';
  assert not has_table_privilege('authenticated', 'public.dulabs_registros_modulo', 'select'), '8: tabla cerrada a authenticated';
  assert (select relrowsecurity from pg_class where relname = 'dulabs_registros_modulo'), '8: RLS activo';

  raise notice 'OK — dulabs_registros_modulo: todas las verificaciones pasaron';
end $$;
