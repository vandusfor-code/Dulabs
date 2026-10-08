-- CMS COMERCIAL (Bloque 29) — MIGRAR los textos comerciales de ARIA (Delacour) al CMS, como BORRADORES.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- ORDEN: DESPUÉS de 02_habilitar_cms_comercial.sql (el módulo debe estar habilitado). Antes, este script se niega.
--
-- QUÉ HACE: lee los textos de ARIA que hoy viven en su prompt (negocio.conocimiento) y crea, por cada uno de los 22 temas comerciales, un BORRADOR en el CMS
--   (con su tema, audiencia y orden; el mínimo mayorista escrito a mano pasa a la variable {{minimo_mayorista}}). Los borradores NO se publican: la administradora los
--   revisa uno a uno en «Administración de tienda» (Contenido) y publica los que estén bien. «Despedida» y «Datos del pedido» se quedan en el prompt (son de la conversación).
-- QUÉ NO HACE: no publica nada, no toca el prompt ni la configuración de ARIA (ni sus herramientas), no toca productos, precios, pedidos ni otros negocios. Un tema que no esté
--   en la tabla de este script no se migra nunca. NO pisa: si un borrador (o contenido) con esa clave ya existe —lo editó o publicó la administradora—, se salta.
--   Hasta que se habiliten las herramientas (script 05), ARIA sigue respondiendo con el prompt de siempre: nada cambia para los clientes.
-- Se puede repetir sin efectos nuevos.
--
-- GENERADO por el código (lib/cms-comercial/migracion-textos.ts): una prueba lo regenera y lo compara con este archivo. No se edita a mano.
--
-- REVERSA: supabase/provisioning/delacour/04_migrar_textos_a_borradores.reversa.sql (archiva los borradores que nadie ha tocado).

do $$
declare
  v_tienda integer;
  v_tenant uuid;
  v_filas integer;
  v_cfg record;
  v_conocimiento jsonb;
  v_minimo bigint;
  v_patron text;
  v_m record;
  v_item jsonb;
  v_texto text;
  v_r jsonb;
  v_creados integer := 0;
  v_existentes integer := 0;
  v_ausentes text := '';
  v_quedan text;
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
  v_conocimiento := v_cfg.negocio->'conocimiento';
  if v_conocimiento is null or jsonb_typeof(v_conocimiento) <> 'array' or jsonb_array_length(v_conocimiento) = 0 then
    raise notice 'Delacour: el prompt de ARIA no tiene textos de conocimiento; no hay nada que migrar';
    return;
  end if;

  -- El mínimo mayorista configurado: si un texto lo trae escrito a mano ($750.000 o 750000), se reemplaza por la variable (el CMS no deja publicar un monto a mano).
  v_minimo := case when jsonb_typeof(v_cfg.negocio->'pedido'->'minimo_mayorista') = 'number' and (v_cfg.negocio->'pedido'->>'minimo_mayorista') ~ '^[0-9]+$' then (v_cfg.negocio->'pedido'->>'minimo_mayorista')::bigint end;
  if v_minimo is not null and v_minimo > 0 then
    v_patron := '(?:\$\s?)?(?<![\d.,])(?:' || replace(to_char(v_minimo, 'FM999,999,999,999,999'), ',', '\.') || '|' || v_minimo::text || ')(?!\d|[.,]\d)';
  end if;

  for v_m in
    select * from (values
      ('Quiénes somos', 'quienes-somos', 'general', 'todos', 10),
      ('Ubicación', 'ubicacion', 'ubicacion', 'todos', 20),
      ('Horario', 'horario', 'horarios', 'todos', 30),
      ('Líneas y materiales', 'lineas-y-materiales', 'materiales', 'todos', 40),
      ('Dorado y plateado', 'dorado-y-plateado', 'materiales', 'todos', 50),
      ('Colección Vida Eterna', 'coleccion-vida-eterna', 'general', 'todos', 60),
      ('Servicios', 'servicios', 'general', 'todos', 70),
      ('Catálogo', 'catalogo', 'general', 'todos', 80),
      ('Precios y disponibilidad', 'precios-y-disponibilidad', 'general', 'todos', 90),
      ('Regalos', 'regalos', 'general', 'todos', 100),
      ('Hombre y mujer', 'hombre-y-mujer', 'general', 'todos', 110),
      ('Venta al detal', 'venta-al-detal', 'general', 'detal', 120),
      ('Venta al por mayor', 'venta-al-por-mayor', 'mayoristas', 'mayorista', 130),
      ('Emprendimiento', 'emprendimiento', 'mayoristas', 'mayorista', 140),
      ('Separar mercancía', 'separar-mercancia', 'general', 'todos', 150),
      ('Envíos', 'envios', 'envios', 'todos', 160),
      ('Medios de pago', 'medios-de-pago', 'pagos', 'todos', 170),
      ('Pago no identificado', 'pago-no-identificado', 'pagos', 'todos', 180),
      ('Garantías', 'garantias', 'garantias', 'todos', 190),
      ('Cambios y devoluciones', 'cambios-y-devoluciones', 'cambios', 'todos', 200),
      ('Promociones', 'promociones', 'promociones', 'todos', 210),
      ('Reclamos', 'reclamos', 'general', 'todos', 220)
    ) as m(legado, clave, tema, audiencia, orden)
    order by m.orden
  loop
    select t.k into v_item
      from jsonb_array_elements(v_conocimiento) as t(k)
     where lower(btrim(regexp_replace(translate(t.k->>'tema', 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g'))) = lower(btrim(regexp_replace(translate(v_m.legado, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')))
     limit 1;
    if v_item is null then
      v_ausentes := v_ausentes || ' · ' || v_m.legado;
      continue;
    end if;

    v_texto := v_item->>'info';
    if v_texto is null or btrim(v_texto) = '' then
      v_ausentes := v_ausentes || ' · ' || v_m.legado || ' (vacío)';
      continue;
    end if;
    if v_patron is not null then
      v_texto := regexp_replace(v_texto, v_patron, '{{minimo_mayorista}}', 'g');
    end if;

    v_r := public.dulabs_cms_crear(
      v_tenant, 'contenido', v_m.clave,
      jsonb_build_object('tema', v_m.tema, 'audiencia', v_m.audiencia, 'titulo', regexp_replace(btrim(v_item->>'tema'), '\s+', ' ', 'g'), 'texto', v_texto, 'palabras_clave', '[]'::jsonb, 'orden', v_m.orden),
      null, 'Migración del conocimiento de ARIA (DuLabs)');
    if v_r->>'resultado' = 'ok' then
      v_creados := v_creados + 1;
    elsif v_r->>'resultado' = 'clave_existente' then
      v_existentes := v_existentes + 1;
    else
      raise exception 'Delacour: no se pudo crear el borrador «%» (%)', v_m.clave, v_r->>'resultado';
    end if;
  end loop;

  select string_agg(btrim(t.k->>'tema'), ' · ') into v_quedan
    from jsonb_array_elements(v_conocimiento) as t(k)
   where not exists (select 1 from (values
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
    ) as m(legado, clave) where lower(btrim(regexp_replace(translate(m.legado, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g'))) = lower(btrim(regexp_replace(translate(t.k->>'tema', 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g'))));

  raise notice 'Delacour: % borradores creados, % ya existían', v_creados, v_existentes;
  if v_ausentes <> '' then raise notice 'Delacour: temas de la tabla que no están en el prompt (o están vacíos):%', v_ausentes; end if;
  if v_quedan is not null then raise notice 'Delacour: temas que se quedan en el prompt (no se migran): %', v_quedan; end if;
end $$;
