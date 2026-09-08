-- AMORE (autorizado, Fase 1 de atención humana) — amplía el "puente"
-- conversacional (dulabs_amore_entrada, Fase 9) con un tercer modo:
-- 'atencion_humana'. Migración puramente ADITIVA: no toca ninguna fila
-- existente, no borra ningún valor permitido de `modo`, no afecta a ningún
-- otro tenant (la tabla ya es exclusiva de AMORE, ver amore-entrada-router.ts).
--
-- Reversible: `alter table ... drop constraint ...` + recrear el CHECK
-- anterior (solo 'inicio'/'gemini') y `alter table ... drop column
-- notificado_a_jessica` -- seguro mientras ninguna fila real tenga todavía
-- modo='atencion_humana' (si ya la tuviera, revertir el CHECK fallaría, que
-- es el comportamiento correcto: Postgres nunca te deja violar en silencio
-- datos ya guardados).

alter table public.dulabs_amore_entrada
  drop constraint if exists dulabs_amore_entrada_modo_check;

alter table public.dulabs_amore_entrada
  add constraint dulabs_amore_entrada_modo_check
  check (modo in ('inicio', 'gemini', 'atencion_humana'));

alter table public.dulabs_amore_entrada
  add column if not exists notificado_a_jessica boolean not null default false;

comment on column public.dulabs_amore_entrada.notificado_a_jessica is
  'Fase 1 (atención humana) -- true en cuanto se envía la notificación real a Jessica para esta conversación. Idempotencia: mientras siga true y modo siga en atencion_humana, ningún mensaje adicional de la clienta vuelve a notificar.';
