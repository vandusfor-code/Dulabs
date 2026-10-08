-- CMS COMERCIAL (Bloque 29) — REVERSA de 06_retirar_textos_del_prompt.sql para Delacour.
-- Corre en el SQL Editor de Supabase en DOS pasos de la misma sesión: primero indicas los temas, luego el bloque DO (atómico).
--
--       set dulabs.restaurar_temas = 'promociones,envios';
--       <este script>
--
-- QUÉ HACE: devuelve al prompt de ARIA (negocio.conocimiento) el texto PUBLICADO HOY en el CMS de cada tema indicado, con sus variables ya reemplazadas ({{minimo_mayorista}} →
--   «$750.000», etc.), con el nombre de tema de siempre y al final de la lista. Un tema que ya está en el prompt se salta.
-- SE NIEGA si el tema no está publicado, si una variable no tiene valor configurado, si el texto supera los 800 caracteres que admite el prompt, o si el prompt pasaría de 40 temas.
-- Se puede repetir sin efectos nuevos.

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
  v_texto text;
  v_minimo text;
  v_restaurados integer := 0;
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

  -- ARIA: UNA sola configuración del negocio.
  select count(*) into v_filas from public.dulabs_agente_runtime_config where id_tenant = v_tenant and tipo = 'catalog_sales';
  if v_filas <> 1 then
    raise exception 'Delacour: se esperaba exactamente UNA configuración de ARIA del negocio, hay %', v_filas;
  end if;
  select * into v_cfg from public.dulabs_agente_runtime_config where id_tenant = v_tenant and tipo = 'catalog_sales';

  v_lista := btrim(coalesce(current_setting('dulabs.restaurar_temas', true), ''));
  if v_lista = '' then
    raise exception 'Delacour: indica los temas a restaurar en la misma sesión, por ejemplo: set dulabs.restaurar_temas = ''promociones,envios'';';
  end if;
  v_claves := string_to_array(regexp_replace(v_lista, '\s+', '', 'g'), ',');

  v_conocimiento := coalesce(v_cfg.negocio->'conocimiento', '[]'::jsonb);
  if jsonb_typeof(v_conocimiento) <> 'array' then
    raise exception 'Delacour: el conocimiento de ARIA no tiene el formato esperado';
  end if;
  v_minimo := case when jsonb_typeof(v_cfg.negocio->'pedido'->'minimo_mayorista') = 'number' and (v_cfg.negocio->'pedido'->>'minimo_mayorista') ~ '^[0-9]+$'
                   then '$' || replace(to_char((v_cfg.negocio->'pedido'->>'minimo_mayorista')::bigint, 'FM999,999,999,999,999'), ',', '.') end;

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
    if exists (select 1 from jsonb_array_elements(v_conocimiento) as t(k) where lower(btrim(regexp_replace(translate(t.k->>'tema', 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g'))) = lower(btrim(regexp_replace(translate(v_legado, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')))) then
      continue;
    end if;

    select * into v_ent from public.dulabs_cms_entidades where id_tenant = v_tenant and tipo = 'contenido' and clave = v_clave;
    if v_ent.id is null or v_ent.estado <> 'publicada' or v_ent.archivada_at is not null then
      raise exception 'Delacour: el tema «%» no está publicado en el CMS; no hay texto que restaurar', v_clave;
    end if;
    v_texto := public.dulabs_cms_contenido_activo(v_tenant, v_ent.id)->>'texto';

    -- Variables (lista cerrada): si alguna no tiene valor, el texto no se restaura a medias.
    if v_texto like '%{{minimo_mayorista}}%' then
      if v_minimo is null then raise exception 'Delacour: «%» usa {{minimo_mayorista}} y el mínimo no está configurado', v_clave; end if;
      v_texto := replace(v_texto, '{{minimo_mayorista}}', v_minimo);
    end if;
    if v_texto like '%{{direccion_tienda}}%' then
      if coalesce(btrim(v_cfg.negocio->'pedido'->>'direccion_tienda'), '') = '' then raise exception 'Delacour: «%» usa {{direccion_tienda}} y la dirección no está configurada', v_clave; end if;
      v_texto := replace(v_texto, '{{direccion_tienda}}', btrim(v_cfg.negocio->'pedido'->>'direccion_tienda'));
    end if;
    if v_texto like '%{{nombre_negocio}}%' then
      if coalesce(btrim(v_cfg.negocio->>'nombre_negocio'), '') = '' then raise exception 'Delacour: «%» usa {{nombre_negocio}} y el nombre no está configurado', v_clave; end if;
      v_texto := replace(v_texto, '{{nombre_negocio}}', btrim(v_cfg.negocio->>'nombre_negocio'));
    end if;
    if v_texto ~ '\{\{' then
      raise exception 'Delacour: «%» tiene una variable desconocida; no se restaura', v_clave;
    end if;
    if char_length(v_texto) > 800 then
      raise exception 'Delacour: el texto de «%» tiene % caracteres y el prompt admite hasta 800; no se restaura', v_clave, char_length(v_texto);
    end if;
    if jsonb_array_length(v_conocimiento) >= 40 then
      raise exception 'Delacour: el prompt de ARIA ya tiene 40 temas (el máximo)';
    end if;

    v_conocimiento := v_conocimiento || jsonb_build_array(jsonb_build_object('tema', v_legado, 'info', v_texto));
    v_restaurados := v_restaurados + 1;
  end loop;

  update public.dulabs_agente_runtime_config
     set negocio = jsonb_set(negocio, '{conocimiento}', v_conocimiento, true), updated_at = now()
   where id = v_cfg.id;

  raise notice 'Delacour: % temas restaurados en el prompt', v_restaurados;
end $$;
