-- FASE 3B.9D — AVISOS AL CLIENTE CUANDO SU PEDIDO AVANZA DE ETAPA (AQUÍ SÍ LO COMPRAS)
-- GENERADO por lib/agente/activacion-aslc.ts: no se edita a mano (salvo las líneas marcadas con "← EDITAR"); una prueba verifica que este archivo es EXACTAMENTE su salida.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- TEXTOS PROPUESTOS por DuLabs (no son del negocio): léelos abajo antes de correr. Si el negocio prefiere otros, se ponen en textos-aprobados.json
-- (en_preparacion / enviado / entregado) y este archivo se regenera. Solo admiten el marcador {pedido} (el número público del pedido): ni datos del cliente ni
-- un motivo escrito por el equipo. No prometen fechas, guías ni transportadoras, ni que se volverá a avisar.
--
-- PARA QUÉ: hoy, cuando una persona del equipo marca un pedido "en preparación", "enviado" o "entregado" en Pedidos, el cliente NO recibe nada: esos avisos dependían de
--   notificaciones_pedidos, que manda plantillas de la plataforma (el tono de otro negocio) y está apagado a propósito para ASLC. Este script le da a ASLC SUS textos.
--
-- ORDEN: correr SOLO DESPUÉS de que el código de los avisos de etapa (Fase 3B.9F) esté desplegado en producción. Con el código anterior, la configuración con estas
--   claves sería inválida y el agente callaría.
--
-- QUÉ HACE (todo o nada, con la fila ya habilitada o no):
--   1. Guarda los tres textos en checkout_opciones.cierre.textos (en_preparacion, enviado, entregado) de la fila del agente de ASLC.
--   2. Enciende el módulo avisos_etapa_pedidos de ASLC: SOLO el aviso de esas tres etapas, dentro de la ventana de 24 h de WhatsApp, una sola vez por pedido y etapa,
--      con el número y el token de ASLC. No cambia el estado de ningún pedido.
-- QUÉ NO HACE: no enciende notificaciones_pedidos (avisos genéricos con plantillas de la plataforma: sigue apagado y este script se niega a correr si alguien lo
--   encendió), no toca ia_pausada, ia_restringida_a, habilitado, el aviso obligatorio, la persona responsable, los mensajes de decisión ni otros negocios.
-- LÍMITE: WhatsApp solo deja escribir un texto libre dentro de las 24 h siguientes al último mensaje del cliente; pasado ese plazo el aviso no sale (el panel lo muestra).
-- Se puede repetir sin efectos nuevos.
--
-- REVERSA: apagar SOLO el módulo (los textos quedan guardados y sin uso):
--   update public.dulabs_tenant_modulos set habilitado = false, updated_at = now()
--    where id_tenant = '320121d7-2bc5-472d-944b-5191cc228e1f'::uuid and modulo = 'avisos_etapa_pedidos';

do $$
declare
  v_tenant uuid;
  v_phone text;
  v_filas integer;
  v_en_preparacion text := $ep$Hola 👋 Tu pedido {pedido} ya está en preparación. Si tienes alguna duda, escríbenos por este mismo chat.$ep$;
  v_enviado text := $en$¡Buenas noticias! 📦 Tu pedido {pedido} ya fue enviado. Recuerda que el pago es contraentrega: ten el dinero disponible cuando lo recibas. Si tienes alguna duda, escríbenos por este mismo chat.$en$;
  v_entregado text := $et$Hola 👋 Tu pedido {pedido} figura como entregado. ¡Gracias por tu compra! Si tienes alguna duda, escríbenos por este mismo chat.$et$;
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

  -- notificaciones_pedidos debe seguir APAGADO: encendido mandaría también las plantillas de la plataforma (el tono de otro negocio) en cada etapa del pedido.
  if exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'notificaciones_pedidos' and habilitado) then
    raise exception 'el módulo notificaciones_pedidos está encendido para ASLC: apágalo antes (mandaría avisos genéricos de otro negocio)';
  end if;

  update public.dulabs_agente_runtime_config
     set checkout_opciones = jsonb_set(jsonb_set(jsonb_set(checkout_opciones,
           '{cierre,textos,en_preparacion}', to_jsonb(v_en_preparacion)),
           '{cierre,textos,enviado}', to_jsonb(v_enviado)),
           '{cierre,textos,entregado}', to_jsonb(v_entregado)),
         updated_at = now()
   where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo actualizar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;

  insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado)
  values (v_tenant, 'avisos_etapa_pedidos', true)
  on conflict (id_tenant, modulo) do update set habilitado = true, updated_at = now();

  -- Comprobación final dentro de la misma sentencia.
  if not exists (
    select 1 from public.dulabs_agente_runtime_config
     where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC'
       and checkout_opciones #>> '{cierre,textos,en_preparacion}' = v_en_preparacion
       and checkout_opciones #>> '{cierre,textos,enviado}' = v_enviado
       and checkout_opciones #>> '{cierre,textos,entregado}' = v_entregado
       and checkout_opciones -> 'activacion_pendiente' is null
  ) then
    raise exception 'la fila del agente de ASLC no quedó como se esperaba: abortando';
  end if;
  if not exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'avisos_etapa_pedidos' and habilitado) then
    raise exception 'el módulo avisos_etapa_pedidos no quedó encendido: abortando';
  end if;
  if exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'notificaciones_pedidos' and habilitado) then
    raise exception 'notificaciones_pedidos quedó encendido: abortando';
  end if;
end $$;
