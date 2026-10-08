-- CMS COMERCIAL (Bloque 29) — ABRIR a TODOS los clientes las herramientas comerciales de ARIA (Delacour): termina el piloto.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico: si cualquier guarda falla, no queda nada).
--
-- ORDEN: DESPUÉS de 05_habilitar_herramientas_comerciales.sql y de PROBAR con tu número de piloto que ARIA responde bien. Antes, este script se niega.
--
-- QUÉ HACE: quita negocio.comercial_piloto. Desde ese momento TODOS los clientes del número reciben las herramientas comerciales, la guarda anti-invención y la sección
--   «información comercial» del prompt (hasta hoy, solo los números del piloto).
-- GUARDAS (se niega si no se cumplen): las herramientas no están habilitadas (primero el 05); no hay ningún texto comercial publicado; algún tema crítico
--   (promociones, venta-al-por-mayor, envios, medios-de-pago, garantias, cambios-y-devoluciones, horario, ubicacion) está en el CMS sin publicar (se puede confirmar con: set dulabs.permitir_temas_sin_publicar = 'si';). Si ya están abiertas a todos, no hace nada.
-- QUÉ NO HACE: no cambia el prompt, las herramientas, el modelo ni otros negocios.
--
-- GENERADO por el código (lib/cms-comercial/migracion-textos.ts): una prueba lo regenera y lo compara con este archivo. No se edita a mano.
--
-- REVERSA (volver al piloto): corre 05_habilitar_herramientas_comerciales.reversa.sql (quita las herramientas y el piloto; se niega si ya retiraste temas críticos del prompt) y luego 05_habilitar_herramientas_comerciales.sql con tu número.

do $$
declare
  v_tienda integer;
  v_tenant uuid;
  v_filas integer;
  v_cfg record;
  v_publicados integer;
  v_sin_publicar text;
begin
  -- La migración del CMS y la configuración de ARIA deben existir.
  if to_regclass('public.dulabs_cms_entidades') is null or to_regprocedure('public.dulabs_cms_crear(uuid, text, text, jsonb, uuid, text)') is null then
    raise exception 'Delacour: falta aplicar la migración 20261210000000_dulabs_cms_comercial.sql';
  end if;
  if to_regclass('public.dulabs_agente_runtime_config') is null then
    raise exception 'Delacour: no existe la configuración de ARIA (dulabs_agente_runtime_config)';
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

  -- ARIA: UNA sola configuración del negocio.
  select count(*) into v_filas from public.dulabs_agente_runtime_config where id_tenant = v_tenant and tipo = 'catalog_sales';
  if v_filas <> 1 then
    raise exception 'Delacour: se esperaba exactamente UNA configuración de ARIA del negocio, hay %', v_filas;
  end if;
  select * into v_cfg from public.dulabs_agente_runtime_config where id_tenant = v_tenant and tipo = 'catalog_sales';

  if not (v_cfg.herramientas @> array['consultar_ofertas', 'consultar_combos', 'consultar_campanas', 'consultar_contenido_comercial']::text[]) then
    raise exception 'Delacour: las herramientas comerciales de ARIA no están habilitadas; corre primero 05_habilitar_herramientas_comerciales.sql (piloto)';
  end if;
  if (v_cfg.negocio->'comercial_piloto') is null then
    raise notice 'Delacour: las herramientas comerciales ya están abiertas a todos los clientes; no hay nada que hacer';
    return;
  end if;

  select count(*) into v_publicados
    from public.dulabs_cms_entidades
   where id_tenant = v_tenant and tipo = 'contenido' and estado = 'publicada' and archivada_at is null;
  if v_publicados = 0 then
    raise exception 'Delacour: no hay ningún texto comercial publicado en el CMS; no se abren las herramientas a todos los clientes';
  end if;

  select string_agg(e.clave, ' · ' order by e.clave) into v_sin_publicar
    from public.dulabs_cms_entidades e
   where e.id_tenant = v_tenant and e.tipo = 'contenido' and e.archivada_at is null and e.estado <> 'publicada' and e.clave in ('promociones', 'venta-al-por-mayor', 'envios', 'medios-de-pago', 'garantias', 'cambios-y-devoluciones', 'horario', 'ubicacion');
  if v_sin_publicar is not null and coalesce(current_setting('dulabs.permitir_temas_sin_publicar', true), '') <> 'si' then
    raise exception 'Delacour: estos temas críticos siguen sin publicar: %. Publícalos (o archívalos) antes de abrir las herramientas a todos; para seguir sin ellos: set dulabs.permitir_temas_sin_publicar = ''si'';', v_sin_publicar;
  end if;

  update public.dulabs_agente_runtime_config
     set negocio = negocio - 'comercial_piloto', updated_at = now()
   where id = v_cfg.id;

  raise notice 'Delacour: herramientas comerciales ABIERTAS a todos los clientes (ya no hay piloto)';
end $$;
