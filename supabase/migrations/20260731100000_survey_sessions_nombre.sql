-- Nombre del participante (opcional), capturado al invitarlo — usado para
-- personalizar la plantilla de invitación ({{nombre_cliente}}) y disponible
-- para futura personalización de mensajes. Aditiva.

alter table public.dulabs_survey_sessions
  add column if not exists nombre_participante text;

comment on column public.dulabs_survey_sessions.nombre_participante is
  'Nombre del participante si se conoció al invitarlo (ver /api/dashboard/surveys/invitar). Null si solo se tenía el teléfono.';
