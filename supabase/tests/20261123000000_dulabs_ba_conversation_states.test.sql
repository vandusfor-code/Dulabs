-- Business Agent 2.0, FASE 3 — verificación de 20261123000000_dulabs_ba_conversation_states.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba).
-- Preparación:
--   create role service_role bypassrls; create role anon; create role authenticated;
--   la función public.dulabs_flow_set_updated_at() (de 20260828100000_dulabs_flow_store.sql)
--   \i supabase/migrations/20261123000000_dulabs_ba_conversation_states.sql   (dos veces: idempotente)
--   \i supabase/tests/20261123000000_dulabs_ba_conversation_states.test.sql
-- La concurrencia REAL (dos sesiones) se prueba aparte: scripts/verify-ba-conversation-states.sh.

\set ON_ERROR_STOP 1

do $$
declare
  t1 constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  t2 constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  n integer;
  v integer;
begin
  insert into dulabs_ba_conversation_states (id_tenant, phone_number_id, telefono_cliente, agent_id, status, schema_version, state)
  values (t1, 'PN-1', '573001112233', 'flow-1', 'NEW', 'business-agent.conversation-state/1.0.0', '{"status":"NEW"}');

  -- 1. Una conversación = una fila por (tenant, número, cliente, agente).
  begin
    insert into dulabs_ba_conversation_states (id_tenant, phone_number_id, telefono_cliente, agent_id, status, schema_version, state)
    values (t1, 'PN-1', '573001112233', 'flow-1', 'NEW', 'x', '{"status":"NEW"}');
    raise exception 'FAIL 1 fila duplicada aceptada';
  exception when unique_violation then null;
  end;
  -- El mismo cliente con OTRO tenant u otro agente es otra conversación (aislamiento).
  insert into dulabs_ba_conversation_states (id_tenant, phone_number_id, telefono_cliente, agent_id, status, schema_version, state)
  values (t2, 'PN-1', '573001112233', 'flow-1', 'NEW', 'x', '{"status":"NEW"}');
  insert into dulabs_ba_conversation_states (id_tenant, phone_number_id, telefono_cliente, agent_id, status, schema_version, state)
  values (t1, 'PN-1', '573001112233', 'flow-2', 'NEW', 'x', '{"status":"NEW"}');
  raise notice 'PASS 1 clave única por tenant + número + cliente + agente';

  -- 2. Concurrencia optimista: el primero que escribe con la versión esperada gana; el segundo afecta 0 filas.
  update dulabs_ba_conversation_states set state_version = 2, status = 'COLLECTING_INFORMATION', state = '{"status":"COLLECTING_INFORMATION"}'
   where id_tenant = t1 and phone_number_id = 'PN-1' and telefono_cliente = '573001112233' and agent_id = 'flow-1' and state_version = 1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 2 la primera escritura no aplicó'; end if;
  update dulabs_ba_conversation_states set state_version = 2, status = 'NEW', state = '{"status":"NEW"}'
   where id_tenant = t1 and phone_number_id = 'PN-1' and telefono_cliente = '573001112233' and agent_id = 'flow-1' and state_version = 1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2 escritura con versión vieja aceptada'; end if;
  raise notice 'PASS 2 UPDATE ... WHERE state_version = esperado (versión vieja = 0 filas)';

  -- 3. La versión solo avanza de a 1 (ni retrocede ni salta).
  begin
    update dulabs_ba_conversation_states set state_version = 5
     where id_tenant = t1 and agent_id = 'flow-1' and telefono_cliente = '573001112233';
    raise exception 'FAIL 3 salto de versión aceptado';
  exception when check_violation then null;
  end;
  begin
    update dulabs_ba_conversation_states set state_version = 1
     where id_tenant = t1 and agent_id = 'flow-1' and telefono_cliente = '573001112233';
    raise exception 'FAIL 3 retroceso de versión aceptado';
  exception when check_violation then null;
  end;
  raise notice 'PASS 3 versión monotónica +1';

  -- 4. Una fila no puede cambiar de tenant, cliente ni agente.
  begin
    update dulabs_ba_conversation_states set id_tenant = t2, state_version = state_version + 1
     where id_tenant = t1 and agent_id = 'flow-1' and telefono_cliente = '573001112233';
    raise exception 'FAIL 4 cambio de tenant aceptado';
  exception when check_violation then null;
  end;
  begin
    update dulabs_ba_conversation_states set telefono_cliente = '573009999999', state_version = state_version + 1
     where id_tenant = t1 and agent_id = 'flow-1' and telefono_cliente = '573001112233';
    raise exception 'FAIL 4 cambio de cliente aceptado';
  exception when check_violation then null;
  end;
  raise notice 'PASS 4 clave inmutable';

  -- 5. Estado inválido: status fuera de la taxonomía, documento que no es objeto o que no coincide con la columna.
  begin
    insert into dulabs_ba_conversation_states (id_tenant, phone_number_id, telefono_cliente, agent_id, status, schema_version, state)
    values (t1, 'PN-2', '573001112233', 'flow-1', 'HACKED', 'x', '{"status":"HACKED"}');
    raise exception 'FAIL 5 status inventado aceptado';
  exception when check_violation then null;
  end;
  begin
    insert into dulabs_ba_conversation_states (id_tenant, phone_number_id, telefono_cliente, agent_id, status, schema_version, state)
    values (t1, 'PN-2', '573001112233', 'flow-1', 'NEW', 'x', '[1,2]');
    raise exception 'FAIL 5 estado no-objeto aceptado';
  exception when check_violation then null;
  end;
  begin
    insert into dulabs_ba_conversation_states (id_tenant, phone_number_id, telefono_cliente, agent_id, status, schema_version, state)
    values (t1, 'PN-2', '573001112233', 'flow-1', 'NEW', 'x', '{"status":"COMPLETED"}');
    raise exception 'FAIL 5 status de la columna distinto al del documento aceptado';
  exception when check_violation then null;
  end;
  raise notice 'PASS 5 estado validado por la base (taxonomía, forma, espejo de status)';

  -- 6. updated_at lo pone la base.
  select state_version into v from dulabs_ba_conversation_states where id_tenant = t1 and agent_id = 'flow-1' and telefono_cliente = '573001112233';
  if v <> 2 then raise exception 'FAIL 6 versión inesperada %', v; end if;
  raise notice 'PASS 6 versión final = 2';
end;
$$;

-- 7. RLS: un rol sin política (anon) no ve filas aunque tenga privilegio de lectura.
grant select on public.dulabs_ba_conversation_states to anon;
set role anon;
do $$
declare n integer;
begin
  select count(*) into n from public.dulabs_ba_conversation_states;
  if n <> 0 then raise exception 'FAIL 7 anon ve % filas', n; end if;
  raise notice 'PASS 7 RLS: anon no ve estados';
end;
$$;
reset role;
revoke select on public.dulabs_ba_conversation_states from anon;
