-- PILOTO AMORE + Nylas (autorizado, FASE B) -- relación PERSISTENTE
-- especialista -> calendar_id de Nylas.
--
-- Auditoría previa (FASE B1): dulabs_especialistas no tiene ninguna columna
-- ni tabla adecuada para esto. Se reutiliza la tabla ya existente en vez de
-- crear una nueva (mismo patrón ya usado en migraciones anteriores de esta
-- misma tabla: 20260825201000, 20260825220000, 20260825240000,
-- 20260826020000, 20260904030000 -- todas alter table aditivas).
--
-- Nullable a propósito: NINGÚN especialista existente (de NINGÚN tenant,
-- incluida AMORE hoy mismo) tiene valor todavía -- se puebla manualmente
-- solo para las 4 profesionales reales de AMORE, una vez confirmados sus
-- calendar_id reales (ver FASE A). Cualquier especialista sin este valor
-- simplemente no tiene fuente de Nylas (el motor de disponibilidad cae de
-- vuelta a solo DuLabs, sin romper nada para Daniela/Solo Talento/cualquier
-- otro tenant).
alter table public.dulabs_especialistas
  add column if not exists nylas_calendar_id text;

comment on column public.dulabs_especialistas.nylas_calendar_id is
  'calendar_id real de Nylas (Google Calendar) de esta profesional, si tiene uno asociado. NULL = sin Nylas, el motor de disponibilidad usa solo datos de DuLabs. Piloto AMORE (FASE B).';
