-- CMS COMERCIAL (Bloque 29) — HABILITAR las herramientas comerciales de ARIA (Delacour) SOLO PARA UN PILOTO de números.
-- Corre en el SQL Editor de Supabase en DOS pasos de la misma sesión: primero indicas tu número de piloto, luego el bloque DO (atómico: si cualquier guarda falla, no queda nada).
--
--       set dulabs.piloto_comercial = '57XXXXXXXXXX';      -- uno o varios números, separados por coma: SOLO dígitos con el indicativo del país (57 + el celular)
--       <este script>
--
-- ORDEN: DESPUÉS de fusionar y DESPLEGAR el código del piloto (PR 6, piloto por número): el código anterior no conoce el piloto y, si corres este script antes, la configuración de ARIA quedaría
--   inválida para él (ARIA dejaría de responder hasta que corras la reversa). También DESPUÉS de 04_migrar_textos_a_borradores.sql y de que la administradora PUBLIQUE los textos (sin eso, este script se niega).
--
-- QUÉ HACE: agrega a la lista de herramientas de ARIA las cuatro de lectura del CMS (consultar_ofertas, consultar_combos, consultar_campanas, consultar_contenido_comercial) y guarda el PILOTO en negocio.comercial_piloto:
--   SOLO los números indicados reciben las herramientas, la guarda anti-invención y la sección «información comercial» del prompt; TODOS los demás clientes siguen conversando
--   EXACTAMENTE como hoy (sin herramientas, sin guarda y con el prompt de siempre). Los textos siguen también en el prompt hasta que los retires con 06.
--   Con las herramientas, ARIA consulta lo publicado (ofertas, combos, campañas y textos del negocio) y la guarda deja de dejar pasar una promoción, un descuento, una vigencia,
--   un combo o una política que el sistema no respalde (una corrección y, si insiste, una asesora).
-- PARA ABRIRLAS A TODOS los clientes, DESPUÉS de probar con tu número: 05b_abrir_herramientas_comerciales_a_todos.sql. Para CAMBIAR los números del piloto: corre este script otra vez con los números nuevos.
--   Si ya las abriste a todos y quieres VOLVER al piloto: primero la reversa (05_habilitar_herramientas_comerciales.reversa.sql, que protege los temas ya retirados del prompt) y luego este script.
-- QUÉ NO HACE: no abre al público por sí solo (sin números de piloto, se niega); no cambia el prompt, el modelo, el checkout ni las demás herramientas; no toca otros negocios.
-- GUARDAS (se niega si no se cumplen): el módulo está habilitado; las herramientas no están ya abiertas a todos los clientes; cada número es válido (solo dígitos con el indicativo; hasta 20); hay al menos UN texto comercial publicado
--   y vigente; ninguno de los temas críticos (promociones, venta-al-por-mayor, envios, medios-de-pago, garantias, cambios-y-devoluciones, horario, ubicacion) está en el CMS sin publicar. Si un tema crítico quedó a propósito sin publicar, confírmalo en
--   la misma sesión:
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
  v_piloto_txt text;
  v_numeros text[];
  v_n text;
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

  -- Ya abiertas a todos (herramientas sin piloto): volver a un piloto se hace desde la reversa, que protege los temas que ya se retiraron del prompt (si no, los demás clientes se quedarían sin ellos).
  if v_cfg.herramientas @> array['consultar_ofertas', 'consultar_combos', 'consultar_campanas', 'consultar_contenido_comercial']::text[] and (v_cfg.negocio->'comercial_piloto') is null then
    raise exception 'Delacour: las herramientas comerciales ya están ABIERTAS a todos los clientes; este script solo las deja en piloto. Para volver a un piloto, primero corre 05_habilitar_herramientas_comerciales.reversa.sql (que protege los temas ya retirados del prompt) y luego este script con tu número';
  end if;

  -- Piloto: SIN números no se habilita nada (este script nunca abre al público por sí solo).
  v_piloto_txt := regexp_replace(coalesce(current_setting('dulabs.piloto_comercial', true), ''), '[\s+()-]', '', 'g');
  if v_piloto_txt = '' then
    raise exception 'Delacour: indica el número (o los números) de piloto en la misma sesión, por ejemplo: set dulabs.piloto_comercial = ''57XXXXXXXXXX''; (las herramientas solo se habilitan para esos números; para abrirlas a todos, después de probar, está el script 05b)';
  end if;
  v_numeros := string_to_array(v_piloto_txt, ',');
  foreach v_n in array v_numeros loop
    if v_n ~ '^3[0-9]{9}$' then
      raise exception 'Delacour: «%» parece un celular colombiano SIN el indicativo del país: escribe 57 + el número (por ejemplo 57XXXXXXXXXX)', v_n;
    end if;
    if v_n !~ '^[1-9][0-9]{7,14}$' then
      raise exception 'Delacour: «%» no es un número válido: solo dígitos con el indicativo del país, sin ceros iniciales ni signos (por ejemplo 57XXXXXXXXXX)', v_n;
    end if;
  end loop;
  select array_agg(distinct u.n order by u.n) into v_numeros from unnest(v_numeros) as u(n);
  if cardinality(v_numeros) > 20 then
    raise exception 'Delacour: el piloto admite hasta 20 números';
  end if;

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
  if v_nuevas is null and (v_cfg.negocio->'comercial_piloto') is not distinct from to_jsonb(v_numeros) then
    raise notice 'Delacour: las herramientas comerciales ya estaban habilitadas para ese piloto';
    return;
  end if;
  if v_nuevas is not null and cardinality(v_cfg.herramientas) + cardinality(v_nuevas) > 30 then
    raise exception 'Delacour: la lista de herramientas superaría el máximo permitido (30)';
  end if;

  update public.dulabs_agente_runtime_config
     set herramientas = case when v_nuevas is null then herramientas else herramientas || v_nuevas end,
         negocio = jsonb_set(negocio, '{comercial_piloto}', to_jsonb(v_numeros), true),
         updated_at = now()
   where id = v_cfg.id;

  raise notice 'Delacour: herramientas comerciales habilitadas SOLO para el piloto (% número(s)); los demás clientes no cambian', cardinality(v_numeros);
end $$;
