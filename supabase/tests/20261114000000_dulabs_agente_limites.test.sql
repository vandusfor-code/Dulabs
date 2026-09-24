-- Bloque 14 — verificación de 20261114000000_dulabs_agente_limites.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba).
-- Preparación: create role service_role; create role anon; create role authenticated;
--   \i supabase/migrations/20261109000000_dulabs_agente_runtime.sql
--   (dulabs_mensajes_log mínima, ver la prueba del Bloque 13) \i supabase/migrations/20261113000000_dulabs_agente_trazas.sql
--   \i supabase/migrations/20261114000000_dulabs_agente_limites.sql   (dos veces: idempotente)
--   \i supabase/tests/20261114000000_dulabs_agente_limites.test.sql

\set ON_ERROR_STOP 1

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  r record;
begin
  -- 1. La columna limites existe con default {} y solo acepta objetos.
  insert into dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, proveedor, modelo, credencial_ref, herramientas)
  values (a, 'PN-L', 'catalog_sales', 'gemini', 'gemini-3.6-flash', 'env:GEMINI_KEY_X', '{search_products}');
  if (select limites from dulabs_agente_runtime_config where phone_number_id = 'PN-L') <> '{}'::jsonb then raise exception 'FAIL 1a default'; end if;
  begin
    update dulabs_agente_runtime_config set limites = '[1,2]' where phone_number_id = 'PN-L';
    raise exception 'FAIL 1b arreglo aceptado';
  exception when check_violation then null;
  end;
  raise notice 'PASS 1 columna limites';

  -- 2. Consumo: solo turnos que llamaron al modelo (rounds > 0), por cliente (minuto / 24 h) y tokens del negocio (24 h).
  insert into dulabs_agente_trazas (id_tenant, phone_number_id, contact_ref, tipo, resultado, traza, created_at) values
    (a, 'PN-L', '19c2d12f32b3', 'turn', 'replied', '{"rounds":2,"usage":{"input":3000,"output":200,"thinking":50}}', now() - interval '10 seconds'),
    (a, 'PN-L', '19c2d12f32b3', 'turn', 'replied', '{"rounds":1,"usage":{"input":2000,"output":100,"thinking":0}}', now() - interval '20 seconds'),
    (a, 'PN-L', '19c2d12f32b3', 'turn', 'replied', '{"rounds":1,"usage":{"input":1000,"output":100,"thinking":0}}', now() - interval '2 hours'),
    (a, 'PN-L', '19c2d12f32b3', 'turn', 'duplicate', '{"rounds":0}', now()),
    (a, 'PN-L', '19c2d12f32b3', 'turn', 'replied', '{"rounds":1,"usage":{"input":9999,"output":1,"thinking":0}}', now() - interval '2 days'),
    (a, 'PN-L', '6f0de8d1a5c0', 'turn', 'replied', '{"rounds":1,"usage":{"input":500,"output":50,"thinking":0}}', now()),
    (a, 'PN-L', '19c2d12f32b3', 'boundary', 'invalid_config', '{"reason":"x"}', now()),
    (b, 'PN-B', '19c2d12f32b3', 'turn', 'replied', '{"rounds":1,"usage":{"input":777777,"output":0,"thinking":0}}', now());
  select * into r from dulabs_agente_consumo(a, 'PN-L', '19c2d12f32b3');
  if r.turnos_minuto_cliente <> 2 then raise exception 'FAIL 2a minuto %', r.turnos_minuto_cliente; end if;
  if r.turnos_dia_cliente <> 3 then raise exception 'FAIL 2b día %', r.turnos_dia_cliente; end if;
  if r.tokens_dia_negocio <> 3250 + 2100 + 1100 + 550 then raise exception 'FAIL 2c tokens %', r.tokens_dia_negocio; end if;
  raise notice 'PASS 2 consumo por cliente y por negocio (sin otros negocios, sin turnos sin modelo)';
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.dulabs_agente_consumo(uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_agente_consumo(uuid, text, text)', 'execute') then
    raise exception 'FAIL 3 anon/authenticated pueden leer el consumo';
  end if;
  raise notice 'PASS 3 solo el backend (service_role)';
end;
$$;
