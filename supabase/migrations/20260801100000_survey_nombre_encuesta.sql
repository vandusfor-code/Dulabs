-- El nombre de la encuesta (para el listado en /dashboard/surveys y para
-- llenar {{nombre_encuesta}} en la plantilla de invitación de Meta) se
-- confundía con brand_name (nombre de la empresa) porque nunca existió un
-- campo propio. Puramente aditiva.
alter table public.dulabs_survey_bot_config
  add column if not exists survey_name text not null default '';

comment on column public.dulabs_survey_bot_config.survey_name is
  'Nombre propio de la encuesta (ej. "Encuesta de satisfacción Q3"), distinto de brand_name (la empresa). Llena {{nombre_encuesta}} en la plantilla de invitación de Meta y es el nombre que se muestra en /dashboard/surveys.';
