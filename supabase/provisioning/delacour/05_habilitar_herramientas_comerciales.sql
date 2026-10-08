-- CMS COMERCIAL (Bloque 29) — HABILITAR las herramientas comerciales de ARIA (Delacour).
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- ORDEN: DESPUÉS de desplegar el código del PR 5, de 04_migrar_textos_a_borradores.sql y de que la administradora PUBLIQUE los textos. Antes, este script se niega.
--
-- QUÉ HACE: agrega a la lista de herramientas de ARIA las cuatro de lectura del CMS (consultar_ofertas, consultar_combos, consultar_campanas, consultar_contenido_comercial). Con ellas, ARIA consulta lo
--   publicado (ofertas, combos, campañas y textos del negocio) y la GUARDA de ARIA deja de dejar pasar una promoción, un descuento, una vigencia, un combo o una política que
--   el sistema no respalde (una corrección y, si insiste, una asesora). Los textos siguen también en el prompt hasta que los retires con 06 (primero se verifica que ARIA
--   responde bien con ambos).
-- QUÉ NO HACE: no cambia el prompt, el modelo, el checkout ni las demás herramientas; no toca otros negocios.
-- GUARDAS (se niega si no se cumplen): el módulo está habilitado; hay al menos UN texto comercial publicado y vigente; ninguno de los temas críticos
--   (promociones, venta-al-por-mayor, envios, medios-de-pago, garantias, cambios-y-devoluciones, horario, ubicacion) está en el CMS sin publicar. Si un tema crítico quedó a propósito sin publicar, confírmalo en la misma sesión:
--       set dulabs.permitir_temas_sin_publicar = 'si';
--   (ARIA no podrá afirmar nada de ese tema: pasará a una asesora.)
-- Se puede repetir sin efectos nuevos.
--
-- GENERADO por el código (lib/cms-comercial/migracion-textos.ts): una prueba lo regenera y lo compara con este archivo. No se edita a mano.
--
-- REVERSA: supabase/provisioning/delacour/05_habilitar_herramientas_comerciales.reversa.sql

do $$
declare
  v_tienda integer;
  v_tenant uuid;
  v_filas integer;
  v_cfg record;
  v_publicados integer;
  v_sin_publicar text;
  v_nuevas text[];
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

  select count(*) into v_publicados
    from public.dulabs_cms_entidades
   where id_tenant = v_tenant and tipo = 'contenido' and estado = 'publicada' and archivada_at is null;
  if v_publicados = 0 then
    raise exception 'Delacour: todavía no hay ningún texto comercial publicado en el CMS; publica los textos (Administración de tienda → Contenido) antes de habilitar las herramientas';
  end if;

  select string_agg(e.clave, ' · ' order by e.clave) into v_sin_publicar
    from public.dulabs_cms_entidades e
   where e.id_tenant = v_tenant and e.tipo = 'contenido' and e.archivada_at is null and e.estado <> 'publicada' and e.clave in ('promociones', 'venta-al-por-mayor', 'envios', 'medios-de-pago', 'garantias', 'cambios-y-devoluciones', 'horario', 'ubicacion');
  if v_sin_publicar is not null and coalesce(current_setting('dulabs.permitir_temas_sin_publicar', true), '') <> 'si' then
    raise exception 'Delacour: estos temas críticos siguen sin publicar: %. Publícalos (o archívalos) antes de habilitar las herramientas; para seguir sin ellos: set dulabs.permitir_temas_sin_publicar = ''si'';', v_sin_publicar;
  end if;

  -- Solo se agregan las que faltan, al final y en su orden (las demás herramientas no se tocan).
  select array_agg(h order by o) into v_nuevas
    from unnest(array['consultar_ofertas', 'consultar_combos', 'consultar_campanas', 'consultar_contenido_comercial']::text[]) with ordinality as x(h, o)
   where not (h = any (v_cfg.herramientas));
  if v_nuevas is null then
    raise notice 'Delacour: las herramientas comerciales ya estaban habilitadas';
    return;
  end if;
  if cardinality(v_cfg.herramientas) + cardinality(v_nuevas) > 30 then
    raise exception 'Delacour: la lista de herramientas superaría el máximo permitido (30)';
  end if;

  update public.dulabs_agente_runtime_config
     set herramientas = herramientas || v_nuevas, updated_at = now()
   where id = v_cfg.id;

  raise notice 'Delacour: herramientas comerciales habilitadas (%)', array_to_string(v_nuevas, ', ');
end $$;
