-- Fase 7 (asistente conversacional de Daniela) — seguimiento real cuando el
-- negocio no responde tras un traspaso (ej. consulta de productos). Aditivo
-- sobre dulabs_pausas_chat (20260713160000_pausas_chat_y_prompt_sistema.sql):
-- NO se toca su estructura existente, solo se agregan 2 columnas nuevas.
--
-- pausado_desde: cuándo se activó/renovó la pausa ACTUAL -- distinto de
-- created_at (que solo marca la primera vez que este chat se pausó alguna
-- vez). activarPausaChat() ahora la actualiza en CADA llamada -- tanto
-- cuando la IA traspasa a Daniela como cuando Daniela responde manualmente
-- (eco de coexistencia, ver lib/pausas-chat.ts) -- así, si Daniela SÍ
-- responde, el seguimiento de 5 minutos se reinicia/cancela solo, sin
-- ninguna lógica nueva de "cancelar seguimiento": ya no hay una pausa vieja
-- pendiente de avisar.
--
-- seguimiento_enviado: evita mandar el mensaje de "Dani está ocupada" más
-- de una vez por pausa. Se reinicia a false en cada renovación de la pausa,
-- por la misma razón de arriba.

alter table public.dulabs_pausas_chat
  add column pausado_desde timestamptz not null default now(),
  add column seguimiento_enviado boolean not null default false;

create index dulabs_pausas_chat_seguimiento_idx
  on public.dulabs_pausas_chat (pausado_desde)
  where not seguimiento_enviado;
