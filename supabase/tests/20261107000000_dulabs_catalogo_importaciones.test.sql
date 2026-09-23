-- Catálogo DuLabs, Fase 4 — verificación de 20261107000000_dulabs_catalogo_importaciones.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO. NUNCA en Supabase: este script
-- INSERTA productos e importaciones de prueba.
--
-- Preparación (PostgreSQL 16 local, base vacía), igual que la Fase 1:
--   create role service_role;
--   create schema storage;
--   create table storage.buckets (id text primary key, name text, public boolean);
--   \i supabase/migrations/20260923000000_amore_inventario_productos.sql
--   \i supabase/migrations/20261007000000_amore_inventario_ventas.sql
--   insert into dulabs_inventario_productos (id, id_tenant, nombre, precio, stock) values
--    ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Anillo existente',50000,3);
--   \i supabase/migrations/20261105000000_dulabs_catalogo_fase1.sql
--   \i supabase/migrations/20261106000000_dulabs_catalogo_publicacion.sql
--   \i supabase/migrations/20261107000000_dulabs_catalogo_importaciones.sql
--   \i supabase/migrations/20261107000000_dulabs_catalogo_importaciones.sql   -- idempotente: 2.ª vez sin error
--   \i supabase/tests/20261107000000_dulabs_catalogo_importaciones.test.sql
-- Cada bloque imprime "PASS n ..." o aborta con "FAIL n".

\set ON_ERROR_STOP 1

do $$
declare
  t1 constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t2 constant uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  imp1 uuid;
  imp2 uuid;
  ref_existente text;
  r1 text;
  r2 text;
  n int;
begin
  select referencia into ref_existente from dulabs_inventario_productos where id = '11111111-0000-0000-0000-000000000001';

  -- 1. El producto existente queda intacto (sin importación, misma referencia).
  select count(*) into n from dulabs_inventario_productos
   where id = '11111111-0000-0000-0000-000000000001' and importacion_id is null and importacion_fila is null and referencia = 'DL-000001';
  if n <> 1 then raise exception 'FAIL 1 producto existente alterado'; end if;
  raise notice 'PASS 1 productos existentes intactos (importacion_* NULL, referencia igual)';

  -- 2. Crear importación + producto importado: la referencia la asigna el trigger, no el caller.
  insert into dulabs_catalogo_importaciones (id_tenant, archivo, total_filas) values (t1, 'productos.xlsx', 3) returning id into imp1;
  insert into dulabs_inventario_productos (id_tenant, nombre, precio, stock, controla_stock, importacion_id, importacion_fila, referencia)
  values (t1, 'Aretes perla', 42000, 5, true, imp1, 2, 'XX-999999') returning referencia into r1;
  if r1 <> 'DL-000002' then raise exception 'FAIL 2 referencia inesperada %', r1; end if;
  raise notice 'PASS 2 producto importado con referencia del trigger (%)', r1;

  -- 3. Reintento de la MISMA fila de la MISMA importación => choca (idempotencia).
  begin
    insert into dulabs_inventario_productos (id_tenant, nombre, precio, stock, importacion_id, importacion_fila)
    values (t1, 'Aretes perla', 42000, 5, imp1, 2);
    raise exception 'FAIL 3 se permitió duplicar la fila importada';
  exception when unique_violation then
    raise notice 'PASS 3 reintento de la misma fila rechazado (unique_violation)';
  end;

  -- 4. importacion_id sin fila (o al revés) => rechazado.
  begin
    insert into dulabs_inventario_productos (id_tenant, nombre, precio, stock, importacion_id) values (t1, 'X', 1, 1, imp1);
    raise exception 'FAIL 4 importacion_id sin fila aceptado';
  exception when check_violation then
    raise notice 'PASS 4 importacion_id y importacion_fila van juntas';
  end;

  -- 5. Un producto NO puede apuntar a la importación de otro tenant.
  insert into dulabs_catalogo_importaciones (id_tenant, archivo) values (t2, 'otro.csv') returning id into imp2;
  begin
    insert into dulabs_inventario_productos (id_tenant, nombre, precio, stock, importacion_id, importacion_fila) values (t1, 'Intruso', 1, 1, imp2, 2);
    raise exception 'FAIL 5 producto ligado a importación de otro tenant';
  exception when foreign_key_violation then
    raise notice 'PASS 5 importación de otro tenant rechazada (FK compuesta)';
  end;

  -- 6. Otro tenant, misma fila: independiente (su propia secuencia de referencias).
  insert into dulabs_inventario_productos (id_tenant, nombre, precio, stock, importacion_id, importacion_fila)
  values (t2, 'Anillo', 1, 1, imp2, 2) returning referencia into r2;
  if r2 <> 'DL-000001' then raise exception 'FAIL 6 referencia de otro tenant %', r2; end if;
  raise notice 'PASS 6 cada tenant con su secuencia (%)', r2;

  -- 7. La referencia de un producto importado sigue siendo inmutable.
  begin
    update dulabs_inventario_productos set referencia = 'DL-777777' where referencia = r1 and id_tenant = t1;
    raise exception 'FAIL 7 referencia modificada';
  exception when others then
    if sqlerrm <> 'referencia_inmutable' then raise; end if;
    raise notice 'PASS 7 referencia inmutable también en productos importados';
  end;

  -- 8. Estado y contadores validados.
  begin
    update dulabs_catalogo_importaciones set estado = 'borrada' where id = imp1;
    raise exception 'FAIL 8 estado inválido aceptado';
  exception when check_violation then
    raise notice 'PASS 8 estado restringido (procesando | completada)';
  end;
  begin
    update dulabs_catalogo_importaciones set creados = -1 where id = imp1;
    raise exception 'FAIL 8b contador negativo aceptado';
  exception when check_violation then
    raise notice 'PASS 8b contadores nunca negativos';
  end;

  -- 9. El producto existente sigue igual después de todo.
  select count(*) into n from dulabs_inventario_productos where id = '11111111-0000-0000-0000-000000000001' and referencia = ref_existente and nombre = 'Anillo existente';
  if n <> 1 then raise exception 'FAIL 9'; end if;
  raise notice 'PASS 9 producto existente intacto al final';
end;
$$;
