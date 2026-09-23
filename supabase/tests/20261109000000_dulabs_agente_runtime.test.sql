-- Fase 8 — verificación de 20261109000000_dulabs_agente_runtime.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba).
-- Preparación: create role service_role; create role anon; create role authenticated;
--   \i supabase/migrations/20261109000000_dulabs_agente_runtime.sql   (dos veces: idempotente)
--   set role service_role; \i supabase/tests/20261109000000_dulabs_agente_runtime.test.sql

\set ON_ERROR_STOP 1

do $$
declare
  t1 constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
begin
  -- 1. Sin proveedor / modelo / credencial => la fila NO se puede crear (no hay default).
  begin
    insert into dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, modelo, credencial_ref, herramientas)
    values (t1, 'PN-1', 'catalog_sales', 'gemini-3.6-flash', 'env:GEMINI_KEY_X', '{search_products}');
    raise exception 'FAIL 1 proveedor por defecto aceptado';
  exception when not_null_violation then null;
  end;
  begin
    insert into dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, proveedor, credencial_ref, herramientas)
    values (t1, 'PN-1', 'catalog_sales', 'gemini', 'env:GEMINI_KEY_X', '{search_products}');
    raise exception 'FAIL 1b modelo por defecto aceptado';
  exception when not_null_violation then null;
  end;
  raise notice 'PASS 1 proveedor y modelo obligatorios (sin default)';

  -- 2. Proveedor no registrado, credencial pegada como secreto, sin herramientas => rechazados.
  begin
    insert into dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, proveedor, modelo, credencial_ref, herramientas)
    values (t1, 'PN-2', 'catalog_sales', 'anthropic', 'claude-sonnet-5', 'env:ANTHROPIC_API_KEY', '{search_products}');
    raise exception 'FAIL 2a proveedor anthropic aceptado';
  exception when check_violation then null;
  end;
  begin
    insert into dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, proveedor, modelo, credencial_ref, herramientas)
    values (t1, 'PN-2', 'catalog_sales', 'gemini', 'gemini-3.6-flash', 'AIzaSyClavePegadaPorError', '{search_products}');
    raise exception 'FAIL 2b secreto en la config aceptado';
  exception when check_violation then null;
  end;
  begin
    insert into dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, proveedor, modelo, credencial_ref, herramientas)
    values (t1, 'PN-2', 'catalog_sales', 'gemini', 'gemini-3.6-flash', 'env:GEMINI_KEY_X', '{}');
    raise exception 'FAIL 2c sin herramientas aceptado';
  exception when check_violation then null;
  end;
  raise notice 'PASS 2 proveedor, credencial y herramientas validados';

  -- 3. Fila válida; un solo agente por número; apagado por defecto.
  insert into dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, proveedor, modelo, credencial_ref, herramientas)
  values (t1, 'PN-3', 'catalog_sales', 'gemini', 'gemini-3.6-flash', 'env:GEMINI_KEY_DELACOUR', '{search_products,handoff_to_human}');
  if (select habilitado from dulabs_agente_runtime_config where phone_number_id = 'PN-3') then raise exception 'FAIL 3 encendido por defecto'; end if;
  begin
    insert into dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, proveedor, modelo, credencial_ref, herramientas)
    values (t1, 'PN-3', 'catalog_sales', 'gemini', 'gemini-3.6-flash', 'env:GEMINI_KEY_DELACOUR', '{search_products}');
    raise exception 'FAIL 3 dos agentes para el mismo número';
  exception when unique_violation then null;
  end;
  raise notice 'PASS 3 un agente por número, apagado por defecto';

  -- 4. Conversaciones: wa_id válido, estado objeto, clave (número, wa_id).
  insert into dulabs_agente_conversaciones (id_tenant, phone_number_id, wa_id, estado) values (t1, 'PN-3', '573001112233', '{"v":1}');
  begin
    insert into dulabs_agente_conversaciones (id_tenant, phone_number_id, wa_id) values (t1, 'PN-3', '573001112233');
    raise exception 'FAIL 4 conversación duplicada';
  exception when unique_violation then null;
  end;
  begin
    insert into dulabs_agente_conversaciones (id_tenant, phone_number_id, wa_id) values (t1, 'PN-3', '+57 300');
    raise exception 'FAIL 4b wa_id inválido';
  exception when check_violation then null;
  end;
  raise notice 'PASS 4 conversación única por número + wa_id';
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.dulabs_agente_runtime_config', 'select')
     or has_table_privilege('authenticated', 'public.dulabs_agente_conversaciones', 'select') then
    raise exception 'FAIL 5 anon/authenticated con acceso';
  end if;
  raise notice 'PASS 5 solo el backend (service_role) accede';
end;
$$;
