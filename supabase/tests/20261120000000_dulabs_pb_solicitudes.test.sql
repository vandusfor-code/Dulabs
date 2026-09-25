-- Publi Bordados — verificación de 20261120000000_dulabs_pb_solicitudes.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas; tenants y números SINTÉTICOS).
-- Orden:
--   \i supabase/tests/20261120000000_dulabs_pb_solicitudes.prelude.sql
--   \i supabase/migrations/20261120000000_dulabs_pb_solicitudes.sql   (dos veces: idempotente)
--   \i supabase/tests/20261120000000_dulabs_pb_solicitudes.test.sql

\set ON_ERROR_STOP 1

do $$
declare
  t constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  otro constant uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  pn constant text := 'pid-sint-pb';
  pn_otro constant text := 'pid-sint-otro';
  juan constant text := '573000000001';
  ana_cli constant text := '573000000002';
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); e3 uuid := gen_random_uuid();
  e4 uuid := gen_random_uuid(); e_otro uuid := gen_random_uuid(); e_vacio uuid := gen_random_uuid();
  asesora_ana bigint; asesor_carlos bigint; asesor_suspendido bigint; asesor_ajeno bigint;
  r record; j jsonb; n integer; s1 bigint; s2 bigint; s3 bigint; v integer;
begin
  -- Datos sintéticos (limpieza previa: el test es re-ejecutable).
  delete from dulabs_pb_solicitudes where id_tenant in (t, otro);
  delete from dulabs_clientes_conocidos where id_tenant in (t, otro);
  delete from dulabs_flow_executions where tenant_id in (t, otro);
  delete from dulabs_clientes_config where id_tenant in (t, otro);
  delete from dulabs_miembros_equipo where tenant_id in (t, otro);
  delete from dulabs_mensajes_log where phone_number_id in (pn, pn_otro);

  insert into dulabs_clientes_config (id_tenant, phone_number_id) values (t, pn), (otro, pn_otro);
  insert into dulabs_miembros_equipo (tenant_id, email, nombre, estado) values (t, 'ana@pb.test', 'Ana', 'activo') returning id into asesora_ana;
  insert into dulabs_miembros_equipo (tenant_id, email, nombre, estado) values (t, 'carlos@pb.test', 'Carlos', 'activo') returning id into asesor_carlos;
  insert into dulabs_miembros_equipo (tenant_id, email, nombre, estado) values (t, 'sus@pb.test', 'Suspendido', 'suspendido') returning id into asesor_suspendido;
  insert into dulabs_miembros_equipo (tenant_id, email, nombre, estado) values (otro, 'x@otro.test', 'Ajeno', 'activo') returning id into asesor_ajeno;

  -- Ejecuciones REALES del flow (lo que el orquestador deja antes de despachar la acción).
  insert into dulabs_flow_executions (tenant_id, id, flow_id, flow_version_id, execution_id, phone_number_id, telefono_cliente, status, current_node_id, metadata, created_at)
  values
    (t, e1, gen_random_uuid(), gen_random_uuid(), 'x1', pn, juan, 'waiting_effect', 'act-registrar-solicitud', '{"lastEventId":"wamid.JUAN1"}', now() - interval '3 days'),
    (t, e2, gen_random_uuid(), gen_random_uuid(), 'x2', pn, juan, 'waiting_effect', 'act-registrar-solicitud', '{"lastEventId":"wamid.JUAN2"}', now() - interval '2 days'),
    (t, e3, gen_random_uuid(), gen_random_uuid(), 'x3', pn, juan, 'waiting_effect', 'act-registrar-solicitud', '{}', now() - interval '1 day'),
    (t, e4, gen_random_uuid(), gen_random_uuid(), 'x4', pn, ana_cli, 'waiting_effect', 'act-registrar-solicitud', '{"lastEventId":"wamid.ANA1"}', now()),
    (t, e_vacio, gen_random_uuid(), gen_random_uuid(), 'x5', pn, ana_cli, 'waiting_effect', 'act-registrar-solicitud', '{}', now()),
    (otro, e_otro, gen_random_uuid(), gen_random_uuid(), 'y1', pn_otro, juan, 'waiting_effect', 'act-registrar-solicitud', '{}', now());

  -- 1. Cliente nuevo + solicitud nueva (persona natural): crea el contacto y la solicitud, con trazabilidad real.
  select * into r from dulabs_pb_registrar_solicitud(t, pn, juan, e1,
    '{"tipo_cliente":"persona_natural","nombre":"Juan Pérez","nombre_empresa":"","producto":"gorras","cantidad":"20"}');
  if not r.creada then raise exception 'FAIL 1: debía crear'; end if;
  s1 := r.solicitud_id;
  select count(*) into n from dulabs_clientes_conocidos where id_tenant = t and telefono_cliente = juan;
  if n <> 1 then raise exception 'FAIL 1b: debía existir 1 contacto, hay %', n; end if;
  select * into r from dulabs_pb_solicitudes where id = s1;
  if r.estado <> 'nuevo' or r.cantidad <> 20 or r.nombre_empresa is not null or r.evento_id <> 'wamid.JUAN1' or r.flow_execution_id <> e1 or r.version <> 1 then
    raise exception 'FAIL 1c: fila inesperada %', row_to_json(r);
  end if;

  -- 9/10/22. Idempotencia: la MISMA ejecución (reintento de Meta / efecto repetido) no crea otra solicitud.
  select * into r from dulabs_pb_registrar_solicitud(t, pn, juan, e1,
    '{"tipo_cliente":"persona_natural","nombre":"Juan Pérez","producto":"gorras","cantidad":"20"}');
  if r.creada or r.solicitud_id <> s1 then raise exception 'FAIL 9: reintento creó otra solicitud'; end if;
  select count(*) into n from dulabs_pb_solicitudes where id_tenant = t and flow_execution_id = e1;
  if n <> 1 then raise exception 'FAIL 9b: % solicitudes para una ejecución', n; end if;

  -- 2/3/19. Cliente existente: segunda y tercera solicitud (empresa) SIN crear otro cliente.
  select * into r from dulabs_pb_registrar_solicitud(t, pn, juan, e2,
    '{"tipo_cliente":"persona_natural","nombre":"Juan Pérez","producto":"uniformes","cantidad":"50"}');
  s2 := r.solicitud_id;
  select * into r from dulabs_pb_registrar_solicitud(t, pn, juan, e3,
    '{"tipo_cliente":"empresa","nombre":"Juan Pérez","nombre_empresa":"Textiles SAS","producto":"otros","cantidad":"06"}');
  s3 := r.solicitud_id;
  select count(*) into n from dulabs_clientes_conocidos where id_tenant = t and telefono_cliente = juan;
  if n <> 1 then raise exception 'FAIL 2: se duplicó el cliente (%)', n; end if;
  select count(*) into n from dulabs_pb_solicitudes where id_tenant = t and contacto_id = (select id from dulabs_clientes_conocidos where telefono_cliente = juan and id_tenant = t);
  if n <> 3 then raise exception 'FAIL 3: debía tener 3 solicitudes, tiene %', n; end if;
  if (select cantidad from dulabs_pb_solicitudes where id = s3) <> 6 then raise exception 'FAIL 3b: "06" debía guardarse como 6'; end if;
  if (select evento_id from dulabs_pb_solicitudes where id = s3) is not null then raise exception 'FAIL 3c: sin lastEventId no se inventa evento'; end if;

  -- 4/6. Dos clientes distintos; empresa exige nombre de empresa.
  select * into r from dulabs_pb_registrar_solicitud(t, pn, ana_cli, e4,
    '{"tipo_cliente":"empresa","nombre":"Ana Gómez","nombre_empresa":"Bordados Ana","producto":"prendas_de_vestir","cantidad":"12"}');
  if not r.creada then raise exception 'FAIL 4'; end if;
  select count(distinct contacto_id) into n from dulabs_pb_solicitudes where id_tenant = t;
  if n <> 2 then raise exception 'FAIL 4b: debían ser 2 clientes'; end if;

  -- 20. Datos incompletos o inválidos: se rechazan (nunca se guarda basura).
  begin
    perform dulabs_pb_registrar_solicitud(t, pn, ana_cli, e_vacio, '{"tipo_cliente":"empresa","nombre":"Ana","producto":"gorras","cantidad":"5"}');
    raise exception 'FAIL 20a: empresa sin nombre de empresa';
  exception when check_violation then null; end;
  begin
    perform dulabs_pb_registrar_solicitud(t, pn, ana_cli, e_vacio, '{"tipo_cliente":"persona_natural","nombre":"Ana","producto":"gorras","cantidad":"0"}');
    raise exception 'FAIL 20b: cantidad 0';
  exception when not_null_violation then null; end;
  begin
    perform dulabs_pb_registrar_solicitud(t, pn, ana_cli, e_vacio, '{"tipo_cliente":"persona_natural","nombre":"Ana","producto":"sombreros","cantidad":"5"}');
    raise exception 'FAIL 20c: producto desconocido';
  exception when check_violation then null; end;
  begin
    perform dulabs_pb_registrar_solicitud(t, pn, ana_cli, e_vacio, '{"tipo_cliente":"persona_natural","nombre":"","producto":"gorras","cantidad":"5"}');
    raise exception 'FAIL 20d: nombre vacío';
  exception when check_violation then null; end;
  if exists (select 1 from dulabs_pb_solicitudes where flow_execution_id = e_vacio) then raise exception 'FAIL 20e: quedó basura'; end if;

  -- 23. Trazabilidad: sin ejecución real no se registra nada.
  begin
    perform dulabs_pb_registrar_solicitud(t, pn, juan, gen_random_uuid(), '{"tipo_cliente":"persona_natural","nombre":"X","producto":"gorras","cantidad":"5"}');
    raise exception 'FAIL 23: registró con una ejecución inexistente';
  exception when others then if sqlerrm <> 'pb_ejecucion_inexistente' then raise; end if; end;
  -- ...ni con la ejecución de OTRA conversación.
  begin
    perform dulabs_pb_registrar_solicitud(t, pn, ana_cli, e1, '{"tipo_cliente":"persona_natural","nombre":"X","producto":"gorras","cantidad":"5"}');
    raise exception 'FAIL 23b: usó la ejecución de otro cliente';
  exception when others then if sqlerrm <> 'pb_ejecucion_inexistente' then raise; end if; end;

  -- 12. Multi-tenant en el registro: número de otro tenant, ejecución de otro tenant.
  begin
    perform dulabs_pb_registrar_solicitud(t, pn_otro, juan, e_otro, '{"tipo_cliente":"persona_natural","nombre":"X","producto":"gorras","cantidad":"5"}');
    raise exception 'FAIL 12a';
  exception when others then if sqlerrm <> 'pb_numero_ajeno' then raise; end if; end;
  begin
    perform dulabs_pb_registrar_solicitud(t, pn, juan, e_otro, '{"tipo_cliente":"persona_natural","nombre":"X","producto":"gorras","cantidad":"5"}');
    raise exception 'FAIL 12b';
  exception when others then if sqlerrm <> 'pb_ejecucion_inexistente' then raise; end if; end;
  -- El otro tenant registra su propia solicitud para el MISMO teléfono: contacto distinto.
  perform dulabs_pb_registrar_solicitud(otro, pn_otro, juan, e_otro, '{"tipo_cliente":"persona_natural","nombre":"Juan Otro","producto":"gorras","cantidad":"7"}');
  select count(*) into n from dulabs_clientes_conocidos where telefono_cliente = juan;
  if n <> 2 then raise exception 'FAIL 12c: debían ser 2 contactos (uno por tenant)'; end if;

  -- 7/8. Estado y asesor independientes por solicitud.
  j := dulabs_pb_actualizar_solicitud(t, s1, 1, jsonb_build_object('estado', 'atendido', 'asesorId', asesora_ana));
  if j->>'resultado' <> 'ok' then raise exception 'FAIL 7: %', j; end if;
  j := dulabs_pb_actualizar_solicitud(t, s2, 1, jsonb_build_object('estado', 'en_atencion', 'asesorId', asesor_carlos));
  if j->>'resultado' <> 'ok' then raise exception 'FAIL 7b: %', j; end if;
  select * into r from dulabs_pb_solicitudes where id = s1;
  if r.estado <> 'atendido' or r.asesor_id <> asesora_ana or r.version <> 2 or r.atendido_at is null or r.asignado_at is null then
    raise exception 'FAIL 7c: %', row_to_json(r);
  end if;
  select * into r from dulabs_pb_solicitudes where id = s2;
  if r.estado <> 'en_atencion' or r.asesor_id <> asesor_carlos then raise exception 'FAIL 8: %', row_to_json(r); end if;
  select * into r from dulabs_pb_solicitudes where id = s3;
  if r.estado <> 'nuevo' or r.asesor_id is not null or r.version <> 1 then raise exception 'FAIL 8b: la #3 debía seguir intacta'; end if;

  -- 11. Concurrencia: dos asesoras con la misma versión leída → la segunda recibe conflicto, nada se pisa.
  j := dulabs_pb_actualizar_solicitud(t, s3, 1, '{"estado":"en_atencion"}');
  if j->>'resultado' <> 'ok' then raise exception 'FAIL 11a'; end if;
  j := dulabs_pb_actualizar_solicitud(t, s3, 1, '{"estado":"atendido"}');
  if j->>'resultado' <> 'conflicto' then raise exception 'FAIL 11b: %', j; end if;
  if (select estado from dulabs_pb_solicitudes where id = s3) <> 'en_atencion' then raise exception 'FAIL 11c'; end if;
  -- Solo cambia lo que se envía: cambiar el asesor no toca el estado.
  j := dulabs_pb_actualizar_solicitud(t, s3, 2, jsonb_build_object('asesorId', asesora_ana));
  if j->>'resultado' <> 'ok' or (select estado from dulabs_pb_solicitudes where id = s3) <> 'en_atencion' then raise exception 'FAIL 11d'; end if;
  -- Quitar el asesor.
  j := dulabs_pb_actualizar_solicitud(t, s3, 3, '{"asesorId":null}');
  if j->>'resultado' <> 'ok' or (select asesor_id from dulabs_pb_solicitudes where id = s3) is not null
     or (select asignado_at from dulabs_pb_solicitudes where id = s3) is not null then raise exception 'FAIL 11e'; end if;

  -- 13/14. Otro tenant no puede leer ni modificar; asesor ajeno o suspendido: rechazado.
  if dulabs_pb_obtener_solicitud(otro, s1) is not null then raise exception 'FAIL 13'; end if;
  j := dulabs_pb_actualizar_solicitud(otro, s1, 2, '{"estado":"nuevo"}');
  if j->>'resultado' <> 'no_encontrada' or (select estado from dulabs_pb_solicitudes where id = s1) <> 'atendido' then raise exception 'FAIL 14'; end if;
  j := dulabs_pb_actualizar_solicitud(t, s1, 2, jsonb_build_object('asesorId', asesor_ajeno));
  if j->>'resultado' <> 'asesor_invalido' then raise exception 'FAIL 14b: %', j; end if;
  j := dulabs_pb_actualizar_solicitud(t, s1, 2, jsonb_build_object('asesorId', asesor_suspendido));
  if j->>'resultado' <> 'asesor_invalido' then raise exception 'FAIL 14c'; end if;
  if (select asesor_id from dulabs_pb_solicitudes where id = s1) <> asesora_ana then raise exception 'FAIL 14d'; end if;
  if dulabs_pb_obtener_cliente(otro, (select contacto_id from dulabs_pb_solicitudes where id = s1)) is not null then raise exception 'FAIL 14e'; end if;

  -- Datos comerciales inmutables.
  begin
    update dulabs_pb_solicitudes set cantidad = 999 where id = s1;
    raise exception 'FAIL inmutable';
  exception when others then if sqlerrm <> 'pb_solicitud_inmutable' then raise; end if; end;
  -- Estado inválido.
  begin
    perform dulabs_pb_actualizar_solicitud(t, s1, 2, '{"estado":"cerrado"}');
    raise exception 'FAIL estado inválido';
  exception when check_violation then null; end;

  -- 17. Historial del cliente: más reciente primero, con su teléfono.
  j := dulabs_pb_obtener_cliente(t, (select contacto_id from dulabs_pb_solicitudes where id = s1));
  if (j->'cliente'->>'totalSolicitudes')::int <> 3 then raise exception 'FAIL 17: %', j->'cliente'; end if;
  if (j->'solicitudes'->0->>'id')::bigint <> s3 or (j->'solicitudes'->2->>'id')::bigint <> s1 then raise exception 'FAIL 17b: orden'; end if;
  -- Perfil = el de la última solicitud (declaró empresa en la #3).
  if j->'cliente'->>'tipoCliente' <> 'empresa' or j->'cliente'->>'nombreEmpresa' <> 'Textiles SAS' then raise exception 'FAIL 17c'; end if;

  -- 18. Cliente del flujo anterior SIN solicitudes: aparece, con sus datos intactos, y sin inventar solicitudes.
  insert into dulabs_clientes_conocidos (id_tenant, phone_number_id, telefono_cliente, nombre, custom_fields)
  values (t, pn, '573000000009', '573000000009', '{"pb_tipo_cliente":"empresa","pb_nombre":"Legado","pb_nombre_empresa":"Vieja SAS","pb_producto":"gorras","pb_cantidad":"30","pb_estado":"atendido"}');
  j := dulabs_pb_obtener_cliente(t, (select id from dulabs_clientes_conocidos where telefono_cliente = '573000000009'));
  if j->'cliente'->>'nombre' <> 'Legado' or jsonb_array_length(j->'solicitudes') <> 0 or j->'cliente'->'datosAnteriores'->>'producto' <> 'gorras' then
    raise exception 'FAIL 18: %', j;
  end if;
  -- Un contacto que solo escribió (sin flow completo ni datos) NO es cliente del módulo.
  insert into dulabs_clientes_conocidos (id_tenant, phone_number_id, telefono_cliente, nombre) values (t, pn, '573000000010', '573000000010');
  if dulabs_pb_obtener_cliente(t, (select id from dulabs_clientes_conocidos where telefono_cliente = '573000000010')) is not null then raise exception 'FAIL 18b'; end if;

  -- 15/16. Listados: filtros, búsqueda, paginación, aislamiento.
  j := dulabs_pb_listar_solicitudes(t, '{}');
  if (j->>'total')::int <> 4 then raise exception 'FAIL 15: total %', j->>'total'; end if;
  j := dulabs_pb_listar_solicitudes(t, '{"limite":2,"offset":2}');
  if (j->>'total')::int <> 4 or jsonb_array_length(j->'filas') <> 2 then raise exception 'FAIL 15b'; end if;
  j := dulabs_pb_listar_solicitudes(t, '{"limite":2,"offset":10}');
  if (j->>'total')::int <> 4 or jsonb_array_length(j->'filas') <> 0 then raise exception 'FAIL 15c: fuera de rango'; end if;
  j := dulabs_pb_listar_solicitudes(t, '{"estado":"nuevo"}');
  if (j->>'total')::int <> 1 then raise exception 'FAIL 16a: %', j; end if;
  j := dulabs_pb_listar_solicitudes(t, '{"tipo":"empresa"}');
  if (j->>'total')::int <> 2 then raise exception 'FAIL 16b'; end if;
  j := dulabs_pb_listar_solicitudes(t, jsonb_build_object('asesorId', asesor_carlos));
  if (j->>'total')::int <> 1 or (j->'filas'->0->>'id')::bigint <> s2 then raise exception 'FAIL 16c'; end if;
  j := dulabs_pb_listar_solicitudes(t, '{"sinAsesor":true}');
  if (j->>'total')::int <> 2 then raise exception 'FAIL 16d: %', j->>'total'; end if;
  j := dulabs_pb_listar_solicitudes(t, '{"producto":"uniformes"}');
  if (j->>'total')::int <> 1 then raise exception 'FAIL 16e'; end if;
  j := dulabs_pb_listar_solicitudes(t, '{"q":"textiles"}');
  if (j->>'total')::int <> 1 then raise exception 'FAIL 16f'; end if;
  j := dulabs_pb_listar_solicitudes(t, '{"q":"000 0002"}');
  if (j->>'total')::int <> 1 then raise exception 'FAIL 16g: teléfono'; end if;
  j := dulabs_pb_listar_solicitudes(t, '{"q":"100%"}');
  if (j->>'total')::int <> 0 then raise exception 'FAIL 16h: comodín escapado'; end if;
  -- La fecha de la solicitud es la de su registro (cuando el flow se completó).
  j := dulabs_pb_listar_solicitudes(t, jsonb_build_object('desde', now() - interval '1 hour', 'hasta', now() + interval '1 hour'));
  if (j->>'total')::int <> 4 then raise exception 'FAIL 16i: fecha %', j->>'total'; end if;
  j := dulabs_pb_listar_solicitudes(t, jsonb_build_object('desde', now() + interval '1 hour'));
  if (j->>'total')::int <> 0 then raise exception 'FAIL 16i2: fecha futura %', j->>'total'; end if;
  j := dulabs_pb_listar_solicitudes(otro, '{}');
  if (j->>'total')::int <> 1 or j::text like '%Juan Pérez%' then raise exception 'FAIL 12d: fuga entre tenants'; end if;

  j := dulabs_pb_listar_clientes(t, '{}');
  if (j->>'total')::int <> 3 then raise exception 'FAIL 16j: clientes %', j->>'total'; end if;
  if (j->'filas'->0->>'totalSolicitudes')::int <> 1 then null; end if;
  j := dulabs_pb_listar_clientes(t, '{"q":"juan"}');
  if (j->'filas'->0->>'totalSolicitudes')::int <> 3 or j->'filas'->0->'ultimaSolicitud'->>'producto' <> 'otros' then raise exception 'FAIL 16k: %', j; end if;
  j := dulabs_pb_listar_clientes(t, '{"tipo":"persona_natural"}');
  if (j->>'total')::int <> 0 then raise exception 'FAIL 16l: %', j->>'total'; end if;
  j := dulabs_pb_listar_clientes(t, '{"limite":1,"offset":1}');
  if (j->>'total')::int <> 3 or jsonb_array_length(j->'filas') <> 1 then raise exception 'FAIL 16m'; end if;
  j := dulabs_pb_listar_clientes(otro, '{}');
  if (j->>'total')::int <> 1 or j::text like '%Legado%' then raise exception 'FAIL 12e'; end if;

  -- Un número que deja de ser del tenant: sus solicitudes dejan de verse (no se filtran a nadie).
  update dulabs_clientes_config set id_tenant = otro where phone_number_id = pn;
  j := dulabs_pb_listar_solicitudes(t, '{}');
  if (j->>'total')::int <> 0 then raise exception 'FAIL 12f'; end if;
  j := dulabs_pb_listar_solicitudes(otro, '{}');
  if j::text like '%Juan Pérez%' then raise exception 'FAIL 12g: el nuevo dueño del número no ve solicitudes de otro tenant'; end if;
  update dulabs_clientes_config set id_tenant = t where phone_number_id = pn;

  -- Retención: el contacto no puede borrarse mientras tenga solicitudes.
  begin
    delete from dulabs_clientes_conocidos where id = (select contacto_id from dulabs_pb_solicitudes where id = s1);
    raise exception 'FAIL retención';
  exception when foreign_key_violation then null; end;

  raise notice 'OK — dulabs_pb_solicitudes: todas las verificaciones pasaron';
end $$;
