-- Bloque 13 — verificación de 20261113000000_dulabs_agente_trazas.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba).
-- Preparación: create role service_role; create role anon; create role authenticated;
--   create table dulabs_mensajes_log (id bigint generated always as identity primary key, phone_number_id text,
--     telefono_cliente text, direccion text, contenido text, origen text, wamid text unique,
--     estado_entrega text default 'enviado', error_codigo integer, error_detalle text, created_at timestamptz default now());
--   \i supabase/migrations/20261113000000_dulabs_agente_trazas.sql   (dos veces: idempotente)
--   \i supabase/tests/20261113000000_dulabs_agente_trazas.test.sql

\set ON_ERROR_STOP 1

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  r record;
  n integer;
begin
  -- Entrega real de Meta (la actualiza el webhook de estados): texto entregado; una foto falló.
  insert into dulabs_mensajes_log (phone_number_id, telefono_cliente, direccion, contenido, origen, wamid, estado_entrega, error_codigo, error_detalle) values
    ('PN-1', '573001112233', 'saliente', 'Encontré estas opciones…', 'ia', 'wamid.out.1', 'entregado', null, null),
    ('PN-1', '573001112233', 'saliente', '[imagen] Aretes Luna', 'ia', 'wamid.img.1', 'leido', null, null),
    ('PN-1', '573001112233', 'saliente', '[imagen] Aretes Sol', 'ia', 'wamid.img.2', 'fallido', 131053, 'Media upload error');

  -- 1. contact_ref con formato de hash corto (el backend solo escribe contactRef()); tipo cerrado.
  begin
    insert into dulabs_agente_trazas (id_tenant, phone_number_id, contact_ref, tipo, resultado, traza) values (a, 'PN-1', '+57 300 111 2233', 'turn', 'replied', '{}');
    raise exception 'FAIL 1a teléfono como contact_ref';
  exception when check_violation then null;
  end;
  begin
    insert into dulabs_agente_trazas (id_tenant, phone_number_id, contact_ref, tipo, resultado, traza) values (a, 'PN-1', '19c2d12f32b3', 'otro', 'x', '{}');
    raise exception 'FAIL 1b tipo libre';
  exception when check_violation then null;
  end;
  raise notice 'PASS 1 sin teléfono; tipo cerrado';

  insert into dulabs_agente_trazas (id_tenant, phone_number_id, contact_ref, tipo, wamid, resultado, traza) values
    (a, 'PN-1', '19c2d12f32b3', 'turn', 'wamid.in.1', 'replied',
     '{"stage":{"start":"inicio","end":"eligiendo"},"tool_calls":[{"name":"search_products","result":"ok"},{"name":"request_product_images","result":"ok"}],"sent":true,
       "delivery":{"text_wamid":"wamid.out.1","images":[{"reference":"DL-000004","wamid":"wamid.img.1","recorded":true},{"reference":"DL-000005","wamid":"wamid.img.2","recorded":true}]}}'),
    (a, 'PN-1', '6f0de8d1a5c0', 'turn', 'wamid.in.9', 'fallback', '{"sent":false,"error_kind":"timeout","delivery":{"text_wamid":null,"text_error":"meta_rejected 400/131030","images":[]}}'),
    (a, 'PN-1', '19c2d12f32b3', 'boundary', null, 'invalid_config', '{"reason":"credential_missing"}'),
    (b, 'PN-2', '19c2d12f32b3', 'turn', 'wamid.b.1', 'replied', '{"sent":true}');

  -- 2. Diagnóstico por teléfono: el teléfono se convierte en el mismo hash que usa el backend.
  select count(*) into n from dulabs_agente_diagnosticar(a, '+57 300 111 2233', 50);
  if n <> 2 then raise exception 'FAIL 2a filas por conversación (%)', n; end if;
  select count(*) into n from dulabs_agente_diagnosticar(a, null, 50);
  if n <> 3 then raise exception 'FAIL 2b todo el negocio (%)', n; end if;
  raise notice 'PASS 2 filtro por teléfono (hash) y por negocio';

  -- 3. Entrega REAL de Meta cruzada por wamid: texto entregado; foto 1 leída; foto 2 fallida con código.
  select * into r from dulabs_agente_diagnosticar(a, '573001112233', 50) where tipo = 'turn';
  if r.entrega_texto <> 'entregado' or r.etapa <> 'inicio -> eligiendo' or r.herramientas <> 'search_products:ok, request_product_images:ok' then raise exception 'FAIL 3a %', row_to_json(r); end if;
  if r.fotos -> 0 ->> 'estado' <> 'leido' or r.fotos -> 1 ->> 'estado' <> 'fallido' or r.fotos -> 1 ->> 'error' not like '131053%' then raise exception 'FAIL 3b %', r.fotos; end if;
  select * into r from dulabs_agente_diagnosticar(a, '573009998877', 50);
  if r.respuesta_enviada or r.error_texto <> 'meta_rejected 400/131030' or r.error <> 'timeout' then raise exception 'FAIL 3c %', row_to_json(r); end if;
  select * into r from dulabs_agente_diagnosticar(a, '573001112233', 50) where tipo = 'boundary';
  if r.error <> 'credential_missing' then raise exception 'FAIL 3d'; end if;
  raise notice 'PASS 3 entrega real de Meta y motivos de fallo';

  -- 4. Otro negocio nunca aparece; límite acotado.
  select count(*) into n from dulabs_agente_diagnosticar(a, null, 50) where wamid = 'wamid.b.1';
  if n <> 0 then raise exception 'FAIL 4 otro negocio'; end if;
  raise notice 'PASS 4 aislamiento por negocio';

  -- 5. Purga: mínimo 7 días; borra solo lo viejo.
  update dulabs_agente_trazas set created_at = now() - interval '100 days' where wamid = 'wamid.b.1';
  if dulabs_agente_trazas_purgar(90) <> 1 then raise exception 'FAIL 5a'; end if;
  if dulabs_agente_trazas_purgar(1) <> 0 then raise exception 'FAIL 5b mínimo 7 días'; end if;
  raise notice 'PASS 5 purga';
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.dulabs_agente_trazas', 'select')
     or has_table_privilege('authenticated', 'public.dulabs_agente_trazas', 'select')
     or has_function_privilege('anon', 'public.dulabs_agente_diagnosticar(uuid, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_agente_trazas_purgar(integer)', 'execute') then
    raise exception 'FAIL 6 anon/authenticated con acceso';
  end if;
  raise notice 'PASS 6 solo el backend (service_role)';
end;
$$;
