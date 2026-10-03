-- FASE 3B.9D — ACTIVACIÓN CONTROLADA DE AQUÍ SÍ LO COMPRAS
-- GENERADO por lib/agente/activacion-aslc.ts: no se edita a mano (salvo las líneas marcadas con "← EDITAR"); una prueba verifica que este archivo es EXACTAMENTE su salida.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- Correr DESPUÉS de 03_configurar_completo_sin_activar.sql y DESPUÉS de que el código con el cierre por aceptación humana esté desplegado.
--
-- QUÉ HACE:
--   1. Identifica a ASLC (tenant + phone_number_id + nombre): exactamente UNA fila.
--   2. EXIGE que la IA esté restringida a números de prueba (ia_restringida_a no vacío). Si no lo está, SE NIEGA: este script nunca abre al público.
--   3. Exige la configuración completa cargada (sin candado, cierre, envíos, oficina, campos, checkout conversacional) y a la persona responsable ACTIVA.
--   4. Exige que notificaciones_pedidos siga apagado.
--   5. Habilita la fila del agente, enciende la transcripción de notas de voz y quita la pausa de la IA.
-- RESULTADO: el agente contesta SOLO a los números de ia_restringida_a (tu número de prueba). Cualquier otro número queda en silencio.
-- QUÉ NO HACE: no toca ia_restringida_a (sigue protegiendo), notificaciones_pedidos, módulos ni otros negocios.
-- FRENO: 07_freno_de_emergencia.sql pausa la IA al instante. Para abrir al público, DESPUÉS de probar: 06_abrir_al_publico.sql.

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

  -- Modo controlado: la IA debe seguir restringida a números de prueba.
  select ia_restringida_a into v_restringida from public.dulabs_clientes_config where phone_number_id = v_phone and id_tenant = v_tenant;
  if coalesce(btrim(v_restringida), '') = '' then
    raise exception 'la IA de ASLC NO está restringida a números de prueba: este script no abre al público. Primero restringe: update public.dulabs_clientes_config set ia_restringida_a = ''57XXXXXXXXXX'' where phone_number_id = ''1317599831437793'';';
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

  update public.dulabs_agente_runtime_config
     set habilitado = true, transcripcion_audio = true, updated_at = now()
   where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo habilitar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;
  update public.dulabs_clientes_config set ia_pausada = false where phone_number_id = v_phone and id_tenant = v_tenant;

  -- Comprobación final dentro de la misma transacción.
  if not exists (
    select 1 from public.dulabs_agente_runtime_config
     where phone_number_id = v_phone and habilitado is true and checkout_conversacional is true and transcripcion_audio is true and meta_token_plataforma is false
  ) then
    raise exception 'la fila del agente de ASLC no quedó habilitada como se esperaba: abortando';
  end if;
  if not exists (select 1 from public.dulabs_clientes_config where phone_number_id = v_phone and ia_pausada is false and coalesce(btrim(ia_restringida_a), '') <> '') then
    raise exception 'ASLC debe quedar SIN pausa y con la restricción a números de prueba: abortando';
  end if;
end $$;
