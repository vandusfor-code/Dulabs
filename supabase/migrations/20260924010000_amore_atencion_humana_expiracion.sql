-- AMORE — atención humana con expiración real (autorizado). Hasta ahora,
-- una vez una conversación entraba en modo "atencion_humana"
-- (interceptarAtencionHumanaAmore, lib/amore-entrada-router.ts), el bot
-- guardaba silencio TOTAL con ese contacto para siempre, sin ninguna forma
-- automática de volver a responder -- solo un cambio manual directo en la
-- base de datos lo revertía (incidente real: quedó así desde el
-- 2026-09-08 en un número de pruebas). Esta columna guarda el momento EXACTO
-- en que se activó ese modo (nunca se toca en los demás cambios de la fila,
-- a diferencia de updated_at) para que el gate pueda calcular cuánto tiempo
-- lleva esperando y expirarlo solo tras 24 horas -- ver
-- lib/amore-entrada-router.ts::interceptarAtencionHumanaAmore.

alter table public.dulabs_amore_entrada
  add column if not exists atencion_humana_desde timestamptz;

comment on column public.dulabs_amore_entrada.atencion_humana_desde is
  'Momento en que esta conversación entró en modo atencion_humana -- usado SOLO para calcular la expiración de 24h (nunca se actualiza en otros cambios de fila, a diferencia de updated_at). null para filas que nunca han estado en ese modo.';
