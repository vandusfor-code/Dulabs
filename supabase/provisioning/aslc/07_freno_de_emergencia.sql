-- FASE 3B.9D — FRENO DE EMERGENCIA DE AQUÍ SÍ LO COMPRAS
-- GENERADO por lib/agente/activacion-aslc.ts: no se edita a mano (salvo las líneas marcadas con "← EDITAR"); una prueba verifica que este archivo es EXACTAMENTE su salida.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- Pausa la IA de ASLC AL INSTANTE: el agente deja de contestar (silencio total, nunca otro bot). Los mensajes de los clientes siguen llegando al Inbox
-- para atenderlos a mano. No borra nada ni toca la configuración. Para reanudar: 10_reanudar_tras_freno.sql (deja la restricción tal como estaba).

update public.dulabs_clientes_config
   set ia_pausada = true
 where id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f' and phone_number_id::text = '1317599831437793' and nombre_negocio ~* 'lo compras'
returning nombre_negocio, ia_pausada, ia_restringida_a is not null as restringida;
