-- AMORE (autorizado) — protección contra ciclo cuando la clienta ignora el
-- menú de bienvenida (modo='inicio', ver lib/amore-entrada-router.ts). A
-- diferencia de Agenda V2 (dulabs_agenda_v2_sesiones.intentos_fallidos_consecutivos,
-- 20261006000000), esta capa NO tiene ninguna sesión de Agenda V2 activa
-- todavía -- el estado conversacional pre-Agenda-V2 vive en
-- dulabs_amore_entrada, así que el contador necesita su propia columna acá
-- (mismo PATRÓN exacto, tabla distinta -- nunca se pudo reutilizar la
-- columna de Agenda V2 porque en este punto ni siquiera existe una fila en
-- dulabs_agenda_v2_sesiones).
--
-- Se reinicia a 0 explícitamente en los puntos de progreso real (interés en
-- productos, opción 1/2, intención determinista equivalente a 1/3) --
-- ver procesarEntradaAmore. El código ya es defensivo si esta migración
-- todavía no se ha aplicado (mismo mecanismo YA existente en este archivo
-- para atencion_humana_desde: reintenta el INSERT/UPDATE sin esta columna
-- ante PGRST204/42703).

alter table dulabs_amore_entrada
  add column if not exists intentos_fallidos_consecutivos integer not null default 0;
