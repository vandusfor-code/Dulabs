-- Restringe temporalmente la IA de un número a solo responderle a ciertos
-- remitentes (ej. mientras se prueba algo nuevo y no se quiere que clientes
-- reales reciban respuestas todavía). NULL = comportamiento normal, responde
-- a cualquiera. Con valor: coma-separada de números normalizados (solo
-- dígitos, con código de país) -- cualquier otro remitente sigue quedando
-- registrado en el log, simplemente no recibe respuesta de IA.

alter table public.dulabs_clientes_config
  add column if not exists ia_restringida_a text;

comment on column public.dulabs_clientes_config.ia_restringida_a is
  'NULL = la IA responde a cualquiera (normal). Con valor: lista de números (solo dígitos, coma-separados) -- SOLO esos remitentes reciben respuesta; el resto queda registrado pero en silencio. Pensado para pausar temporalmente la atención al público sin desconectar el número ni tocar ia_pausada (que apaga TODO, incluidas las pruebas propias).';
