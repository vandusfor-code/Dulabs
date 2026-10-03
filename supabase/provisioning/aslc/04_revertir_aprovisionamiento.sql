-- FASE 3B.9A — REVERSA DEL APROVISIONAMIENTO DE AQUÍ SÍ LO COMPRAS (02_aprovisionar_sin_activar.sql).
--
-- Deja al negocio como estaba ANTES del script 02:
--   * borra la fila del agente SOLO si sigue siendo la que creó el script (deshabilitada, credencial propia, sin checkout ni audio): si alguien la
--     cambió o la habilitó, ABORTA para revisarla a mano (no se pierde configuración);
--   * apaga los módulos catalogo, pedidos y pedidos_por_aceptar SOLO si 01_verificar_estado_solo_lectura.sql (corrido ANTES de aprovisionar) mostró que NO estaban
--     habilitados. Si alguno ya lo estaba, editar la lista v_apagar de abajo y quitarlo.
-- No toca ia_pausada, ia_restringida_a, ningún otro negocio, productos ni pedidos.
--
-- ATENCIÓN: sin la fila del agente, el número vuelve a poder caer a otros caminos (Flow, Business Agent, legacy) si se quita la pausa de la IA.
-- No quitar ia_pausada mientras no exista una fila del agente (deshabilitada o no).

begin;

do $$
declare
  v_tenant uuid;
  v_phone text;
  v_filas integer;
  v_apagar text[] := array['catalogo', 'pedidos', 'pedidos_por_aceptar'];  -- ← quitar los que YA estaban habilitados antes del script 02 (el 2026-10-03 ASLC no tenía ninguna fila de módulos)
begin
  select count(*) into v_filas from public.dulabs_clientes_config
   where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';
  if v_filas <> 1 then
    raise exception 'ASLC: se esperaba exactamente UNA fila de dulabs_clientes_config, hay %', v_filas;
  end if;
  select id_tenant, phone_number_id into v_tenant, v_phone from public.dulabs_clientes_config
   where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras';

  if exists (
    select 1 from public.dulabs_agente_runtime_config
     where phone_number_id = v_phone
       and (habilitado is distinct from false or credencial_ref <> 'env:GEMINI_KEY_ASLC' or checkout_conversacional is distinct from false or transcripcion_audio is distinct from false)
  ) then
    raise exception 'la fila del agente de ASLC ya no es la del aprovisionamiento (habilitada o modificada): no se borra, revisarla a mano';
  end if;

  delete from public.dulabs_agente_runtime_config where phone_number_id = v_phone and id_tenant = v_tenant;
  update public.dulabs_tenant_modulos set habilitado = false, updated_at = now() where id_tenant = v_tenant and modulo = any (v_apagar);
end $$;

commit;
