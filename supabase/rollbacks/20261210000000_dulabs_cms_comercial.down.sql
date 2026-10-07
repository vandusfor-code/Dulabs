-- ROLLBACK de 20261210000000_dulabs_cms_comercial.sql (CMS comercial, Bloque 29).
--
-- Borra las 4 tablas y las funciones del CMS comercial y las filas del módulo `cms_comercial` en dulabs_tenant_modulos.
-- NO toca productos, pedidos, categorías, ni ninguna otra tabla; no borra archivos de Storage (las imágenes subidas quedan en el bucket).
-- Efecto en la aplicación: sin las tablas, el CMS queda apagado (la tienda vuelve a su portada del código y los precios al de lista, ARIA deja de ver ofertas).
--
-- Se NIEGA a correr si hay contenido en vivo o imágenes: perderías la portada, las ofertas, los combos y las campañas que la administradora ya publicó
-- (y su historial y auditoría). Revísalo antes. Para borrar todo A PROPÓSITO, confirma explícitamente en la misma sesión:
--     set dulabs.confirmar_borrado_cms = 'si';
-- No es una migración (vive fuera de supabase/migrations a propósito). Se ejecuta a mano, en una transacción.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_vivas integer := 0;
  v_imagenes integer := 0;
  v_borradores integer := 0;
begin
  if to_regclass('public.dulabs_cms_entidades') is not null then
    select count(*) into v_vivas from public.dulabs_cms_entidades where estado in ('publicada', 'pausada');
    select count(*) into v_borradores from public.dulabs_cms_entidades where estado = 'borrador';
  end if;
  if to_regclass('public.dulabs_cms_assets') is not null then
    select count(*) into v_imagenes from public.dulabs_cms_assets where estado = 'listo';
  end if;
  if (v_vivas > 0 or v_imagenes > 0 or v_borradores > 0) and coalesce(current_setting('dulabs.confirmar_borrado_cms', true), '') <> 'si' then
    raise exception 'el CMS comercial tiene % elementos publicados o pausados, % borradores y % imágenes: el rollback los borraría. Despublícalos antes o confirma con: set dulabs.confirmar_borrado_cms = ''si'';', v_vivas, v_borradores, v_imagenes;
  end if;
end $$;

-- Las funciones primero (dependen de las tablas).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'dulabs\_cms\_%'
  loop
    execute format('drop function if exists %s cascade', r.firma);
  end loop;
end $$;

drop table if exists public.dulabs_cms_auditoria;
drop table if exists public.dulabs_cms_assets;
-- El puntero activo y las versiones se referencian entre sí: CASCADE quita la restricción.
drop table if exists public.dulabs_cms_versiones cascade;
drop table if exists public.dulabs_cms_entidades cascade;

do $$
begin
  if to_regclass('public.dulabs_tenant_modulos') is not null then
    delete from public.dulabs_tenant_modulos where modulo = 'cms_comercial';
  end if;
end $$;

commit;
