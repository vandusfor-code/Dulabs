-- CMS COMERCIAL (Bloque 29) — HABILITAR el módulo cms_comercial para Delacour.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- ORDEN: correr SOLO DESPUÉS de (1) desplegar el código del CMS en producción y (2) correr la migración 20261210000000_dulabs_cms_comercial.sql. Antes, este script se niega.
--
-- QUÉ HACE: enciende el módulo para el negocio de la tienda «delacour» (una fila en dulabs_tenant_modulos). Con eso la administradora puede entrar a «Administración de tienda»
--   (cuando esté el Dashboard) y la aplicación empieza a LEER lo que ella publique.
-- QUÉ NO HACE: no crea ni publica contenido, no toca productos, precios, pedidos, la tienda, ARIA ni otros negocios. Mientras no haya nada publicado, la tienda, el carrito, los
--   pedidos y ARIA se comportan EXACTAMENTE como hasta hoy.
-- Se puede repetir sin efectos nuevos.
--
-- REVERSA (apagar el módulo; lo ya publicado queda guardado y sin efecto):
--   update public.dulabs_tenant_modulos set habilitado = false, updated_at = now()
--    where modulo = 'cms_comercial' and id_tenant = (select id_tenant from public.dulabs_catalogo_publicacion where slug = 'delacour');

do $$
declare
  v_tienda integer;
  v_tenant uuid;
begin
  -- La migración debe estar aplicada.
  if to_regclass('public.dulabs_cms_entidades') is null or to_regprocedure('public.dulabs_cms_lectura_activa(uuid)') is null then
    raise exception 'Delacour: falta aplicar la migración 20261210000000_dulabs_cms_comercial.sql antes de habilitar el módulo';
  end if;

  -- Identidad: UNA sola tienda con ese slug.
  select count(*) into v_tienda from public.dulabs_catalogo_publicacion where slug = 'delacour';
  if v_tienda <> 1 then
    raise exception 'Delacour: se esperaba exactamente UNA publicación con slug «delacour», hay %', v_tienda;
  end if;
  select id_tenant into v_tenant from public.dulabs_catalogo_publicacion where slug = 'delacour';

  -- El catálogo de ese negocio debe estar habilitado: el CMS referencia sus productos.
  if not exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'catalogo' and habilitado) then
    raise exception 'Delacour: el módulo catalogo no está habilitado; el CMS comercial necesita el catálogo';
  end if;

  insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado)
  values (v_tenant, 'cms_comercial', true)
  on conflict (id_tenant, modulo) do update set habilitado = true, updated_at = now();

  raise notice 'Delacour: módulo cms_comercial habilitado';
end $$;
