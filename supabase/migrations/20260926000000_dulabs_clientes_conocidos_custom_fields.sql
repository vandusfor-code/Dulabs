-- FASE F7 (Contacts + Variables + Tags, autorizado) — extensión ADITIVA de
-- dulabs_clientes_conocidos para soportar campos personalizados por
-- contacto (Flow Engine: save_data target="custom_field" +
-- contact.custom_fields -> state.variables al iniciar una ejecución).
--
-- Reutiliza la tabla real ya existente (20260825250000_clientes_conocidos.sql)
-- -- NO crea una tabla de contactos paralela. Ninguna columna/constraint/
-- índice existente se toca: nombre, correo, cumple_dia, cumple_mes y el
-- unique (phone_number_id, telefono_cliente) siguen exactamente igual.
--
-- jsonb + default '{}'::jsonb + not null: cualquier fila ya existente (AMORE,
-- Daniela, Solo Talento) queda con '{}' automáticamente al aplicar la
-- migración -- ningún caller actual (recordarNombreCliente, nombreConocido,
-- clienteConocidoCompleto en lib/clientes-conocidos.ts) lee ni escribe esta
-- columna, así que su comportamiento no cambia en absoluto.

alter table public.dulabs_clientes_conocidos
  add column custom_fields jsonb not null default '{}'::jsonb;

comment on column public.dulabs_clientes_conocidos.custom_fields is
  'Campos personalizados por contacto (Flow Engine F7) -- poblados vía save_data(target=custom_field) y expuestos como variables sin prefijo al iniciar una ejecución (mismo patrón que "hoy"/"baseConocimiento"). No es un CRM: sigue siendo un registro plano por (phone_number_id, telefono_cliente).';
