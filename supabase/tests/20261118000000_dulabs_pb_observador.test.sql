-- Publi Bordados, Fase 2A — verificación de 20261118000000_dulabs_pb_observador.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba; ids SINTÉTICOS).
-- Preparación: roles service_role/anon/authenticated y:
--   \i supabase/migrations/20261118000000_dulabs_pb_observador.sql   (dos veces: idempotente)
--   \i supabase/tests/20261118000000_dulabs_pb_observador.test.sql

\set ON_ERROR_STOP 1

do $$
declare
  t constant uuid := '11111111-1111-4111-8111-111111111111';
  otro constant uuid := '22222222-2222-4222-8222-222222222222';
  fila jsonb;
  r record;
  n integer;
begin
  delete from dulabs_pb_observaciones where phone_number_id like 'pid-sintetico-%';
  delete from dulabs_pb_config where phone_number_id like 'pid-sintetico-%';

  -- 1. Clave de conversación: mismo vector que lib/publibordados/observador/observador.test.ts.
  if dulabs_pb_clave_conversacion(t, 'pid-sintetico-pb', '570000000099') <> '3095d80adc5e2d06be0fcd76d12ea84f65e310518d5fc1375ba079999b6cde07' then
    raise exception 'FAIL 1: la clave SQL no coincide con la de TypeScript';
  end if;
  if dulabs_pb_clave_conversacion(t, 'pid-sintetico-pb', '+57 000 000 0099') <> dulabs_pb_clave_conversacion(t, 'pid-sintetico-pb', '570000000099') then
    raise exception 'FAIL 1b: la clave debe normalizar a dígitos';
  end if;

  -- 2. Sin config habilitada no se inserta nada.
  fila := jsonb_build_object('id_tenant', t, 'phone_number_id', 'pid-sintetico-pb', 'clave', 'msg:wamid.A1',
    'event_type', 'CLIENT_MESSAGE', 'direction', 'entrante', 'remitente', 'cliente', 'destinatario', 'negocio',
    'source', 'messages', 'array_key', 'messages', 'received_at', '2026-09-24T12:00:05Z', 'event_timestamp', '2026-09-24T12:00:00Z',
    'latencia_ms', 5000, 'metadata', jsonb_build_object('tipo', 'text'));
  select count(*) into n from dulabs_pb_observar(jsonb_build_array(fila));
  if n <> 0 then raise exception 'FAIL 2: insertó sin config'; end if;

  insert into dulabs_pb_config (phone_number_id, id_tenant, enabled) values ('pid-sintetico-pb', t, false);
  select count(*) into n from dulabs_pb_observar(jsonb_build_array(fila));
  if n <> 0 then raise exception 'FAIL 2b: insertó con enabled = false'; end if;

  -- 3. Con config habilitada: inserta; la reentrega suma entregas (sin otra fila).
  update dulabs_pb_config set enabled = true where phone_number_id = 'pid-sintetico-pb';
  select * into r from dulabs_pb_observar(jsonb_build_array(fila));
  if not r.nueva then raise exception 'FAIL 3: la primera debía ser nueva'; end if;
  select * into r from dulabs_pb_observar(jsonb_build_array(fila || jsonb_build_object('received_at', '2026-09-24T12:00:09Z')));
  if r.nueva then raise exception 'FAIL 3b: la reentrega no debía ser nueva'; end if;
  select count(*) into n from dulabs_pb_observaciones where phone_number_id = 'pid-sintetico-pb';
  perform 1 from dulabs_pb_observaciones where phone_number_id = 'pid-sintetico-pb' and entregas = 2
     and ultima_recepcion_at = '2026-09-24T12:00:09Z' and received_at = '2026-09-24T12:00:05Z';
  if n <> 1 or not found then raise exception 'FAIL 3c: se esperaba 1 fila con entregas = 2'; end if;

  -- 4. Otro tenant para el mismo número: rechazado (identidad en la BD).
  select count(*) into n from dulabs_pb_observar(jsonb_build_array(fila || jsonb_build_object('id_tenant', otro, 'clave', 'msg:wamid.A2')));
  if n <> 0 then raise exception 'FAIL 4: aceptó una fila de otro tenant'; end if;

  -- 5. Lote mixto: solo entra lo del número habilitado.
  select count(*) into n from dulabs_pb_observar(jsonb_build_array(
    fila || jsonb_build_object('clave', 'echo:wamid.E1', 'event_type', 'HUMAN_MESSAGE_ECHO', 'classification', 'HUMAN', 'direction', 'saliente', 'remitente', 'negocio', 'destinatario', 'cliente'),
    fila || jsonb_build_object('phone_number_id', 'pid-sintetico-otro', 'clave', 'msg:wamid.B1')));
  if n <> 1 then raise exception 'FAIL 5: lote mixto (%)', n; end if;

  -- 6. Checks: event_type fuera de la lista y metadata no-objeto son rechazados.
  begin
    perform dulabs_pb_observar(jsonb_build_array(fila || jsonb_build_object('clave', 'msg:wamid.X', 'event_type', 'RESPONDER')));
    raise exception 'FAIL 6: aceptó un event_type inválido';
  exception when check_violation then null;
  end;
  begin
    perform dulabs_pb_observar(jsonb_build_array(fila || jsonb_build_object('clave', 'msg:wamid.Y', 'metadata', '[1]'::jsonb)));
    raise exception 'FAIL 6b: aceptó metadata que no es objeto';
  exception when check_violation then null;
  end;

  -- 7. Fase 2A: shadow_mode es obligatorio.
  begin
    insert into dulabs_pb_config (phone_number_id, id_tenant, enabled, shadow_mode) values ('pid-sintetico-activo', t, true, false);
    raise exception 'FAIL 7: aceptó shadow_mode = false';
  exception when check_violation then null;
  end;

  -- 8. Purga: no borra lo reciente.
  if dulabs_pb_observaciones_purgar(30) <> 0 then raise exception 'FAIL 8: borró filas recientes'; end if;

  -- 9. Permisos: anon/authenticated no leen las tablas ni ejecutan las funciones.
  if has_table_privilege('anon', 'public.dulabs_pb_observaciones', 'select')
     or has_table_privilege('authenticated', 'public.dulabs_pb_config', 'select')
     or has_function_privilege('anon', 'public.dulabs_pb_observar(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_pb_observar(jsonb)', 'execute') then
    raise exception 'FAIL 9: permisos abiertos a anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.dulabs_pb_observar(jsonb)', 'execute') then
    raise exception 'FAIL 9b: service_role no puede ejecutar la RPC';
  end if;

  delete from dulabs_pb_observaciones where phone_number_id like 'pid-sintetico-%';
  delete from dulabs_pb_config where phone_number_id like 'pid-sintetico-%';
  raise notice 'OK dulabs_pb_observador: 9 bloques';
end $$;
