-- CMS COMERCIAL (Bloque 29) — SEMBRAR la vitrina actual de Delacour como contenido del CMS.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- ORDEN: correr SOLO DESPUÉS del 02_habilitar_cms_comercial.sql (el módulo debe estar habilitado). Antes, este script se niega.
--
-- QUÉ HACE: crea y PUBLICA la página principal de la tienda «delacour» con la portada y el banner que la tienda ya muestra hoy (misma imagen, mismos textos, mismo
--   botón al catálogo), para que la administradora abra «Administración de tienda» y encuentre SU tienda, lista para editar. El resultado se ve IDÉNTICO al de hoy
--   (una prueba automática compara el HTML de la tienda leída del CMS con el de la tienda actual). Las secciones de ofertas, combos y campaña quedan apagadas.
--   Firma como «Siembra inicial» (sin usuario) y queda en el historial como la versión 1.
-- QUÉ NO HACE: no toca productos, precios, pedidos, ARIA ni otros negocios. No pisa nada: si la página principal ya existe en el CMS, se niega a repetirse.
--
-- GENERADO por el código (lib/cms-comercial/siembra-vitrina.ts): una prueba lo regenera y lo compara con este archivo. No se edita a mano.
--
-- REVERSA: supabase/provisioning/delacour/03_sembrar_vitrina_actual.reversa.sql (despublica la página: la tienda vuelve a mostrar su portada de siempre;
--   el contenido y su historial se conservan como borrador).

do $$
declare
  v_tienda integer;
  v_tenant uuid;
  v_r jsonb;
  v_id uuid;
begin
  -- La migración debe estar aplicada.
  if to_regclass('public.dulabs_cms_entidades') is null or to_regprocedure('public.dulabs_cms_crear(uuid, text, text, jsonb, uuid, text)') is null then
    raise exception 'Delacour: falta aplicar la migración 20261210000000_dulabs_cms_comercial.sql antes de sembrar la vitrina';
  end if;

  -- Identidad: UNA sola tienda con ese slug (el negocio sale de la publicación, nunca de un id escrito a mano).
  select count(*) into v_tienda from public.dulabs_catalogo_publicacion where slug = 'delacour';
  if v_tienda <> 1 then
    raise exception 'Delacour: se esperaba exactamente UNA publicación con slug «delacour», hay %', v_tienda;
  end if;
  select id_tenant into v_tenant from public.dulabs_catalogo_publicacion where slug = 'delacour';

  -- El módulo debe estar habilitado (script 02).
  if not exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'cms_comercial' and habilitado) then
    raise exception 'Delacour: el módulo cms_comercial no está habilitado; corre primero 02_habilitar_cms_comercial.sql';
  end if;

  -- No se pisa nada: si ya hay una página principal (sembrada antes o creada por la administradora), no se toca.
  if exists (select 1 from public.dulabs_cms_entidades where id_tenant = v_tenant and tipo = 'home') then
    raise notice 'Delacour: la página principal ya existe en el CMS; no se siembra nada';
    return;
  end if;

  v_r := public.dulabs_cms_crear(v_tenant, 'home', 'home', $cms_json${"banner":{"imagen":{"alt":"El regalo perfecto siempre es una joya. Hacé cada momento inolvidable.","alto":724,"ancho":2172,"origen":"estatico","src":"/catalogo/delacour/regalojoyeriapantalla1.png"},"visible":true},"categorias_destacadas":[],"portada":{"boton":{"destino":{"tipo":"catalogo"},"texto":"Ver catálogo"},"etiqueta":"Más que joyas","imagen":{"alt":"Mujer luciendo un dije de corazón y un anillo solitario en oro","alto":942,"ancho":1669,"foco":"72% 50%","origen":"estatico","src":"/catalogo/delacour/pantalla1mujer_principal.png"},"subtitulo":"Diseños únicos para cada momento de tu vida.","titulo":"Historias que brillan contigo","visible":true},"productos_destacados":[],"secciones":[{"tipo":"portada","visible":true},{"tipo":"categorias","visible":true},{"tipo":"destacados","visible":true},{"tipo":"banner","visible":true},{"tipo":"ofertas","visible":false},{"tipo":"combos","visible":false},{"tipo":"campana","visible":false}]}$cms_json$::jsonb, null, 'Siembra inicial (DuLabs)');
  if v_r->>'resultado' is distinct from 'ok' then
    raise exception 'Delacour: no se pudo crear la página principal (%)', v_r->>'resultado';
  end if;
  v_id := (v_r->'entidad'->>'id')::uuid;

  -- Se publica con el checksum del contenido canónico (lo mismo que calcula la aplicación al publicar y que verifica al leer).
  v_r := public.dulabs_cms_publicar(v_tenant, v_id, (v_r->'entidad'->>'rev')::integer, 0, '27dc9ef193f329272643863d8a2b5850f5cf6dfa239b12f2b95a0200c6e936e7', 'Siembra inicial: la portada y el banner que la tienda ya mostraba', null, 'Siembra inicial (DuLabs)');
  if v_r->>'resultado' is distinct from 'ok' then
    raise exception 'Delacour: no se pudo publicar la página principal (%)', v_r->>'resultado';
  end if;

  raise notice 'Delacour: página principal sembrada y publicada (versión 1)';
end $$;
