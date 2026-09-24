-- Bloque 17 — verificación de 20261115000000_dulabs_agente_diagnostico_intencion.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba).
-- Preparación: roles service_role/anon/authenticated y dulabs_mensajes_log mínima (ver la prueba
-- del Bloque 13), luego:
--   \i supabase/migrations/20261113000000_dulabs_agente_trazas.sql
--   \i supabase/migrations/20261115000000_dulabs_agente_diagnostico_intencion.sql   (dos veces: idempotente)
--   \i supabase/tests/20261115000000_dulabs_agente_diagnostico_intencion.test.sql

\set ON_ERROR_STOP 1

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  r record;
  n integer;
begin
  -- contact_ref de '573001112233' = 19c2d12f32b3 (mismo hash que lib/catalogo/pedidos/log.ts).
  insert into dulabs_agente_trazas (id_tenant, phone_number_id, contact_ref, tipo, wamid, resultado, traza, created_at) values
    (a, 'PN-D', '19c2d12f32b3', 'turn', 'wamid.d.1', 'replied', '{"intent":"search","tool_calls":[{"name":"search_products","result":"ok"}],"sent":true}', now() - interval '5 minutes'),
    (a, 'PN-D', '19c2d12f32b3', 'turn', 'wamid.d.2', 'replied', '{"intent":"more_results","sent":true}', now() - interval '4 minutes'),
    (a, 'PN-D', '19c2d12f32b3', 'turn', 'wamid.d.3', 'handoff', '{"intent":"handoff","handoff":{"source":"customer","motive":"customer_request"},"sent":true}', now() - interval '3 minutes'),
    (a, 'PN-D', '19c2d12f32b3', 'turn', 'wamid.d.4', 'handoff', '{"intent":"handoff","handoff":{"source":"model","motive":"complaint"},"order_id":"DL-ORD-7K2M9Q"}', now() - interval '2 minutes'),
    (a, 'PN-D', '19c2d12f32b3', 'turn', 'wamid.d.5', 'handoff', '{"sent":true}', now() - interval '1 minute'),
    (a, 'PN-D', '19c2d12f32b3', 'turn', 'wamid.d.6', 'replied', '{"intent":"hackeado","handoff":{"source":"x","motive":"<script>"}}', now() - interval '30 seconds'),
    (a, 'PN-D', '19c2d12f32b3', 'turn', 'wamid.d.7', 'duplicate', '{"intent":null}', now() - interval '20 seconds'),
    (a, 'PN-D', '19c2d12f32b3', 'boundary', null, 'invalid_config', '{"reason":"credential_missing"}', now() - interval '10 seconds'),
    (b, 'PN-E', '19c2d12f32b3', 'turn', 'wamid.e.1', 'handoff', '{"intent":"handoff","handoff":{"source":"customer","motive":"customer_request"}}', now());

  -- 1. Intención en español, de la lista cerrada.
  select * into r from dulabs_agente_diagnosticar(a, '573001112233', 50) where wamid = 'wamid.d.1';
  if r.intencion <> 'buscar' or r.asesora_motivo is not null or r.asesora_origen is not null then raise exception 'FAIL 1a %', row_to_json(r); end if;
  select * into r from dulabs_agente_diagnosticar(a, '573001112233', 50) where wamid = 'wamid.d.2';
  if r.intencion <> 'ver_mas' then raise exception 'FAIL 1b %', r.intencion; end if;
  select * into r from dulabs_agente_diagnosticar(a, '573001112233', 50) where wamid = 'wamid.d.7';
  if r.intencion is not null then raise exception 'FAIL 1c sin modelo => sin intención (%)', r.intencion; end if;
  raise notice 'PASS 1 intención';

  -- 2. Motivo de la asesora y quién lo decidió.
  select * into r from dulabs_agente_diagnosticar(a, '573001112233', 50) where wamid = 'wamid.d.3';
  if r.intencion <> 'asesora' or r.asesora_motivo <> 'cliente_pidio_asesora' or r.asesora_origen <> 'cliente' then raise exception 'FAIL 2a %', row_to_json(r); end if;
  select * into r from dulabs_agente_diagnosticar(a, '573001112233', 50) where wamid = 'wamid.d.4';
  if r.asesora_motivo <> 'reclamo' or r.asesora_origen <> 'asistente' or r.pedido <> 'DL-ORD-7K2M9Q' then raise exception 'FAIL 2b %', row_to_json(r); end if;
  select * into r from dulabs_agente_diagnosticar(a, '573001112233', 50) where wamid = 'wamid.d.5';
  if r.asesora_motivo <> 'sin_detalle' or r.asesora_origen <> 'asistente' then raise exception 'FAIL 2c traspaso anterior al Bloque 16 %', row_to_json(r); end if;
  raise notice 'PASS 2 motivo y origen';

  -- 3. Lista cerrada: nada fuera de la lista sale tal cual.
  select * into r from dulabs_agente_diagnosticar(a, '573001112233', 50) where wamid = 'wamid.d.6';
  if r.intencion <> 'desconocida' or r.asesora_motivo <> 'sin_detalle' or r.asesora_origen is not null then raise exception 'FAIL 3 %', row_to_json(r); end if;
  select * into r from dulabs_agente_diagnosticar(a, '573001112233', 50) where tipo = 'boundary';
  if r.intencion is not null or r.asesora_motivo is not null or r.error <> 'credential_missing' then raise exception 'FAIL 3b %', row_to_json(r); end if;
  raise notice 'PASS 3 lista cerrada';

  -- 4. Aislamiento por negocio; sin negocio => nada; el teléfono nunca sale.
  select count(*) into n from dulabs_agente_diagnosticar(a, null, 500) where wamid = 'wamid.e.1';
  if n <> 0 then raise exception 'FAIL 4a otro negocio'; end if;
  select count(*) into n from dulabs_agente_diagnosticar(null, null, 500);
  if n <> 0 then raise exception 'FAIL 4b sin negocio devolvió %', n; end if;
  select count(*) into n from dulabs_agente_diagnosticar(a, '573001112233', 500) d where row_to_json(d)::text like '%573001112233%';
  if n <> 0 then raise exception 'FAIL 4c el teléfono aparece en la salida'; end if;
  raise notice 'PASS 4 aislamiento y sin teléfono';
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.dulabs_agente_diagnosticar(uuid, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_agente_diagnosticar(uuid, text, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.dulabs_agente_diagnosticar(uuid, text, integer)', 'execute') then
    raise exception 'FAIL 5 permisos';
  end if;
  raise notice 'PASS 5 solo el backend (service_role)';
end;
$$;
