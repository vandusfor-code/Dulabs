-- Bloque 11 — verificación de 20261112000000_dulabs_agente_buzon.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba).
-- Preparación: create role service_role; create role anon; create role authenticated;
--   \i supabase/migrations/20261112000000_dulabs_agente_buzon.sql   (dos veces: idempotente)
--   \i supabase/tests/20261112000000_dulabs_agente_buzon.test.sql

\set ON_ERROR_STOP 1

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  r text;
begin
  -- 1. Buzón: un wamid = un mensaje (un reintento de Meta no duplica).
  insert into dulabs_agente_buzon (id_tenant, phone_number_id, wa_id, wamid, texto) values (a, 'PN-1', '573001112233', 'wamid.1', 'quiero ver aretes');
  begin
    insert into dulabs_agente_buzon (id_tenant, phone_number_id, wa_id, wamid, texto) values (a, 'PN-1', '573001112233', 'wamid.1', 'quiero ver aretes');
    raise exception 'FAIL 1 wamid duplicado';
  exception when unique_violation then null;
  end;
  raise notice 'PASS 1 buzón único por wamid';

  -- 2. Turno: el primero lo toma; el segundo no; el dueño lo renueva.
  if not dulabs_agente_tomar_turno(a, 'PN-1', '573001112233', 'wamid.1', 60) then raise exception 'FAIL 2a tomar'; end if;
  if dulabs_agente_tomar_turno(a, 'PN-1', '573001112233', 'wamid.2', 60) then raise exception 'FAIL 2b dos dueños'; end if;
  if not dulabs_agente_tomar_turno(a, 'PN-1', '573001112233', 'wamid.1', 60) then raise exception 'FAIL 2c renovar'; end if;
  if dulabs_agente_tomar_turno(b, 'PN-1', '573001112233', 'wamid.X', 60) then raise exception 'FAIL 2d otro negocio'; end if;
  raise notice 'PASS 2 un solo dueño del turno; renovable; nunca otro negocio';

  -- 3. Soltar con pendientes => 'pending' (el dueño sigue); sin pendientes => 'released'; ajeno => 'lost'.
  r := dulabs_agente_soltar_turno('PN-1', '573001112233', 'wamid.1');
  if r <> 'pending' then raise exception 'FAIL 3a %', r; end if;
  update dulabs_agente_buzon set procesado_at = now(), texto = null, turno = 1 where wamid = 'wamid.1';
  r := dulabs_agente_soltar_turno('PN-1', '573001112233', 'wamid.2');
  if r <> 'lost' then raise exception 'FAIL 3b %', r; end if;
  r := dulabs_agente_soltar_turno('PN-1', '573001112233', 'wamid.1');
  if r <> 'released' then raise exception 'FAIL 3c %', r; end if;
  if not dulabs_agente_tomar_turno(a, 'PN-1', '573001112233', 'wamid.2', 60) then raise exception 'FAIL 3d libre tras soltar'; end if;
  raise notice 'PASS 3 soltar solo sin pendientes';

  -- 4. Turno vencido (proceso caído) => otro lo toma.
  update dulabs_agente_turno set hasta = now() - interval '1 second' where phone_number_id = 'PN-1';
  if not dulabs_agente_tomar_turno(a, 'PN-1', '573001112233', 'wamid.3', 60) then raise exception 'FAIL 4 vencido'; end if;
  raise notice 'PASS 4 un turno vencido se puede tomar';

  -- 5. Límites: el vencimiento se acota (10..300 s); datos inválidos rechazados.
  if (select hasta - now() from dulabs_agente_turno where phone_number_id = 'PN-1') > interval '61 seconds' then raise exception 'FAIL 5a'; end if;
  perform dulabs_agente_tomar_turno(a, 'PN-2', '573001112233', 'wamid.4', 100000);
  if (select hasta - now() from dulabs_agente_turno where phone_number_id = 'PN-2') > interval '301 seconds' then raise exception 'FAIL 5b tope'; end if;
  begin
    insert into dulabs_agente_buzon (id_tenant, phone_number_id, wa_id, wamid) values (a, 'PN-1', '+57 300', 'wamid.9');
    raise exception 'FAIL 5c wa_id';
  exception when check_violation then null;
  end;
  raise notice 'PASS 5 límites';
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.dulabs_agente_buzon', 'select')
     or has_table_privilege('authenticated', 'public.dulabs_agente_turno', 'select')
     or has_function_privilege('anon', 'public.dulabs_agente_tomar_turno(uuid, text, text, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_agente_soltar_turno(text, text, text)', 'execute') then
    raise exception 'FAIL 6 anon/authenticated con acceso';
  end if;
  raise notice 'PASS 6 solo el backend (service_role)';
end;
$$;
