-- FASE 3B.9D — ABRIR AL PÚBLICO AQUÍ SÍ LO COMPRAS
-- GENERADO por lib/agente/activacion-aslc.ts: no se edita a mano (salvo las líneas marcadas con "← EDITAR"); una prueba verifica que este archivo es EXACTAMENTE su salida.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- Correr SOLO cuando la prueba controlada (05) salió bien con tu número de prueba.
--
-- QUÉ HACE:
--   1. Identifica a ASLC (tenant + phone_number_id + nombre): exactamente UNA fila.
--   2. Exige que la activación controlada esté en marcha: fila del agente HABILITADA, IA sin pausa y todavía restringida a números de prueba.
--   3. Vuelve a exigir la configuración completa, a la persona responsable ACTIVA y notificaciones_pedidos apagado.
--   4. Quita la restricción (ia_restringida_a = null): desde ese momento el agente contesta a TODOS los clientes.
-- FRENO: 07_freno_de_emergencia.sql pausa la IA al instante (los mensajes siguen llegando al Inbox para atenderlos a mano).

do $$
declare
  v_tenant uuid;
  v_phone text;
  v_filas integer;
  v_opciones jsonb;
  v_checkout boolean;
  v_responsable bigint;
  v_restringida text;
begin
  -- Identidad: UNA sola fila con ese tenant, ese phone_number_id y ese nombre.
  select count(*) into v_filas from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';
  if v_filas <> 1 then
    raise exception 'ASLC: se esperaba exactamente UNA fila de dulabs_clientes_config (tenant, phone_number_id y nombre), hay %', v_filas;
  end if;
  select id_tenant, phone_number_id into v_tenant, v_phone from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';

  -- La activación controlada debe estar en marcha.
  select ia_restringida_a into v_restringida from public.dulabs_clientes_config where phone_number_id = v_phone and id_tenant = v_tenant;
  if coalesce(btrim(v_restringida), '') = '' then
    raise exception 'ASLC ya está abierto al público (ia_restringida_a vacío): nada que hacer';
  end if;
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and id_tenant = v_tenant and ia_pausada is false) then
    raise exception 'ASLC está pausado: si es la primera activación corre 05_activacion_controlada.sql; si fue un freno (07), corre 10_reanudar_tras_freno.sql';
  end if;
  if not exists (select 1 from public.dulabs_agente_runtime_config where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC' and habilitado is true) then
    raise exception 'la fila del agente de ASLC no está habilitada: corre antes 05_activacion_controlada.sql';
  end if;

  -- La configuración COMPLETA (la que carga 03_configurar_completo_sin_activar.sql) debe estar cargada: sin el candado, con el cierre por aceptación humana,
  -- con las reglas de envío, con el checkout conversacional y con una persona responsable ACTIVA.
  select checkout_opciones, checkout_conversacional into v_opciones, v_checkout
    from public.dulabs_agente_runtime_config where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC';
  if v_opciones is null then
    raise exception 'ASLC no tiene fila de agente con la credencial propia: corre antes 02_aprovisionar_sin_activar.sql';
  end if;
  if v_opciones -> 'activacion_pendiente' is not null then
    raise exception 'la configuración sigue con el candado activacion_pendiente: corre antes 03_configurar_completo_sin_activar.sql';
  end if;
  if coalesce(v_opciones #>> '{cierre,modo}', '') <> 'aceptacion_humana' or v_opciones -> 'envios' is null or v_opciones -> 'oficina' is null or v_opciones -> 'campos' is null then
    raise exception 'la configuración de ASLC no está completa (cierre, envíos, oficina y campos): corre antes 03_configurar_completo_sin_activar.sql';
  end if;
  if v_checkout is distinct from true then
    raise exception 'checkout_conversacional debe estar encendido (lo enciende 03_configurar_completo_sin_activar.sql)';
  end if;
  v_responsable := (v_opciones #>> '{cierre,responsable,miembro_id}')::bigint;
  if not exists (select 1 from public.dulabs_miembros_equipo where id = v_responsable and tenant_id = v_tenant and estado = 'activo' and rol in ('admin', 'agente')) then
    raise exception 'la persona responsable configurada (%) ya no es un miembro ACTIVO de ASLC con rol admin o agente', v_responsable;
  end if;
  -- notificaciones_pedidos debe seguir APAGADO: encendido mandaría también los avisos genéricos de otras etapas del pedido (con el tono de otro negocio).
  if exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'notificaciones_pedidos' and habilitado) then
    raise exception 'el módulo notificaciones_pedidos está encendido para ASLC: apágalo antes (mandaría avisos genéricos de otro negocio)';
  end if;

  update public.dulabs_clientes_config set ia_restringida_a = null where phone_number_id = v_phone and id_tenant = v_tenant;

  -- Comprobación final dentro de la misma transacción.
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and ia_pausada is false and ia_restringida_a is null) then
    raise exception 'ASLC no quedó abierto como se esperaba: abortando';
  end if;
end $$;
