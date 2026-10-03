-- FASE 3B.9D — EQUIPO DE AQUÍ SÍ LO COMPRAS (SOLO LECTURA)
-- GENERADO por lib/agente/activacion-aslc.ts: no se edita a mano (salvo las líneas marcadas con "← EDITAR"); una prueba verifica que este archivo es EXACTAMENTE su salida.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- Lista a las personas del equipo de ASLC. Para ser RESPONSABLE de aceptar pedidos hace falta: estado = 'activo' y rol = 'admin' o 'agente'.
-- Una persona recién invitada aparece como 'invitado' hasta que entra por primera vez; un 'suspendido' o un rol 'lectura' no sirve.
-- Copia el miembro_id de la persona elegida a v_responsable en 03_configurar_completo_sin_activar.sql (o 09_cambiar_responsable.sql).

select id as miembro_id, nombre, rol, estado, (rol in ('admin', 'agente') and estado = 'activo') as sirve_como_responsable
  from public.dulabs_miembros_equipo
 where tenant_id::text = '320121d7-2bc5-472d-944b-5191cc228e1f'
 order by id;
