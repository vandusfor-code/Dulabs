-- CMS COMERCIAL (Bloque 29) — RETIRAR del prompt de ARIA (Delacour) los textos que ya viven publicados en el CMS, TEMA POR TEMA.
-- Corre en el SQL Editor de Supabase en DOS pasos de la misma sesión: primero indicas los temas, luego el bloque DO (atómico).
--
--       set dulabs.retirar_temas = 'promociones,envios';      -- las claves a retirar, separadas por coma (la lista completa está abajo)
--       <este script>
--
-- ORDEN: DESPUÉS de 05_habilitar_herramientas_comerciales.sql y de VERIFICAR con conversaciones reales que ARIA responde bien con las herramientas. Se retira de a pocos temas.
--
-- QUÉ HACE: quita del prompt de ARIA (negocio.conocimiento) los textos de los temas indicados. Desde ese momento la ÚNICA fuente de esos textos es el CMS publicado.
-- GUARDAS (se niega si no se cumplen): sin temas indicados; una clave que no está en la tabla; las cuatro herramientas comerciales no están habilitadas; el tema no está PUBLICADO en
--   el CMS (publicado y no archivado). No toca nada más del prompt (personalidad, tono, políticas, «Despedida», «Datos del pedido»…), ni la configuración, ni otros negocios.
-- Se puede repetir sin efectos nuevos (un tema que ya no está, se salta).
-- Claves: quienes-somos, ubicacion, horario, lineas-y-materiales, dorado-y-plateado, coleccion-vida-eterna, servicios, catalogo, precios-y-disponibilidad, regalos, hombre-y-mujer, venta-al-detal, venta-al-por-mayor, emprendimiento, separar-mercancia, envios, medios-de-pago, pago-no-identificado, garantias, cambios-y-devoluciones, promociones, reclamos.
--
-- GENERADO por el código (lib/cms-comercial/migracion-textos.ts): una prueba lo regenera y lo compara con este archivo. No se edita a mano.
--
-- REVERSA: supabase/provisioning/delacour/06_retirar_textos_del_prompt.reversa.sql (devuelve al prompt el texto PUBLICADO hoy en el CMS).

do $$
declare
  v_tienda integer;
  v_tenant uuid;
  v_filas integer;
  v_cfg record;
  v_lista text;
  v_claves text[];
  v_clave text;
  v_legado text;
  v_ent record;
  v_conocimiento jsonb;
  v_nuevo jsonb;
  v_retirados integer := 0;
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

  -- Las herramientas comerciales deben estar habilitadas: si no, quitar el texto del prompt dejaría a ARIA sin esa información.
  if not (v_cfg.herramientas @> array['consultar_ofertas', 'consultar_combos', 'consultar_campanas', 'consultar_contenido_comercial']::text[]) then
    raise exception 'Delacour: las herramientas comerciales de ARIA no están habilitadas; corre primero 05_habilitar_herramientas_comerciales.sql';
  end if;

  v_lista := btrim(coalesce(current_setting('dulabs.retirar_temas', true), ''));
  if v_lista = '' then
    raise exception 'Delacour: indica los temas a retirar en la misma sesión, por ejemplo: set dulabs.retirar_temas = ''promociones,envios'';';
  end if;
  v_claves := string_to_array(regexp_replace(v_lista, '\s+', '', 'g'), ',');

  v_conocimiento := coalesce(v_cfg.negocio->'conocimiento', '[]'::jsonb);
  if jsonb_typeof(v_conocimiento) <> 'array' then
    raise exception 'Delacour: el conocimiento de ARIA no tiene el formato esperado';
  end if;

  foreach v_clave in array v_claves loop
    if v_clave = '' then continue; end if;
    select m.legado into v_legado from (values
      ('Quiénes somos', 'quienes-somos'),
      ('Ubicación', 'ubicacion'),
      ('Horario', 'horario'),
      ('Líneas y materiales', 'lineas-y-materiales'),
      ('Dorado y plateado', 'dorado-y-plateado'),
      ('Colección Vida Eterna', 'coleccion-vida-eterna'),
      ('Servicios', 'servicios'),
      ('Catálogo', 'catalogo'),
      ('Precios y disponibilidad', 'precios-y-disponibilidad'),
      ('Regalos', 'regalos'),
      ('Hombre y mujer', 'hombre-y-mujer'),
      ('Venta al detal', 'venta-al-detal'),
      ('Venta al por mayor', 'venta-al-por-mayor'),
      ('Emprendimiento', 'emprendimiento'),
      ('Separar mercancía', 'separar-mercancia'),
      ('Envíos', 'envios'),
      ('Medios de pago', 'medios-de-pago'),
      ('Pago no identificado', 'pago-no-identificado'),
      ('Garantías', 'garantias'),
      ('Cambios y devoluciones', 'cambios-y-devoluciones'),
      ('Promociones', 'promociones'),
      ('Reclamos', 'reclamos')
    ) as m(legado, clave) where m.clave = v_clave;
    if v_legado is null then
      raise exception 'Delacour: «%» no es un tema de la tabla de migración', v_clave;
    end if;

    select * into v_ent from public.dulabs_cms_entidades where id_tenant = v_tenant and tipo = 'contenido' and clave = v_clave;
    if v_ent.id is null or v_ent.estado <> 'publicada' or v_ent.archivada_at is not null then
      raise exception 'Delacour: el tema «%» no está publicado en el CMS; publícalo antes de retirarlo del prompt', v_clave;
    end if;

    select coalesce(jsonb_agg(t.k order by t.o), '[]'::jsonb) into v_nuevo
      from jsonb_array_elements(v_conocimiento) with ordinality as t(k, o)
     where lower(btrim(regexp_replace(translate(t.k->>'tema', 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g'))) is distinct from lower(btrim(regexp_replace(translate(v_legado, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')));
    if jsonb_array_length(v_nuevo) < jsonb_array_length(v_conocimiento) then
      v_retirados := v_retirados + 1;
    end if;
    v_conocimiento := v_nuevo;
  end loop;

  update public.dulabs_agente_runtime_config
     set negocio = jsonb_set(negocio, '{conocimiento}', v_conocimiento, true), updated_at = now()
   where id = v_cfg.id;

  raise notice 'Delacour: % temas retirados del prompt; quedan % textos en el prompt', v_retirados, jsonb_array_length(v_conocimiento);
end $$;
