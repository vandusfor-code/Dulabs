-- Separa "el mensaje quedó registrado" de "el mensaje ya se procesó para
-- intentar responder". Antes eran la misma cosa (la existencia de la fila
-- con ese wamid), y el registro solo ocurría DENTRO del trabajo diferido
-- (after()) del webhook -- si ese trabajo diferido nunca llegaba a correr
-- (falla puntual de la infraestructura), el mensaje desaparecía sin dejar
-- ningún rastro, ni siquiera un "entrante" en el historial.
--
-- Con esta columna, el mensaje se registra de forma SÍNCRONA al recibir el
-- webhook (antes de responder 200 a Meta) -- siempre queda visible. El
-- procesamiento real (que sí sigue siendo diferido, por tiempo) marca esta
-- columna cuando efectivamente lo atiende, de forma atómica (UPDATE ...
-- WHERE procesado_at IS NULL) para seguir protegiendo contra reintentos
-- duplicados de Meta.
alter table public.dulabs_mensajes_log
  add column if not exists procesado_at timestamptz;

comment on column public.dulabs_mensajes_log.procesado_at is
  'Cuándo se procesó este mensaje entrante para intentar responder (agenda, IA, encuesta, etc.). Null en mensajes salientes, o en entrantes que todavía no se han procesado -- si sigue null varios minutos después de created_at, algo falló y nadie respondió (ver /api/cron/mensajes-sin-respuesta).';
