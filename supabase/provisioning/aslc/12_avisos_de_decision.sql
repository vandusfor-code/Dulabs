-- FASE 3B.9D — AVISOS AL CLIENTE TRAS ACEPTAR, RECHAZAR O CANCELAR UN PEDIDO (AQUÍ SÍ LO COMPRAS)
-- GENERADO por lib/agente/activacion-aslc.ts: no se edita a mano (salvo las líneas marcadas con "← EDITAR"); una prueba verifica que este archivo es EXACTAMENTE su salida.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- TEXTOS PROPUESTOS por DuLabs (no son del negocio): léelos abajo antes de correr. Si el negocio prefiere otros, se ponen en textos-aprobados.json
-- (aceptado / rechazado / cancelado) y este archivo se regenera. Solo admiten el marcador {pedido} (el número público del pedido): ni datos del cliente ni
-- un motivo escrito por el equipo. No prometen fechas, despacho, stock ni alternativas.
--
-- QUÉ HACE (todo o nada, con la fila ya habilitada o no):
--   1. Guarda los tres textos en checkout_opciones.cierre.textos (aceptado, rechazado, cancelado) de la fila del agente de ASLC.
--   2. Enciende el módulo avisos_decision_pedidos de ASLC: SOLO el mensaje tras una decisión de la persona del equipo, dentro de la ventana de 24 h de
--      WhatsApp, una sola vez por pedido y decisión, con el número y el token de ASLC. No cambia el estado de ningún pedido.
-- QUÉ NO HACE: no enciende notificaciones_pedidos (avisos genéricos de cada etapa con plantillas de la plataforma: sigue apagado y este script se niega a
--   correr si alguien lo encendió), no toca ia_pausada, ia_restringida_a, habilitado, el aviso obligatorio, la persona responsable ni otros negocios.
-- Se puede repetir sin efectos nuevos.
--
-- REVERSA: apagar SOLO el módulo (los textos quedan guardados y sin uso):
--   update public.dulabs_tenant_modulos set habilitado = false, updated_at = now()
--    where id_tenant = '320121d7-2bc5-472d-944b-5191cc228e1f'::uuid and modulo = 'avisos_decision_pedidos';

do $$
declare
  v_tenant uuid;
  v_phone text;
  v_filas integer;
  v_aceptado text := $ac$¡Buenas noticias! 🎉 Tu pedido {pedido} fue aceptado. Recuerda que el pago es contraentrega: ten el dinero disponible cuando lo recibas. Si tienes alguna duda, escríbenos por este mismo chat.$ac$;
  v_rechazado text := $re$Hola 👋 Lamentamos informarte que tu pedido {pedido} no pudo ser aceptado. Si tienes alguna duda, escríbenos por este mismo chat y te ayudamos.$re$;
  v_cancelado text := $ca$Hola 👋 Tu pedido {pedido} fue cancelado. Si tienes alguna duda, escríbenos por este mismo chat y te ayudamos.$ca$;
begin
  -- Identidad: UNA sola fila con ese tenant, ese phone_number_id y ese nombre.
  select count(*) into v_filas from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';
  if v_filas <> 1 then
    raise exception 'ASLC: se esperaba exactamente UNA fila de dulabs_clientes_config (tenant, phone_number_id y nombre), hay %', v_filas;
  end if;
  select id_tenant, phone_number_id into v_tenant, v_phone from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';

  -- La fila del agente: UNA, con la credencial propia y la configuración completa cargada (sin candado, con el cierre por aceptación humana).
  select count(*) into v_filas from public.dulabs_agente_runtime_config
   where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC' and checkout_opciones -> 'activacion_pendiente' is null and coalesce(checkout_opciones #>> '{cierre,modo}', '') = 'aceptacion_humana';
  if v_filas <> 1 then
    raise exception 'se esperaba la fila del agente de ASLC con la configuración completa cargada (sin candado y con el cierre por aceptación humana): corre antes 03_configurar_completo_sin_activar.sql; hay %', v_filas;
  end if;

  -- El aviso obligatorio sigue EXACTO (este script no lo toca; se comprueba por si alguien lo cambió).
  if not exists (select 1 from public.dulabs_agente_runtime_config where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC' and encode(sha256(convert_to(checkout_opciones #>> '{cierre,textos,aviso}', 'UTF8')), 'hex') = 'c0bf58e071859d51d86f2de4f703faa8f95ea866e644386d40eb9d6d1a75179a') then
    raise exception 'el aviso obligatorio guardado NO es el aprobado: no se ajusta nada';
  end if;

  -- notificaciones_pedidos debe seguir APAGADO: encendido mandaría también los avisos genéricos de cada etapa del pedido (plantillas de la plataforma).
  if exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'notificaciones_pedidos' and habilitado) then
    raise exception 'el módulo notificaciones_pedidos está encendido para ASLC: apágalo antes (mandaría avisos genéricos de otro negocio)';
  end if;

  update public.dulabs_agente_runtime_config
     set checkout_opciones = jsonb_set(jsonb_set(jsonb_set(checkout_opciones,
           '{cierre,textos,aceptado}', to_jsonb(v_aceptado)),
           '{cierre,textos,rechazado}', to_jsonb(v_rechazado)),
           '{cierre,textos,cancelado}', to_jsonb(v_cancelado)),
         updated_at = now()
   where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo actualizar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;

  insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado)
  values (v_tenant, 'avisos_decision_pedidos', true)
  on conflict (id_tenant, modulo) do update set habilitado = true, updated_at = now();

  -- Comprobación final dentro de la misma sentencia.
  if not exists (
    select 1 from public.dulabs_agente_runtime_config
     where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC'
       and checkout_opciones #>> '{cierre,textos,aceptado}' = v_aceptado
       and checkout_opciones #>> '{cierre,textos,rechazado}' = v_rechazado
       and checkout_opciones #>> '{cierre,textos,cancelado}' = v_cancelado
       and checkout_opciones -> 'activacion_pendiente' is null
  ) then
    raise exception 'la fila del agente de ASLC no quedó como se esperaba: abortando';
  end if;
  if not exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'avisos_decision_pedidos' and habilitado) then
    raise exception 'el módulo avisos_decision_pedidos no quedó encendido: abortando';
  end if;
  if exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'notificaciones_pedidos' and habilitado) then
    raise exception 'notificaciones_pedidos quedó encendido: abortando';
  end if;
end $$;
