-- Bloque 21 — verificación de 20261118000000_dulabs_catalogo_pedidos_historial.sql
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO con las migraciones del catálogo aplicadas
--     (ver supabase/tests/20261116000000_dulabs_catalogo_reservas_stock.test.sql). Datos FICTICIOS.
--   \i supabase/migrations/20261118000000_dulabs_catalogo_pedidos_historial.sql   (dos veces: idempotente)
--   \i supabase/tests/20261118000000_dulabs_catalogo_pedidos_historial.test.sql
\set ON_ERROR_STOP 1

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-0000000000d1';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-0000000000d2';
  plan text;
  linea text;
  n integer;
  c timestamptz;
  p text;
begin
  if not exists (select 1 from pg_indexes where indexname = 'dulabs_catalogo_pedidos_historial_idx') then
    raise exception 'FAIL 1 falta el índice';
  end if;
  raise notice 'PASS 1 índice creado';

  alter table public.dulabs_catalogo_pedidos disable trigger user;
  insert into public.dulabs_catalogo_pedidos (id_tenant, pedido_publico, canal, origen, estado, clave_idempotencia, contacto_phone_number_id, contacto_wa_id, lineas, total_unidades, total, unidades_sin_precio, moneda, created_at, updated_at)
  select t, 'DL-ORD-' || lpad(upper(to_hex(g)), 6, '0'), 'retail', 'agent',
         (array['completed','cancelled','expired','confirmed'])[1 + g % 4], 'hist-test-' || t || '-' || g, 'PN-T', '5730' || lpad(g::text, 8, '0'),
         '[]'::jsonb, 0, 0, 0, 'COP',
         timestamp '2026-01-01' + (g / 3) * interval '1 minute', now()
    from (values (a), (b)) v(t), generate_series(1, 3000) g;
  alter table public.dulabs_catalogo_pedidos enable trigger user;
  analyze public.dulabs_catalogo_pedidos;

  -- 2. La consulta del historial (primera página y con cursor) usa el índice, sin ordenar todo.
  plan := '';
  for linea in execute format($q$explain select pedido_publico from public.dulabs_catalogo_pedidos where id_tenant = %L and estado in ('completed','cancelled','expired') order by created_at desc, pedido_publico desc limit 26$q$, a) loop
    plan := plan || linea || E'\n';
  end loop;
  if plan not like '%dulabs_catalogo_pedidos_historial_idx%' then raise exception 'FAIL 2a no usa el índice: %', plan; end if;
  select created_at, pedido_publico into c, p from public.dulabs_catalogo_pedidos where id_tenant = a and estado in ('completed','cancelled','expired') order by created_at desc, pedido_publico desc offset 1000 limit 1;
  plan := '';
  for linea in execute format($q$explain select pedido_publico from public.dulabs_catalogo_pedidos where id_tenant = %L and estado in ('completed','cancelled','expired') and created_at <= %L and (created_at < %L or pedido_publico < %L) order by created_at desc, pedido_publico desc limit 26$q$, a, c, c, p) loop
    plan := plan || linea || E'\n';
  end loop;
  if plan not like '%dulabs_catalogo_pedidos_historial_idx%' then raise exception 'FAIL 2b cursor sin índice: %', plan; end if;
  raise notice 'PASS 2 historial por índice (primera página y con cursor)';

  -- 3. Recorrer TODO el historial por cursor: cada pedido cerrado aparece exactamente una vez, en orden,
  --    solo del negocio pedido (muchos pedidos comparten created_at: el desempate por número público cuenta).
  create temp table vistos (pedido text, orden int) on commit drop;
  c := null; p := null; n := 0;
  loop
    with pagina as (
      select pedido_publico, created_at from public.dulabs_catalogo_pedidos
       where id_tenant = a and estado in ('completed','cancelled','expired')
         and (c is null or (created_at <= c and (created_at < c or pedido_publico < p)))
       order by created_at desc, pedido_publico desc limit 26
    ), ins as (insert into vistos select pedido_publico, n from pagina returning 1)
    select count(*) into n from ins;
    exit when n = 0;
    select created_at, pedido_publico into c, p from (
      select v.pedido, x.created_at, x.pedido_publico from vistos v join public.dulabs_catalogo_pedidos x on x.id_tenant = a and x.pedido_publico = v.pedido
    ) z order by created_at asc, pedido_publico asc limit 1;
  end loop;
  select count(*) into n from vistos;
  if n <> (select count(*) from public.dulabs_catalogo_pedidos where id_tenant = a and estado in ('completed','cancelled','expired')) then raise exception 'FAIL 3a faltan o sobran: %', n; end if;
  if exists (select pedido from vistos group by pedido having count(*) > 1) then raise exception 'FAIL 3b repetidos'; end if;
  raise notice 'PASS 3 el cursor recorre todo el historial sin repetir ni saltar (% pedidos)', n;

  delete from public.dulabs_catalogo_pedidos where clave_idempotencia like 'hist-test-%';
end;
$$;
