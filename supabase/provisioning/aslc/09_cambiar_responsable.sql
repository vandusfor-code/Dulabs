-- FASE 3B.9D — CAMBIAR LA PERSONA RESPONSABLE DE AQUÍ SÍ LO COMPRAS
-- GENERADO por lib/agente/activacion-aslc.ts: no se edita a mano (salvo las líneas marcadas con "← EDITAR"); una prueba verifica que este archivo es EXACTAMENTE su salida.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- ANTES DE CORRER: editar las DOS líneas marcadas con "← EDITAR" (v_responsable y v_respaldo).
-- Sirve con la fila ya habilitada: cambia SOLO cierre.responsable.miembro_id y respaldo_miembro_id de checkout_opciones y deja todo lo demás igual.
-- Los pedidos que ya están pendientes siguen asignados a la persona anterior (se reasignan desde el Inbox); los nuevos van a la persona nueva.

do $$
declare
  v_responsable bigint := null;  -- ← EDITAR: id de la nueva persona responsable (obligatorio)
  v_respaldo bigint := null;     -- ← EDITAR (opcional): id de la persona de respaldo, o dejar null
  v_tenant uuid;
  v_phone text;
  v_filas integer;
  v_opciones jsonb;
begin
  -- Identidad: UNA sola fila con ese tenant, ese phone_number_id y ese nombre.
  select count(*) into v_filas from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';
  if v_filas <> 1 then
    raise exception 'ASLC: se esperaba exactamente UNA fila de dulabs_clientes_config (tenant, phone_number_id y nombre), hay %', v_filas;
  end if;
  select id_tenant, phone_number_id into v_tenant, v_phone from public.dulabs_clientes_config where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';

  -- Persona responsable: obligatoria, del equipo de ASLC, ACTIVA y con rol admin o agente (un rol "lectura" no puede aceptar pedidos).
  if v_responsable is null then
    raise exception 'PATRICIA_REAL_PENDIENTE: edita v_responsable con el id de la persona responsable (ver 08_ver_equipo_solo_lectura.sql)';
  end if;
  if not exists (select 1 from public.dulabs_miembros_equipo where id = v_responsable and tenant_id = v_tenant and estado = 'activo' and rol in ('admin', 'agente')) then
    raise exception 'v_responsable (%) no es un miembro ACTIVO del equipo de ASLC con rol admin o agente (un invitado que aún no entró, un suspendido o un rol lectura no sirven)', v_responsable;
  end if;
  if v_respaldo is not null then
    if v_respaldo = v_responsable then
      raise exception 'el respaldo no puede ser la misma persona que la responsable';
    end if;
    if not exists (select 1 from public.dulabs_miembros_equipo where id = v_respaldo and tenant_id = v_tenant and estado = 'activo' and rol in ('admin', 'agente')) then
      raise exception 'v_respaldo (%) no es un miembro ACTIVO del equipo de ASLC con rol admin o agente', v_respaldo;
    end if;
  end if;

  select checkout_opciones into v_opciones from public.dulabs_agente_runtime_config where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC';
  if v_opciones is null or v_opciones -> 'activacion_pendiente' is not null or coalesce(v_opciones #>> '{cierre,modo}', '') <> 'aceptacion_humana' then
    raise exception 'ASLC no tiene la configuración completa cargada: corre antes 03_configurar_completo_sin_activar.sql';
  end if;
  v_opciones := jsonb_set(v_opciones, '{cierre,responsable,miembro_id}', to_jsonb(v_responsable));
  v_opciones := jsonb_set(v_opciones, '{cierre,responsable,respaldo_miembro_id}', coalesce(to_jsonb(v_respaldo), 'null'::jsonb));

  update public.dulabs_agente_runtime_config set checkout_opciones = v_opciones, updated_at = now() where phone_number_id = v_phone and id_tenant = v_tenant and tipo = 'catalog_sales' and credencial_ref = 'env:GEMINI_KEY_ASLC';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo actualizar exactamente UNA fila del agente (%): abortando', v_filas;
  end if;
end $$;
