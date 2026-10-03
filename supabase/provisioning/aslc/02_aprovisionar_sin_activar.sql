-- FASE 3B.9A — APROVISIONAMIENTO DE AQUÍ SÍ LO COMPRAS, SIN ACTIVAR.
-- GENERADO por lib/agente/aprovisionamiento.ts (generarSqlAprovisionamiento): no se edita a mano; una prueba verifica que este archivo es EXACTAMENTE su salida.
--
-- QUÉ HACE (todo en UNA transacción; si cualquier guarda falla, no queda nada):
--   1. Identifica al negocio por su tenant (320121d7-2bc5-472d-944b-5191cc228e1f), su phone_number_id (1317599831437793) Y su nombre: exactamente UNA fila de dulabs_clientes_config.
--      El teléfono que informó el negocio (termina en 5088) NO se usa para encontrarlo: en la base, el número conectado a Meta figura con otro teléfono.
--   2. Exige que la IA siga PAUSADA (ia_pausada = true). No cambia ia_pausada ni ia_restringida_a.
--   3. Crea la fila del agente DESHABILITADA (habilitado = false): checkout y audio apagados, vocabulario neutral (null), credencial PROPIA
--      (env:GEMINI_KEY_ASLC), solo contra entrega, sin la herramienta confirm_order. Con esta fila el webhook entrega todo mensaje al agente
--      (deshabilitado: silencio) antes de llegar al Flow, al Business Agent o al bot legacy. Si ya existe una fila para ese número, ABORTA (no sobrescribe).
--   4. Habilita los módulos catalogo, pedidos, pedidos_por_aceptar (solo esos; no toca notificaciones_pedidos).
-- QUÉ NO HACE: no activa la IA, no pone el cierre con aceptación humana, no crea personas, no carga productos, no escribe textos comerciales,
--   no toca ningún otro negocio, no envía nada.
--
-- ANTES: correr 01_verificar_estado_solo_lectura.sql y guardar el resultado (incluye una huella de los módulos de TODOS los negocios).
-- DESPUÉS: correr OTRA VEZ 01_verificar_estado_solo_lectura.sql y comparar: solo debe cambiar la huella de ASLC.
-- Reversa: 04_revertir_aprovisionamiento.sql.

begin;

do $$
declare
  v_tenant uuid;
  v_phone text;
  v_filas integer;
begin
  -- 1) Identidad: UNA sola fila con ese tenant, ese phone_number_id y ese nombre.
  select count(*) into v_filas from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';
  if v_filas <> 1 then
    raise exception 'ASLC: se esperaba exactamente UNA fila de dulabs_clientes_config (tenant, phone_number_id y nombre), hay %', v_filas;
  end if;
  select id_tenant, phone_number_id into v_tenant, v_phone from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';

  -- 2) Estado seguro: la IA sigue pausada.
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and ia_pausada is true) then
    raise exception 'ASLC no está pausado (ia_pausada <> true): abortando sin cambios';
  end if;

  -- 3) Credencial propia: ninguna otra fila de agente usa esta variable.
  if exists (select 1 from public.dulabs_agente_runtime_config where credencial_ref = 'env:GEMINI_KEY_ASLC' and phone_number_id <> v_phone) then
    raise exception 'la credencial env:GEMINI_KEY_ASLC ya la usa OTRO número: abortando';
  end if;

  -- 4) Fila del agente DESHABILITADA. Si ya hay una para este número, no se sobrescribe.
  if exists (select 1 from public.dulabs_agente_runtime_config where phone_number_id = v_phone) then
    raise exception 'ASLC ya tiene una fila en dulabs_agente_runtime_config: revisarla con 01_verificar_estado_solo_lectura.sql (este script no la sobrescribe)';
  end if;
  insert into public.dulabs_agente_runtime_config
    (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, nivel_razonamiento, herramientas, canal, negocio,
     clasificacion_cliente, checkout_conversacional, vocabulario, checkout_opciones, meta_token_plataforma, transcripcion_audio)
  values
    (v_tenant, v_phone, 'catalog_sales', false, 'gemini', 'gemini-3.6-flash', 'env:GEMINI_KEY_ASLC', null,
     array['search_products', 'resolve_product_by_reference', 'resolve_product_by_attributes', 'get_product_details', 'get_cart', 'update_cart', 'resolve_order', 'create_order_request', 'validate_order', 'get_customer_context', 'request_product_images', 'handoff_to_human', 'get_catalog_link', 'more_products', 'similar_products', 'consultar_envio']::text[], 'retail', '{"nombre_negocio":"Aquí Sí Lo Compras"}'::jsonb,
     false, false, null, '{"entregas":["domicilio"],"pagos":[{"metodo":"contra_entrega"}],"activacion_pendiente":true}'::jsonb, false, false);

  -- 5) Módulos (solo los de la lista: catálogo, pedidos y pedidos por aceptar).
  insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado)
  values (v_tenant, 'catalogo', true), (v_tenant, 'pedidos', true), (v_tenant, 'pedidos_por_aceptar', true)
  on conflict (id_tenant, modulo) do update set habilitado = true, updated_at = now();

  -- 6) Comprobación final dentro de la misma transacción.
  if exists (
    select 1 from public.dulabs_agente_runtime_config
     where phone_number_id = v_phone
       and (habilitado is distinct from false or checkout_conversacional is distinct from false or transcripcion_audio is distinct from false or meta_token_plataforma is distinct from false)
  ) then
    raise exception 'la fila del agente de ASLC no quedó deshabilitada: abortando';
  end if;
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and ia_pausada is true) then
    raise exception 'ASLC dejó de estar pausado: abortando';
  end if;
end $$;

commit;
