-- Catálogo DuLabs, Fase 7 — verificación de 20261108000000_dulabs_catalogo_pedidos.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO. NUNCA en Supabase: este script
-- INSERTA pedidos y eventos de prueba (tenants ficticios aaaa…/bbbb…).
--
-- Preparación (PostgreSQL 16 local, base vacía):
--   create role service_role; create role anon; create role authenticated;
--   \i supabase/migrations/20261108000000_dulabs_catalogo_pedidos.sql
--   \i supabase/migrations/20261108000000_dulabs_catalogo_pedidos.sql   -- idempotente: 2.ª vez sin error
--   set role service_role;   -- las funciones solo las ejecuta el backend
--   \i supabase/tests/20261108000000_dulabs_catalogo_pedidos.test.sql
-- Cada bloque imprime "PASS n ..." o aborta con "FAIL n".

\set ON_ERROR_STOP 1

do $$
declare
  t1 constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t2 constant uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  lineas constant jsonb := '[{"reference":"DL-000001","productName":"Esmalte","quantity":2,"unitPrice":12000,"subtotal":24000}]';
  base jsonb;
  r jsonb;
  r2 jsonb;
  p1 uuid;
  p2 uuid;
  n int;
begin
  base := jsonb_build_object(
    'id_tenant', t1, 'pedido_publico', 'DL-ORD-7K2M9Q', 'canal', 'retail', 'origen', 'catalog', 'estado', 'validated',
    'clave_idempotencia', 'catalog:req-0001', 'lineas', lineas, 'total_unidades', 2, 'total', 24000, 'unidades_sin_precio', 0,
    'created_at', '2026-09-23T15:00:00Z');

  -- 1. Crear: pedido + evento en la misma transacción.
  r := dulabs_catalogo_pedido_crear(base, '{"event_id":"evt_00000000000000000000000001","tipo":"catalog.order_request.created","payload":{"k":1}}');
  p1 := (r->'pedido'->>'id')::uuid;
  if not (r->>'creado')::boolean or r->'pedido'->>'estado' <> 'validated' then raise exception 'FAIL 1 %', r; end if;
  if (r->'pedido'->>'created_at')::timestamptz <> '2026-09-23T15:00:00Z'::timestamptz then raise exception 'FAIL 1 created_at %', r->'pedido'->>'created_at'; end if;
  select count(*) into n from dulabs_catalogo_pedido_eventos where pedido_id = p1 and tipo = 'catalog.order_request.created' and estado_hacia = 'validated';
  if n <> 1 then raise exception 'FAIL 1 eventos=%', n; end if;
  raise notice 'PASS 1 crear pedido + evento (created_at del backend)';

  -- 2. Idempotencia: la misma clave devuelve EL MISMO pedido y no escribe otro evento.
  r := dulabs_catalogo_pedido_crear(base || '{"pedido_publico":"DL-ORD-AAAAAA","total":1}', '{"event_id":"evt_00000000000000000000000002","tipo":"catalog.order_request.created","payload":{}}');
  if (r->>'creado')::boolean or (r->'pedido'->>'id')::uuid <> p1 or r->'pedido'->>'pedido_publico' <> 'DL-ORD-7K2M9Q' or (r->'pedido'->>'total')::int <> 24000 then
    raise exception 'FAIL 2 %', r;
  end if;
  select count(*) into n from dulabs_catalogo_pedidos where id_tenant = t1;
  if n <> 1 then raise exception 'FAIL 2 pedidos=%', n; end if;
  select count(*) into n from dulabs_catalogo_pedido_eventos where pedido_id = p1;
  if n <> 1 then raise exception 'FAIL 2 eventos=%', n; end if;
  raise notice 'PASS 2 misma clave => mismo pedido, sin evento duplicado';

  -- 3. La clave es POR NEGOCIO: la misma clave y el mismo público en otro tenant son otro pedido.
  r2 := dulabs_catalogo_pedido_crear(base || jsonb_build_object('id_tenant', t2), '{"event_id":"evt_00000000000000000000000003","tipo":"catalog.order_request.created","payload":{}}');
  p2 := (r2->'pedido'->>'id')::uuid;
  if not (r2->>'creado')::boolean or p2 = p1 then raise exception 'FAIL 3 %', r2; end if;
  raise notice 'PASS 3 clave e id público aislados por tenant';

  -- 4. Id público repetido en el MISMO negocio (clave distinta) => unique_violation (el backend re-deriva).
  begin
    perform dulabs_catalogo_pedido_crear(base || '{"clave_idempotencia":"catalog:req-0002"}', '{"event_id":"evt_00000000000000000000000004","tipo":"order.created","payload":{}}');
    raise exception 'FAIL 4 id público duplicado aceptado';
  exception when unique_violation then
    raise notice 'PASS 4 id público único por negocio (unique_violation)';
  end;

  -- 5. Restricciones de forma.
  begin
    perform dulabs_catalogo_pedido_crear(base || '{"clave_idempotencia":"k-formato-1","pedido_publico":"DL-ORD-ILOU00"}', '{"event_id":"evt_00000000000000000000000005","tipo":"order.created","payload":{}}');
    raise exception 'FAIL 5a id público fuera de formato aceptado';
  exception when check_violation then null;
  end;
  begin
    perform dulabs_catalogo_pedido_crear(base || '{"clave_idempotencia":"k-formato-2","pedido_publico":"DL-ORD-BBBBBB","total":-1}', '{"event_id":"evt_00000000000000000000000005","tipo":"order.created","payload":{}}');
    raise exception 'FAIL 5b total negativo aceptado';
  exception when check_violation then null;
  end;
  begin
    perform dulabs_catalogo_pedido_crear(base || '{"clave_idempotencia":"k-formato-3","pedido_publico":"DL-ORD-CCCCCC","canal":"vip"}', '{"event_id":"evt_00000000000000000000000005","tipo":"order.created","payload":{}}');
    raise exception 'FAIL 5c canal inventado aceptado';
  exception when check_violation then null;
  end;
  begin
    perform dulabs_catalogo_pedido_crear(base || '{"clave_idempotencia":"k-formato-4","pedido_publico":"DL-ORD-DDDDDD","estado":"pending_confirmation"}', '{"event_id":"evt_00000000000000000000000005","tipo":"order.created","payload":{}}');
    raise exception 'FAIL 5d propuesta sin contacto aceptada';
  exception when check_violation then null;
  end;
  begin
    perform dulabs_catalogo_pedido_crear(base || '{"clave_idempotencia":"k-formato-5","pedido_publico":"DL-ORD-EEEEEE","contacto_phone_number_id":"123"}', '{"event_id":"evt_00000000000000000000000005","tipo":"order.created","payload":{}}');
    raise exception 'FAIL 5e contacto a medias aceptado';
  exception when check_violation then null;
  end;
  begin
    perform dulabs_catalogo_pedido_crear(base || '{"clave_idempotencia":"corta","pedido_publico":"DL-ORD-FFFFFF"}', '{"event_id":"evt_00000000000000000000000005","tipo":"order.created","payload":{}}');
    raise exception 'FAIL 5f clave de idempotencia corta aceptada';
  exception when check_violation then null;
  end;
  raise notice 'PASS 5 formato: id público, total>=0, canal, contacto requerido/par, clave';

  -- 6. Transición válida + reclamo de contacto (validated -> pending_confirmation, agente).
  r := dulabs_catalogo_pedido_transicion(t1, p1, 'validated', 'pending_confirmation', 'agent',
    '{"contacto_phone_number_id":"PNID-TEST-1","contacto_wa_id":"573000000001","confirmacion":{"id":"cf_1","total":24000}}',
    '{"event_id":"evt_00000000000000000000000006","tipo":"order.status_changed","motivo":"propuesta","payload":{}}');
  if r is null or r->>'estado' <> 'pending_confirmation' or r->>'contacto_wa_id' <> '573000000001' or r->'confirmacion'->>'id' <> 'cf_1' then raise exception 'FAIL 6 %', r; end if;
  select count(*) into n from dulabs_catalogo_pedido_eventos where pedido_id = p1 and estado_desde = 'validated' and estado_hacia = 'pending_confirmation' and actor = 'agent';
  if n <> 1 then raise exception 'FAIL 6 evento'; end if;
  raise notice 'PASS 6 transición permitida + contacto reclamado + evento';

  -- 7. Compare-and-set: repetir la misma transición ya no aplica (null) y no escribe evento.
  r := dulabs_catalogo_pedido_transicion(t1, p1, 'validated', 'pending_confirmation', 'agent', '{}',
    '{"event_id":"evt_00000000000000000000000007","tipo":"order.status_changed","payload":{}}');
  if r is not null then raise exception 'FAIL 7 %', r; end if;
  select count(*) into n from dulabs_catalogo_pedido_eventos where event_id = 'evt_00000000000000000000000007';
  if n <> 0 then raise exception 'FAIL 7 evento escrito'; end if;
  raise notice 'PASS 7 CAS: estado esperado desactualizado => null, sin evento';

  -- 8. Otra conversación no puede reclamar un pedido que ya tiene contacto.
  r := dulabs_catalogo_pedido_transicion(t1, p1, 'pending_confirmation', 'pending_confirmation', 'system',
    '{"contacto_phone_number_id":"PNID-TEST-1","contacto_wa_id":"573000000999"}', null);
  if r is not null then raise exception 'FAIL 8 contacto sobrescrito %', r; end if;
  r := dulabs_catalogo_pedido_transicion(t1, p1, 'pending_confirmation', 'pending_confirmation', 'system',
    '{"contacto_phone_number_id":"PNID-OTRO","contacto_wa_id":"573000000001"}', null);
  if r is not null then raise exception 'FAIL 8 otro número del negocio aceptado %', r; end if;
  r := dulabs_catalogo_pedido_transicion(t1, p1, 'pending_confirmation', 'pending_confirmation', 'system',
    '{"contacto_phone_number_id":"PNID-TEST-1","contacto_wa_id":"573000000001"}', null);
  if r is null then raise exception 'FAIL 8 el mismo contacto fue rechazado'; end if;
  raise notice 'PASS 8 contacto: solo se fija una vez (mismo contacto = ok)';

  -- 9. Transiciones o actores no autorizados => error (22023), nada cambia.
  begin
    perform dulabs_catalogo_pedido_transicion(t1, p1, 'pending_confirmation', 'confirmed', 'system', '{}', null);
    raise exception 'FAIL 9a el sistema confirmó sin el cliente';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform dulabs_catalogo_pedido_transicion(t1, p1, 'pending_confirmation', 'completed', 'agent', '{}', null);
    raise exception 'FAIL 9b el agente completó un pedido';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform dulabs_catalogo_pedido_transicion(t1, p1, 'pending_confirmation', 'cancelled', 'agent', '{}', null);
    raise exception 'FAIL 9c el agente canceló';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform dulabs_catalogo_pedido_transicion(t1, p1, 'pending_confirmation', 'confirmed', 'cliente', '{}', null);
    raise exception 'FAIL 9d actor inventado';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform dulabs_catalogo_pedido_transicion(t2, p2, 'validated', 'confirmed', 'agent', '{}', null);
    raise exception 'FAIL 9e salto validated -> confirmed';
  exception when invalid_parameter_value then null;
  end;
  select count(*) into n from dulabs_catalogo_pedidos where id = p1 and estado = 'pending_confirmation';
  if n <> 1 then raise exception 'FAIL 9 estado alterado'; end if;
  raise notice 'PASS 9 transiciones/actores no autorizados rechazados';

  -- 10. Aislamiento: el tenant 2 no puede transicionar un pedido del tenant 1.
  r := dulabs_catalogo_pedido_transicion(t2, p1, 'pending_confirmation', 'handoff', 'agent', '{}',
    '{"event_id":"evt_00000000000000000000000010","tipo":"order.handoff_requested","payload":{}}');
  if r is not null then raise exception 'FAIL 10 cross-tenant %', r; end if;
  select count(*) into n from dulabs_catalogo_pedido_eventos where event_id = 'evt_00000000000000000000000010';
  if n <> 0 then raise exception 'FAIL 10 evento cross-tenant'; end if;
  raise notice 'PASS 10 otro tenant no ve ni transiciona el pedido';

  -- 11. Solo claves permitidas: negocio, canal, origen, id público e idempotencia NO se pueden cambiar.
  r := dulabs_catalogo_pedido_transicion(t1, p1, 'pending_confirmation', 'confirmed', 'agent',
    jsonb_build_object('id_tenant', t2, 'canal', 'wholesale', 'origen', 'manual', 'pedido_publico', 'DL-ORD-ZZZZZZ', 'clave_idempotencia', 'otra-clave-x', 'confirmacion', null),
    '{"event_id":"evt_00000000000000000000000011","tipo":"order.status_changed","payload":{}}');
  if r is null or r->>'estado' <> 'confirmed' or (r->>'id_tenant')::uuid <> t1 or r->>'canal' <> 'retail' or r->>'origen' <> 'catalog'
     or r->>'pedido_publico' <> 'DL-ORD-7K2M9Q' or r->>'clave_idempotencia' <> 'catalog:req-0001' or r->'confirmacion' <> 'null'::jsonb then
    raise exception 'FAIL 11 %', r;
  end if;
  raise notice 'PASS 11 campos protegidos ignorados (tenant/canal/origen/id/clave)';

  -- 12. Sin "actualizar en el lugar" fuera de draft/validated/pending_confirmation.
  begin
    perform dulabs_catalogo_pedido_transicion(t1, p1, 'confirmed', 'confirmed', 'agent', '{"total":1}', null);
    raise exception 'FAIL 12 pedido confirmado modificado';
  exception when invalid_parameter_value then
    raise notice 'PASS 12 un pedido confirmado no se reescribe';
  end;

  -- 13. Handoff y terminales.
  r := dulabs_catalogo_pedido_transicion(t1, p1, 'confirmed', 'handoff', 'agent', '{"handoff":{"reason":"quiere cambiar talla","requestedBy":"agent"}}',
    '{"event_id":"evt_00000000000000000000000013","tipo":"order.handoff_requested","motivo":"quiere cambiar talla","payload":{}}');
  if r is null or r->'handoff'->>'reason' <> 'quiere cambiar talla' then raise exception 'FAIL 13 %', r; end if;
  r := dulabs_catalogo_pedido_transicion(t1, p1, 'handoff', 'completed', 'human', '{}', null);
  if r is null then raise exception 'FAIL 13 completar'; end if;
  begin
    perform dulabs_catalogo_pedido_transicion(t1, p1, 'completed', 'cancelled', 'human', '{}', null);
    raise exception 'FAIL 13 salida de un estado terminal';
  exception when invalid_parameter_value then null;
  end;
  select count(*) into n from dulabs_catalogo_pedido_eventos where pedido_id = p1 and tipo = 'order.handoff_requested' and motivo = 'quiere cambiar talla';
  if n <> 1 then raise exception 'FAIL 13 evento de handoff'; end if;
  raise notice 'PASS 13 handoff registrado, completed es terminal';

  -- 14. Eventos inmutables.
  begin
    update dulabs_catalogo_pedido_eventos set motivo = 'x' where pedido_id = p1;
    raise exception 'FAIL 14 evento modificado';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from dulabs_catalogo_pedido_eventos where pedido_id = p1;
    raise exception 'FAIL 14 evento borrado';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 14 eventos inmutables (update/delete rechazados)';

  -- 15. Un evento no puede apuntar a un pedido de otro tenant (FK compuesta).
  begin
    insert into dulabs_catalogo_pedido_eventos (event_id, id_tenant, pedido_id, tipo, payload)
    values ('evt_00000000000000000000000015', t2, p1, 'order.created', '{}');
    raise exception 'FAIL 15 evento cross-tenant aceptado';
  exception when foreign_key_violation then
    raise notice 'PASS 15 FK compuesta (pedido, tenant)';
  end;

  -- 16. event_id es la llave de deduplicación.
  begin
    insert into dulabs_catalogo_pedido_eventos (event_id, id_tenant, pedido_id, tipo, payload)
    values ('evt_00000000000000000000000001', t1, p1, 'order.created', '{}');
    raise exception 'FAIL 16 event_id duplicado aceptado';
  exception when unique_violation then
    raise notice 'PASS 16 event_id único';
  end;
end;
$$;

-- 17. Permisos: ni anon ni authenticated tocan las tablas ni ejecutan las funciones.
do $$
begin
  if has_table_privilege('anon', 'public.dulabs_catalogo_pedidos', 'select')
     or has_table_privilege('authenticated', 'public.dulabs_catalogo_pedidos', 'insert')
     or has_table_privilege('anon', 'public.dulabs_catalogo_pedido_eventos', 'select')
     or has_function_privilege('anon', 'public.dulabs_catalogo_pedido_crear(jsonb, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_catalogo_pedido_transicion(uuid, uuid, text, text, text, jsonb, jsonb)', 'execute') then
    raise exception 'FAIL 17 privilegios de más para anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.dulabs_catalogo_pedido_crear(jsonb, jsonb)', 'execute') then
    raise exception 'FAIL 17 service_role sin execute';
  end if;
  raise notice 'PASS 17 solo service_role ejecuta; anon/authenticated sin acceso';
end;
$$;
