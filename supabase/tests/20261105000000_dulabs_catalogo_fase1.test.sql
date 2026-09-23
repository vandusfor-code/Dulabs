-- Catálogo DuLabs, Fase 1 — verificación de 20261105000000_dulabs_catalogo_fase1.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO. NUNCA en Supabase (producción
-- comparte base con AMORE): este script INSERTA productos, categorías, media y
-- ventas de prueba y deshabilita/rehabilita un trigger.
--
-- Preparación (PostgreSQL 16 local, base vacía):
--   create role service_role;
--   create schema storage;
--   create table storage.buckets (id text primary key, name text, public boolean);
--   \i supabase/migrations/20260923000000_amore_inventario_productos.sql
--   \i supabase/migrations/20261007000000_amore_inventario_ventas.sql
--   insert into dulabs_inventario_productos (id, id_tenant, nombre, precio, stock, created_at) values
--    ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Esmalte rojo',12000,5, now() - interval '3 days'),
--    ('11111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Esmalte azul',12000,0, now() - interval '2 days'),
--    ('11111111-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Lima',3000,10, now() - interval '1 days'),
--    ('22222222-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Anillo',50000,1, now());
--   \i supabase/migrations/20261105000000_dulabs_catalogo_fase1.sql
--   \i supabase/tests/20261105000000_dulabs_catalogo_fase1.test.sql
-- Cada bloque imprime "PASS n ..." o aborta con "FAIL n".
--
-- Concurrencia (fuera de este archivo): 40 sesiones psql en paralelo x 25
-- INSERT del mismo tenant => 1000 filas, 1000 referencias distintas,
-- DL-000001..DL-001000 sin huecos, contador = 1000, 0 errores (verificado
-- el 22-sep-2026 en PostgreSQL 16.13).

\set ON_ERROR_STOP 1
-- Aserciones de la migración del Catálogo contra una BD LOCAL efímera.
-- Cada bloque lanza excepción si una regla no se cumple.

-- 1. Referencia automática: un INSERT legado (AMORE/Business Agent, sin
--    columnas nuevas) recibe la siguiente referencia; un valor enviado por el
--    caller se ignora.
insert into dulabs_inventario_productos (id, id_tenant, nombre, precio, stock)
values ('11111111-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'Base coat', 9000, 3);
insert into dulabs_inventario_productos (id, id_tenant, nombre, precio, stock, referencia)
values ('11111111-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', 'Top coat', 9000, 3, 'DL-999999');
do $$ begin
  if (select referencia from dulabs_inventario_productos where id = '11111111-0000-0000-0000-000000000004') <> 'DL-000004' then raise exception 'FAIL 1a'; end if;
  if (select referencia from dulabs_inventario_productos where id = '11111111-0000-0000-0000-000000000005') <> 'DL-000005' then raise exception 'FAIL 1b: el caller no debe decidir la referencia'; end if;
  if (select controla_stock from dulabs_inventario_productos where id = '11111111-0000-0000-0000-000000000004') is not true then raise exception 'FAIL 1c: default controla_stock'; end if;
  raise notice 'PASS 1 referencia automática, valor del caller ignorado, controla_stock=true por defecto';
end $$;

-- 2. Referencia inmutable.
do $$ begin
  begin
    update dulabs_inventario_productos set referencia = 'DL-000777' where id = '11111111-0000-0000-0000-000000000004';
    raise exception 'FAIL 2: se permitió cambiar la referencia';
  exception when sqlstate 'CT001' then null;
  end;
  raise notice 'PASS 2 referencia inmutable (CT001)';
end $$;

-- 3. Formato sin truncar a partir de 1.000.000.
do $$ begin
  if dulabs_catalogo_formatear_referencia('DL', 1) <> 'DL-000001' then raise exception 'FAIL 3a'; end if;
  if dulabs_catalogo_formatear_referencia('DL', 999999) <> 'DL-999999' then raise exception 'FAIL 3b'; end if;
  if dulabs_catalogo_formatear_referencia('DL', 1000000) <> 'DL-1000000' then raise exception 'FAIL 3c: truncó'; end if;
  raise notice 'PASS 3 formato de referencia sin truncamiento';
end $$;

-- 4. Auditoría: creado con actor, actualización del Catálogo con actor,
--    actualización legada sin actor (y updated_by limpio), no-op sin evento.
insert into dulabs_inventario_productos (id, id_tenant, nombre, precio, stock, controla_stock, created_by, updated_by, escritura_id)
values ('33333333-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', 'Dije corazón', 35000, 0, false,
        'dddddddd-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-00000000000a', gen_random_uuid());
update dulabs_inventario_productos
  set precio_mayor = 18000, updated_by = 'dddddddd-0000-0000-0000-00000000000b', escritura_id = gen_random_uuid(), updated_at = now()
  where id = '33333333-0000-0000-0000-000000000001';
update dulabs_inventario_productos set nombre = 'Dije corazón oro', updated_at = now()
  where id = '33333333-0000-0000-0000-000000000001';
update dulabs_inventario_productos set updated_at = now() where id = '33333333-0000-0000-0000-000000000001';
do $$
declare
  v_creado record; v_cat record; v_leg record; v_total int; v_ref text;
begin
  select referencia into v_ref from dulabs_inventario_productos where id = '33333333-0000-0000-0000-000000000001';
  if v_ref <> 'DL-000001' then raise exception 'FAIL 4a: tenant nuevo debe empezar en DL-000001, fue %', v_ref; end if;
  select count(*) into v_total from dulabs_catalogo_eventos where producto_id = '33333333-0000-0000-0000-000000000001';
  if v_total <> 3 then raise exception 'FAIL 4b: esperaba 3 eventos (creado, actualizado catálogo, actualizado legado), hubo %', v_total; end if;
  select * into v_creado from dulabs_catalogo_eventos where producto_id = '33333333-0000-0000-0000-000000000001' and accion = 'creado';
  if v_creado.actor_user_id <> 'dddddddd-0000-0000-0000-00000000000a' then raise exception 'FAIL 4c: actor creado'; end if;
  if v_creado.cambios ? 'escritura_id' then raise exception 'FAIL 4d: columnas técnicas en la auditoría'; end if;
  select * into v_cat from dulabs_catalogo_eventos where producto_id = '33333333-0000-0000-0000-000000000001' and accion = 'actualizado' and cambios ? 'precio_mayor';
  if v_cat.actor_user_id <> 'dddddddd-0000-0000-0000-00000000000b' then raise exception 'FAIL 4e: actor actualización catálogo'; end if;
  if (v_cat.cambios -> 'precio_mayor' ->> 'despues')::int <> 18000 or (v_cat.cambios -> 'precio_mayor' -> 'antes') <> 'null'::jsonb then raise exception 'FAIL 4f: diff'; end if;
  select * into v_leg from dulabs_catalogo_eventos where producto_id = '33333333-0000-0000-0000-000000000001' and accion = 'actualizado' and cambios ? 'nombre';
  if v_leg.actor_user_id is not null then raise exception 'FAIL 4g: una escritura legada no debe atribuirse al último usuario'; end if;
  if (select updated_by from dulabs_inventario_productos where id = '33333333-0000-0000-0000-000000000001') is not null then raise exception 'FAIL 4h: updated_by debe limpiarse'; end if;
  raise notice 'PASS 4 auditoría (actor correcto, diff, sin atribución falsa, no-op sin evento)';
end $$;

-- 5. created_by no se puede reescribir.
update dulabs_inventario_productos set created_by = 'eeeeeeee-0000-0000-0000-00000000000e', escritura_id = gen_random_uuid()
  where id = '33333333-0000-0000-0000-000000000001';
do $$ begin
  if (select created_by from dulabs_inventario_productos where id = '33333333-0000-0000-0000-000000000001') <> 'dddddddd-0000-0000-0000-00000000000a' then raise exception 'FAIL 5'; end if;
  raise notice 'PASS 5 created_by histórico inmutable';
end $$;

-- 6. Auditoría append-only.
do $$ begin
  begin update dulabs_catalogo_eventos set accion = 'creado'; raise exception 'FAIL 6a'; exception when sqlstate 'CT002' then null; end;
  begin delete from dulabs_catalogo_eventos; raise exception 'FAIL 6b'; exception when sqlstate 'CT002' then null; end;
  raise notice 'PASS 6 auditoría append-only (CT002)';
end $$;

-- 7. AMORE: el RPC de ventas sigue funcionando igual (stock se valida y se
--    descuenta en productos existentes) y queda auditado sin actor.
do $$
declare v record; v_ev record;
begin
  select * into v from dulabs_registrar_venta_producto('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 2, 'venta-1');
  if v.stock_restante <> 3 then raise exception 'FAIL 7a: stock_restante %', v.stock_restante; end if;
  begin
    perform dulabs_registrar_venta_producto('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 1, 'venta-2');
    raise exception 'FAIL 7b: debía fallar por stock';
  exception when sqlstate 'AM004' then null;
  end;
  select * into v_ev from dulabs_catalogo_eventos where producto_id = '11111111-0000-0000-0000-000000000001' order by id desc limit 1;
  if v_ev.accion <> 'actualizado' or v_ev.actor_user_id is not null or not (v_ev.cambios ? 'stock') then raise exception 'FAIL 7c: auditoría de venta'; end if;
  raise notice 'PASS 7 RPC de ventas de AMORE intacto (descuento, AM004, auditado sin actor)';
end $$;

-- 8. Categorías: FK compuesta impide usar la categoría de otro tenant;
--    nombre único por tenant sin distinguir mayúsculas.
insert into dulabs_catalogo_categorias (id, id_tenant, nombre) values
  ('44444444-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', 'Dijes'),
  ('44444444-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'Dijes');
do $$ begin
  begin
    update dulabs_inventario_productos set categoria_id = '44444444-0000-0000-0000-000000000002' where id = '33333333-0000-0000-0000-000000000001';
    raise exception 'FAIL 8a: categoría de otro tenant aceptada';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into dulabs_catalogo_categorias (id_tenant, nombre) values ('cccccccc-0000-0000-0000-000000000003', '  dijes ');
    raise exception 'FAIL 8b: duplicado de categoría';
  exception when unique_violation then null;
  end;
  update dulabs_inventario_productos set categoria_id = '44444444-0000-0000-0000-000000000001', categoria = 'Dijes', escritura_id = gen_random_uuid()
    where id = '33333333-0000-0000-0000-000000000001';
  raise notice 'PASS 8 categorías aisladas por tenant y únicas';
end $$;

-- 9. Media: principal + adicionales, sincronización de foto_url, ruta
--    obligatoriamente bajo {tenant}/{producto}/, promoción al borrar.
do $$
declare m1 record; m2 record; m3 record; v_foto text; v_borrada record;
begin
  select * into m1 from dulabs_catalogo_adjuntar_media('cccccccc-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000003/33333333-0000-0000-0000-000000000001/a.webp',
    'cccccccc-0000-0000-0000-000000000003/33333333-0000-0000-0000-000000000001/a_thumb.webp',
    'image/webp', 120000, 1600, 1600, false, 'dddddddd-0000-0000-0000-00000000000a', 'https://x.supabase.co/storage/v1/object/public/inventario-productos/');
  if not m1.es_principal then raise exception 'FAIL 9a: la primera imagen debe ser principal'; end if;
  select * into m2 from dulabs_catalogo_adjuntar_media('cccccccc-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000003/33333333-0000-0000-0000-000000000001/b.webp', null,
    'image/webp', 90000, 1200, 1200, false, 'dddddddd-0000-0000-0000-00000000000a', 'https://x.supabase.co/storage/v1/object/public/inventario-productos/');
  if m2.es_principal or m2.orden <> 1 then raise exception 'FAIL 9b: adicional'; end if;
  select * into m3 from dulabs_catalogo_adjuntar_media('cccccccc-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000003/33333333-0000-0000-0000-000000000001/c.webp', null,
    'image/webp', 80000, 1000, 1000, true, 'dddddddd-0000-0000-0000-00000000000a', 'https://x.supabase.co/storage/v1/object/public/inventario-productos/');
  if (select count(*) from dulabs_catalogo_media where producto_id = '33333333-0000-0000-0000-000000000001' and es_principal) <> 1 then raise exception 'FAIL 9c: una sola principal'; end if;
  select foto_url into v_foto from dulabs_inventario_productos where id = '33333333-0000-0000-0000-000000000001';
  if v_foto <> 'https://x.supabase.co/storage/v1/object/public/inventario-productos/cccccccc-0000-0000-0000-000000000003/33333333-0000-0000-0000-000000000001/c.webp' then raise exception 'FAIL 9d: foto_url %', v_foto; end if;
  begin
    perform dulabs_catalogo_adjuntar_media('cccccccc-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000001',
      'bbbbbbbb-0000-0000-0000-000000000002/otro/evil.webp', null, 'image/webp', 1, 1, 1, false, null, 'https://x/');
    raise exception 'FAIL 9e: ruta fuera del tenant aceptada';
  exception when check_violation then null;
  end;
  begin
    perform dulabs_catalogo_adjuntar_media('bbbbbbbb-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001',
      'bbbbbbbb-0000-0000-0000-000000000002/33333333-0000-0000-0000-000000000001/x.webp', null, 'image/webp', 1, 1, 1, false, null, 'https://x/');
    raise exception 'FAIL 9f: adjuntar a producto de otro tenant';
  exception when sqlstate 'CT003' then null;
  end;
  select * into v_borrada from dulabs_catalogo_eliminar_media('cccccccc-0000-0000-0000-000000000003', m3.id, 'dddddddd-0000-0000-0000-00000000000a', 'https://x.supabase.co/storage/v1/object/public/inventario-productos/');
  if v_borrada.storage_path not like '%/c.webp' then raise exception 'FAIL 9g'; end if;
  if not (select es_principal from dulabs_catalogo_media where id = m1.id) then raise exception 'FAIL 9h: promoción de la siguiente por orden'; end if;
  select foto_url into v_foto from dulabs_inventario_productos where id = '33333333-0000-0000-0000-000000000001';
  if v_foto not like '%/a.webp' then raise exception 'FAIL 9i: foto_url tras promoción %', v_foto; end if;
  perform dulabs_catalogo_eliminar_media('cccccccc-0000-0000-0000-000000000003', m2.id, null, 'https://x/');
  perform dulabs_catalogo_eliminar_media('cccccccc-0000-0000-0000-000000000003', m1.id, null, 'https://x/');
  if (select foto_url from dulabs_inventario_productos where id = '33333333-0000-0000-0000-000000000001') is not null then raise exception 'FAIL 9j: foto_url debe quedar null sin imágenes'; end if;
  raise notice 'PASS 9 media (principal única, orden, foto_url sincronizada, ruta aislada, promoción)';
end $$;

-- 10. Borrado físico (Business Agent) sigue funcionando: cascade de media y
--     evento 'eliminado'.
do $$
declare m record;
begin
  select * into m from dulabs_catalogo_adjuntar_media('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000003',
    'aaaaaaaa-0000-0000-0000-000000000001/11111111-0000-0000-0000-000000000003/z.webp', null, 'image/webp', 10, 10, 10, true, null, 'https://x/');
  delete from dulabs_inventario_productos where id = '11111111-0000-0000-0000-000000000003';
  if exists (select 1 from dulabs_catalogo_media where id = m.id) then raise exception 'FAIL 10a: cascade'; end if;
  if not exists (select 1 from dulabs_catalogo_eventos where producto_id = '11111111-0000-0000-0000-000000000003' and accion = 'eliminado') then raise exception 'FAIL 10b'; end if;
  raise notice 'PASS 10 borrado físico con cascade de media y evento eliminado';
end $$;

-- 11. Unicidad como segunda barrera (aunque se saltara el trigger).
do $$ begin
  begin
    alter table dulabs_inventario_productos disable trigger dulabs_catalogo_asignar_referencia;
    insert into dulabs_inventario_productos (id_tenant, nombre, precio, referencia)
      values ('aaaaaaaa-0000-0000-0000-000000000001', 'Duplicado', 1, 'DL-000001');
    raise exception 'FAIL 11: duplicado aceptado';
  exception when unique_violation then null;
  end;
  alter table dulabs_inventario_productos enable trigger dulabs_catalogo_asignar_referencia;
  raise notice 'PASS 11 UNIQUE(id_tenant, referencia) como segunda barrera';
end $$;
