-- Bloque 32 — la configuración del negocio del agente (`negocio`) admite hasta 64 KB (antes 8 KB).
--
-- La asesora de Delacour ("Aria") lleva personalidad y la información oficial del negocio (manual de
-- atención: ubicación, líneas, mayoristas, envíos, pagos…), unos 11 KB. El código acota cada campo
-- (lib/agente/config.ts: textos, hasta 40 temas); este tope solo evita filas desmedidas.
--
-- ADITIVA E IDEMPOTENTE: solo reemplaza el CHECK de tamaño. No cambia datos ni otras columnas; las
-- filas actuales (≤ 8 KB) cumplen. Aplicar ANTES del SQL de configuración de Aria.
--
-- Rollback (solo si ninguna fila supera 8 KB):
--   alter table public.dulabs_agente_runtime_config drop constraint if exists dulabs_agente_runtime_config_negocio_check;
--   alter table public.dulabs_agente_runtime_config add constraint dulabs_agente_runtime_config_negocio_check
--     check (jsonb_typeof(negocio) = 'object' and pg_column_size(negocio) <= 8192);

alter table public.dulabs_agente_runtime_config drop constraint if exists dulabs_agente_runtime_config_negocio_check;
alter table public.dulabs_agente_runtime_config add constraint dulabs_agente_runtime_config_negocio_check
  check (jsonb_typeof(negocio) = 'object' and pg_column_size(negocio) <= 65536);
