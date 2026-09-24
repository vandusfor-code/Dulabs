-- Fase 9 — verificación de 20261110000000_dulabs_agente_medios.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba).
-- Preparación: create role service_role; create role anon; create role authenticated;
--   \i supabase/migrations/20261110000000_dulabs_agente_medios.sql   (dos veces: idempotente)
--   set role service_role; \i supabase/tests/20261110000000_dulabs_agente_medios.test.sql

\set ON_ERROR_STOP 1

do $$
declare
  t1 constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  p1 constant uuid := 'cccccccc-0000-4000-8000-00000000000c';
begin
  -- 1. Foto válida registrada con su wamid.
  insert into dulabs_agente_medios_enviados (id_tenant, phone_number_id, wa_id, wamid, referencia, id_producto, canal, turno)
  values (t1, 'PN-1', '573001112233', 'wamid.HBgM1', 'DL-000184', p1, 'retail', 3);
  raise notice 'PASS 1 foto registrada';

  -- 2. Un wamid = una foto (Meta no repite ids): el segundo registro se rechaza.
  begin
    insert into dulabs_agente_medios_enviados (id_tenant, phone_number_id, wa_id, wamid, referencia, canal, turno)
    values (t1, 'PN-1', '573001112233', 'wamid.HBgM1', 'DL-000185', 'retail', 3);
    raise exception 'FAIL 2 wamid duplicado aceptado';
  exception when unique_violation then null;
  end;
  raise notice 'PASS 2 wamid único';

  -- 3. Referencia, canal y wa_id inválidos => rechazados.
  begin
    insert into dulabs_agente_medios_enviados (id_tenant, phone_number_id, wa_id, wamid, referencia, canal, turno)
    values (t1, 'PN-1', '573001112233', 'wamid.HBgM2', 'aretes', 'retail', 1);
    raise exception 'FAIL 3a referencia libre aceptada';
  exception when check_violation then null;
  end;
  begin
    insert into dulabs_agente_medios_enviados (id_tenant, phone_number_id, wa_id, wamid, referencia, canal, turno)
    values (t1, 'PN-1', '573001112233', 'wamid.HBgM3', 'DL-000184', 'vip', 1);
    raise exception 'FAIL 3b canal inventado aceptado';
  exception when check_violation then null;
  end;
  begin
    insert into dulabs_agente_medios_enviados (id_tenant, phone_number_id, wa_id, wamid, referencia, canal, turno)
    values (t1, 'PN-1', '+57 300', 'wamid.HBgM4', 'DL-000184', 'retail', 1);
    raise exception 'FAIL 3c wa_id inválido aceptado';
  exception when check_violation then null;
  end;
  raise notice 'PASS 3 referencia, canal y wa_id validados';

  -- 4. Sin id de producto también es válido (foto legada); búsqueda dentro de la conversación.
  insert into dulabs_agente_medios_enviados (id_tenant, phone_number_id, wa_id, wamid, referencia, canal, turno)
  values (t1, 'PN-1', '573001112233', 'wamid.HBgM5', 'DL-000186', 'wholesale', 4);
  if (select count(*) from dulabs_agente_medios_enviados where id_tenant = t1 and phone_number_id = 'PN-1' and wa_id = '573001112233' and wamid = 'wamid.HBgM5') <> 1 then
    raise exception 'FAIL 4 búsqueda por conversación';
  end if;
  if (select count(*) from dulabs_agente_medios_enviados where id_tenant = t1 and phone_number_id = 'PN-1' and wa_id = '573009999999' and wamid = 'wamid.HBgM5') <> 0 then
    raise exception 'FAIL 4b otro cliente ve la foto';
  end if;
  raise notice 'PASS 4 búsqueda acotada a la conversación';
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.dulabs_agente_medios_enviados', 'select')
     or has_table_privilege('authenticated', 'public.dulabs_agente_medios_enviados', 'select')
     or has_table_privilege('anon', 'public.dulabs_agente_medios_enviados', 'insert') then
    raise exception 'FAIL 5 anon/authenticated con acceso';
  end if;
  raise notice 'PASS 5 solo el backend (service_role) accede';
end;
$$;
