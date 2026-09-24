-- Bloque 25 — verificación de 20261120000000_dulabs_catalogo_clientes_canal.sql
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO con las migraciones del catálogo aplicadas. Datos FICTICIOS.
--   \i supabase/migrations/20261120000000_dulabs_catalogo_clientes_canal.sql   (dos veces: idempotente)
--   \i supabase/tests/20261120000000_dulabs_catalogo_clientes_canal.test.sql
\set ON_ERROR_STOP 1

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-0000000000e1';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-0000000000e2';
  r jsonb;
  n integer;
  err text;
begin
  delete from public.dulabs_clientes_config where phone_number_id in ('PN-B25-A', 'PN-B25-B');
  insert into public.dulabs_clientes_config (id_tenant, phone_number_id) values (a, 'PN-B25-A'), (b, 'PN-B25-B');

  -- 1. El interruptor existe y está APAGADO por defecto (el piloto no cambia al aplicar la migración).
  if (select column_default from information_schema.columns
       where table_name = 'dulabs_agente_runtime_config' and column_name = 'clasificacion_cliente') is distinct from 'false' then
    raise exception 'FAIL 1 clasificacion_cliente no es false por defecto';
  end if;
  raise notice 'PASS 1 interruptor apagado por defecto';

  -- 2. Primera clasificación por el cliente: fija una vez y deja evento.
  r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '573000000001', 'retail', 'cliente', null, null, null);
  if r->>'resultado' <> 'fijado' or r->>'canal' <> 'retail' then raise exception 'FAIL 2a %', r; end if;
  select count(*) into n from public.dulabs_catalogo_clientes_canal_eventos where phone_number_id = 'PN-B25-A' and wa_id = '573000000001';
  if n <> 1 then raise exception 'FAIL 2b eventos=%', n; end if;
  raise notice 'PASS 2 primera clasificación con evento';

  -- 3. Una segunda "primera clasificación" (el cliente pide mayorista) NO pisa la existente.
  r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '573000000001', 'wholesale', 'cliente', null, null, null);
  if r->>'resultado' <> 'conflicto' or r->>'canal' <> 'retail' then raise exception 'FAIL 3a %', r; end if;
  r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '573000000001', 'wholesale', 'catalogo_mayorista', null, null, null);
  if r->>'resultado' <> 'conflicto' or r->>'canal' <> 'retail' then raise exception 'FAIL 3b %', r; end if;
  if (select canal from public.dulabs_catalogo_clientes_canal where phone_number_id = 'PN-B25-A' and wa_id = '573000000001') <> 'retail' then
    raise exception 'FAIL 3c cambió el canal';
  end if;
  raise notice 'PASS 3 la primera clasificación nunca se pisa';

  -- 4. Un cambio sin asesora identificada se rechaza (42501); también origen 'cliente' con esperado.
  begin
    r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '573000000001', 'wholesale', 'cliente', null, null, 'retail');
    raise exception 'FAIL 4a aceptó cambio del cliente';
  exception when insufficient_privilege then null; end;
  begin
    r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '573000000001', 'wholesale', 'asesora', null, null, 'retail');
    raise exception 'FAIL 4b aceptó asesora sin miembro';
  exception when insufficient_privilege then null; end;
  begin
    r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '573000000009', 'retail', 'asesora', null, null, null);
    raise exception 'FAIL 4c primera clasificación con origen asesora sin esperado';
  exception when invalid_parameter_value then null; end;
  raise notice 'PASS 4 solo una asesora identificada cambia el canal';

  -- 5. Cambio por asesora con compare-and-set: si ella vio otro canal, conflicto sin cambio.
  r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '573000000001', 'wholesale', 'asesora', 7, 'x', 'wholesale');
  if r->>'resultado' <> 'conflicto' or r->>'canal' <> 'retail' then raise exception 'FAIL 5a %', r; end if;
  r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '573000000001', 'wholesale', 'asesora', 7, 'Cliente con NIT, compra por docena', 'retail');
  if r->>'resultado' <> 'cambiado' or r->>'canal' <> 'wholesale' or r->>'origen' <> 'asesora' then raise exception 'FAIL 5b %', r; end if;
  if not exists (select 1 from public.dulabs_catalogo_clientes_canal_eventos
                  where phone_number_id = 'PN-B25-A' and wa_id = '573000000001' and canal_anterior = 'retail'
                    and canal_nuevo = 'wholesale' and miembro_id = 7 and motivo like 'Cliente con NIT%') then
    raise exception 'FAIL 5c sin evento trazable';
  end if;
  r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '573000000001', 'wholesale', 'asesora', 7, null, 'wholesale');
  if r->>'resultado' <> 'sin_cambio' then raise exception 'FAIL 5d %', r; end if;
  select count(*) into n from public.dulabs_catalogo_clientes_canal_eventos where phone_number_id = 'PN-B25-A' and wa_id = '573000000001';
  if n <> 2 then raise exception 'FAIL 5e eventos=%', n; end if;
  raise notice 'PASS 5 cambio explícito, con compare-and-set y bitácora';

  -- 6. Asesora clasifica a un contacto sin canal (esperado 'ninguno'); con 'ninguno' sobre uno ya clasificado: conflicto.
  r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '573000000002', 'wholesale', 'asesora', 7, null, 'ninguno');
  if r->>'resultado' <> 'cambiado' or r->>'canal' <> 'wholesale' then raise exception 'FAIL 6a %', r; end if;
  r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '573000000002', 'retail', 'asesora', 7, null, 'ninguno');
  if r->>'resultado' <> 'conflicto' then raise exception 'FAIL 6b %', r; end if;
  raise notice 'PASS 6 esperado ninguno';

  -- 7. Aislamiento: un negocio no clasifica ni cambia contactos de un número ajeno.
  begin
    r := public.dulabs_catalogo_cliente_canal_fijar(b, 'PN-B25-A', '573000000003', 'wholesale', 'cliente', null, null, null);
    raise exception 'FAIL 7a clasificó en número ajeno';
  exception when insufficient_privilege then null; end;
  begin
    r := public.dulabs_catalogo_cliente_canal_fijar(b, 'PN-B25-A', '573000000001', 'retail', 'asesora', 9, null, 'wholesale');
    raise exception 'FAIL 7b cambió en número ajeno';
  exception when insufficient_privilege then null; end;
  if (select canal from public.dulabs_catalogo_clientes_canal where phone_number_id = 'PN-B25-A' and wa_id = '573000000001') <> 'wholesale' then
    raise exception 'FAIL 7c';
  end if;
  raise notice 'PASS 7 aislamiento entre negocios';

  -- 8. Entradas inválidas.
  begin
    r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '573000000004', 'vip', 'cliente', null, null, null);
    raise exception 'FAIL 8a canal inválido';
  exception when invalid_parameter_value then null; end;
  begin
    r := public.dulabs_catalogo_cliente_canal_fijar(a, 'PN-B25-A', '57-300', 'retail', 'cliente', null, null, null);
    raise exception 'FAIL 8b contacto inválido';
  exception when invalid_parameter_value then null; end;
  raise notice 'PASS 8 entradas inválidas rechazadas';

  -- 9. La bitácora es inmutable.
  begin
    update public.dulabs_catalogo_clientes_canal_eventos set motivo = 'editado' where phone_number_id = 'PN-B25-A';
    raise exception 'FAIL 9a se pudo editar';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.dulabs_catalogo_clientes_canal_eventos where phone_number_id = 'PN-B25-A';
    raise exception 'FAIL 9b se pudo borrar';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS 9 bitácora inmutable';

  -- 10. RLS activa y sin acceso para anon/authenticated (ni tablas ni función).
  if not (select relrowsecurity from pg_class where relname = 'dulabs_catalogo_clientes_canal')
     or not (select relrowsecurity from pg_class where relname = 'dulabs_catalogo_clientes_canal_eventos') then
    raise exception 'FAIL 10a RLS';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'public.dulabs_catalogo_clientes_canal', 'select')
       or has_function_privilege('anon', 'public.dulabs_catalogo_cliente_canal_fijar(uuid, text, text, text, text, bigint, text, text)', 'execute') then
      raise exception 'FAIL 10b anon con acceso';
    end if;
  end if;
  raise notice 'PASS 10 RLS y permisos';

  -- Limpieza (la bitácora es inmutable: se desactiva su trigger solo para limpiar datos de prueba).
  alter table public.dulabs_catalogo_clientes_canal_eventos disable trigger dulabs_catalogo_clientes_canal_eventos_inmutables;
  delete from public.dulabs_catalogo_clientes_canal_eventos where phone_number_id in ('PN-B25-A', 'PN-B25-B');
  alter table public.dulabs_catalogo_clientes_canal_eventos enable trigger dulabs_catalogo_clientes_canal_eventos_inmutables;
  delete from public.dulabs_catalogo_clientes_canal where phone_number_id in ('PN-B25-A', 'PN-B25-B');
  delete from public.dulabs_clientes_config where phone_number_id in ('PN-B25-A', 'PN-B25-B');
end;
$$;
