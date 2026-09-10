-- AMORE (autorizado, mejora Recordatorios) -- la anticipación real del
-- recordatorio de cita pasa de fija/no-editable (55-65 min hardcodeado en
-- app/api/cron/recordatorios-citas/route.ts) a configurable por tenant.
--
-- Se agrega una columna NUEVA en minutos (permite 15/30 min, imposibles de
-- representar limpiamente en la columna vieja `recordatorio_anticipacion_horas`,
-- que además nunca tuvo efecto real -- ver comentario de
-- RECORDATORIO_ANTICIPACION_HORAS_REAL en lib/comunicaciones/config.ts). La
-- columna vieja se deja intacta (no se lee ni se escribe más, pero no se
-- borra -- migración puramente aditiva, reversible sin pérdida de datos).
--
-- Restringida a los 9 valores pedidos por el negocio (15 min ... 2 días) --
-- nunca un número arbitrario que el motor no sepa interpretar de forma
-- predecible.

alter table public.dulabs_comunicaciones_config
  add column if not exists recordatorio_anticipacion_minutos integer not null default 60
  check (recordatorio_anticipacion_minutos in (15, 30, 60, 120, 180, 360, 720, 1440, 2880));

comment on column public.dulabs_comunicaciones_config.recordatorio_anticipacion_minutos is
  'Minutos antes de la cita en que se envía el recordatorio real (15/30/60/120/180/360/720/1440/2880 = 15min..2 días). Reemplaza a recordatorio_anticipacion_horas (nunca tuvo efecto real) -- este SÍ lo usa app/api/cron/recordatorios-citas.';
