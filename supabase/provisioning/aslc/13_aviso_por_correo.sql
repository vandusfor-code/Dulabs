-- FASE 3B.9D — AVISO POR CORREO A LA PERSONA RESPONSABLE DE AQUÍ SÍ LO COMPRAS
-- GENERADO por lib/agente/activacion-aslc.ts: no se edita a mano (salvo las líneas marcadas con "← EDITAR"); una prueba verifica que este archivo es EXACTAMENTE su salida.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- Cuando el cliente confirma su pedido, la conversación se le asigna a la persona responsable y el pedido aparece en Pedidos → Por aceptar (panel). Este script
-- agrega un correo a esa persona (solo el número de pedido y el enlace al panel; ningún dato del cliente), para que no dependa de estar mirando el panel.
--
-- QUÉ HACE: cambia SOLO checkout_opciones.cierre.responsable.canales de la fila del agente de ASLC a ["panel", "correo"].
-- GUARDAS (todo o nada): la fila con la configuración completa cargada; la persona responsable ACTIVA, con rol admin o agente y CON un correo válido
--   (sin correo la configuración quedaría inválida y el agente callaría: por eso se niega).
-- QUÉ NO HACE: no toca ia_pausada, ia_restringida_a, habilitado, módulos, textos ni otros negocios, y no envía nada por sí mismo. El correo sale por Resend
--   (RESEND_API_KEY ya existe en producción); sin la clave el correo simplemente no sale y el panel sigue igual. Remitente opcional: PEDIDOS_EMAIL_FROM.
-- Se puede repetir sin efectos nuevos.
--
-- REVERSA (volver a solo el panel):
--   update public.dulabs_agente_runtime_config
--      set checkout_opciones = jsonb_set(checkout_opciones, '{cierre,responsable,canales}', '["panel"]'::jsonb), updated_at = now()
--    where phone_number_id = '1317599831437793' and id_tenant = '320121d7-2bc5-472d-944b-5191cc228e1f'::uuid and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC';

do $$
declare
  v_tenant uuid;
  v_phone text;
  v_filas integer;
  v_opciones jsonb;
  v_responsable bigint;
begin
  -- Identidad: UNA sola fila con ese tenant, ese phone_number_id y ese nombre.
  select count(*) into v_filas from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';
  if v_filas <> 1 then
    raise exception 'ASLC: se esperaba exactamente UNA fila de dulabs_clientes_config (tenant, phone_number_id y nombre), hay %', v_filas;
  end if;
  select id_tenant, phone_number_id into v_tenant, v_phone from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';

  select checkout_opciones into v_opciones from public.dulabs_agente_runtime_config
   where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC' and checkout_opciones -> 'activacion_pendiente' is null and coalesce(checkout_opciones #>> '{cierre,modo}', '') = 'aceptacion_humana';
  if v_opciones is null then
    raise exception 'se esperaba la fila del agente de ASLC con la configuración completa cargada (sin candado y con el cierre por aceptación humana): corre antes 03_configurar_completo_sin_activar.sql';
  end if;

  -- La persona responsable: ACTIVA, con rol que decide y CON un correo válido (sin correo, el runtime marcaría la configuración como inválida y el agente callaría).
  v_responsable := (v_opciones #>> '{cierre,responsable,miembro_id}')::bigint;
  if not exists (
    select 1 from public.dulabs_miembros_equipo
     where id = v_responsable and tenant_id = v_tenant and estado = 'activo' and rol in ('admin', 'agente')
       and btrim(coalesce(email, '')) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'la persona responsable configurada (%) no es un miembro ACTIVO de ASLC con rol admin o agente y un correo válido: no se cambia nada', v_responsable;
  end if;

  update public.dulabs_agente_runtime_config
     set checkout_opciones = jsonb_set(checkout_opciones, '{cierre,responsable,canales}', '["panel","correo"]'::jsonb), updated_at = now()
   where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo actualizar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;

  -- Comprobación final dentro de la misma sentencia.
  if not exists (
    select 1 from public.dulabs_agente_runtime_config
     where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC'
       and checkout_opciones #> '{cierre,responsable,canales}' = '["panel","correo"]'::jsonb
       and checkout_opciones -> 'activacion_pendiente' is null
  ) then
    raise exception 'la fila del agente de ASLC no quedó como se esperaba: abortando';
  end if;
end $$;
