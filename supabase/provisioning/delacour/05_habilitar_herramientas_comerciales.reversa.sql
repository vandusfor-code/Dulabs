-- CMS COMERCIAL (Bloque 29) — REVERSA de 05_habilitar_herramientas_comerciales.sql para Delacour.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico).
--
-- QUÉ HACE: quita de la lista de herramientas de ARIA las cuatro del CMS y el piloto (negocio.comercial_piloto): ARIA y su guarda vuelven a ser exactamente los de antes del script 05
--   para TODOS los clientes. Lo publicado en el CMS queda guardado y sin efecto sobre ARIA.
-- SE NIEGA si algún tema crítico (promociones, venta-al-por-mayor, envios, medios-de-pago, garantias, cambios-y-devoluciones, horario, ubicacion) ya se RETIRÓ del prompt (está publicado en el CMS pero ya no en el prompt): sin las herramientas, ARIA quedaría sin esa
--   información. Primero restaura esos temas con 06_retirar_textos_del_prompt.reversa.sql; para apagar de todos modos, confirma en la misma sesión:
--       set dulabs.confirmar_reversa_herramientas = 'si';
-- Se puede repetir sin efectos nuevos.

do $$
declare
  v_tienda integer;
  v_tenant uuid;
  v_filas integer;
  v_cfg record;
  v_retirados text;
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

  select string_agg(m.clave, ' · ' order by m.clave) into v_retirados
    from (values
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
    ) as m(legado, clave)
    join public.dulabs_cms_entidades e on e.id_tenant = v_tenant and e.tipo = 'contenido' and e.clave = m.clave and e.estado = 'publicada' and e.archivada_at is null
   where m.clave in ('promociones', 'venta-al-por-mayor', 'envios', 'medios-de-pago', 'garantias', 'cambios-y-devoluciones', 'horario', 'ubicacion')
     and not exists (select 1 from jsonb_array_elements(coalesce(v_cfg.negocio->'conocimiento', '[]'::jsonb)) as t(k) where lower(btrim(regexp_replace(translate(t.k->>'tema', 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g'))) = lower(btrim(regexp_replace(translate(m.legado, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g'))));
  if v_retirados is not null and coalesce(current_setting('dulabs.confirmar_reversa_herramientas', true), '') <> 'si' then
    raise exception 'Delacour: estos temas ya no están en el prompt y solo viven en el CMS: %. Sin las herramientas, ARIA no los sabría. Restáuralos con 06_retirar_textos_del_prompt.reversa.sql o confirma con: set dulabs.confirmar_reversa_herramientas = ''si'';', v_retirados;
  end if;

  update public.dulabs_agente_runtime_config
     set herramientas = array(select h from unnest(herramientas) with ordinality as x(h, o) where not (h = any (array['consultar_ofertas', 'consultar_combos', 'consultar_campanas', 'consultar_contenido_comercial']::text[])) order by o),
         negocio = negocio - 'comercial_piloto',
         updated_at = now()
   where id = v_cfg.id and (herramientas && array['consultar_ofertas', 'consultar_combos', 'consultar_campanas', 'consultar_contenido_comercial']::text[] or (negocio->'comercial_piloto') is not null);

  raise notice 'Delacour: herramientas comerciales (y piloto) retiradas de ARIA';
end $$;
