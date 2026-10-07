-- CMS COMERCIAL (Bloque 29) — REVERSA de 03_sembrar_vitrina_actual.sql para Delacour.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico).
--
-- QUÉ HACE: DESPUBLICA la página principal de la tienda «delacour»: la tienda vuelve a mostrar la portada y el banner de siempre (los del código). El contenido y su
--   historial NO se borran: la página queda como borrador (se puede volver a publicar desde «Administración de tienda»).
-- SE NIEGA si la administradora ya publicó cambios (versión 2 o más) o si la página ya no está publicada: perdería su trabajo en vivo. Para despublicarla a propósito
--   (la tienda volvería a la portada del código), confirma explícitamente en la misma sesión:
--       set dulabs.confirmar_reversa_siembra = 'si';
-- No toca productos, precios, pedidos, ARIA ni otros negocios.

do $$
declare
  v_tenant uuid;
  v_e public.dulabs_cms_entidades;
  v_r jsonb;
begin
  if to_regclass('public.dulabs_cms_entidades') is null then
    raise exception 'Delacour: el CMS comercial no está instalado; no hay nada que revertir';
  end if;

  select id_tenant into v_tenant from public.dulabs_catalogo_publicacion where slug = 'delacour';
  if v_tenant is null then
    raise exception 'Delacour: no existe una publicación con slug «delacour»';
  end if;

  select * into v_e from public.dulabs_cms_entidades where id_tenant = v_tenant and tipo = 'home';
  if v_e.id is null then
    raise notice 'Delacour: no hay página principal en el CMS; nada que revertir';
    return;
  end if;
  if v_e.estado not in ('publicada', 'pausada') then
    raise notice 'Delacour: la página principal ya no está publicada (estado %); nada que revertir', v_e.estado;
    return;
  end if;
  if coalesce(v_e.version_activa, 0) > 1 and coalesce(current_setting('dulabs.confirmar_reversa_siembra', true), '') <> 'si' then
    raise exception 'Delacour: la administradora ya publicó la versión %; despublicar la página perdería su trabajo en vivo. Confirma con: set dulabs.confirmar_reversa_siembra = ''si'';', v_e.version_activa;
  end if;

  v_r := public.dulabs_cms_despublicar(v_tenant, v_e.id, null, 'Reversa de la siembra inicial (DuLabs)');
  if v_r->>'resultado' is distinct from 'ok' then
    raise exception 'Delacour: no se pudo despublicar la página principal (%)', v_r->>'resultado';
  end if;

  raise notice 'Delacour: página principal despublicada; la tienda vuelve a su portada de siempre';
end $$;
