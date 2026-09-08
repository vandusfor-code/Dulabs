-- AMORE (autorizado, Fase 2 registro de clientes nuevos) — amplía el
-- "puente" conversacional (dulabs_amore_entrada, Fases 9/1) con tres modos
-- nuevos para el registro determinístico de un cliente nuevo antes de
-- entrar a Agenda V2. Migración puramente ADITIVA: no toca ninguna fila
-- existente, no borra ningún valor permitido de `modo`, no afecta a ningún
-- otro tenant (la tabla ya es exclusiva de AMORE).
--
-- No se agrega ninguna columna nueva -- el nombre y el cumpleaños se
-- guardan progresivamente en dulabs_clientes_conocidos (ya existente, vía
-- recordarNombreCliente) a medida que se completan los pasos; `modo` solo
-- necesita saber EN QUÉ PASO está la conversación.

alter table public.dulabs_amore_entrada
  drop constraint if exists dulabs_amore_entrada_modo_check;

alter table public.dulabs_amore_entrada
  add constraint dulabs_amore_entrada_modo_check
  check (modo in ('inicio', 'gemini', 'atencion_humana', 'registro_nombre', 'registro_dia', 'registro_mes'));
