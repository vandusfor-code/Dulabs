-- Secuencia de preguntas de una en una para el bot de captación de leads:
-- teléfono -> compañía -> RUT (en vez de pedir los 3 datos en un solo
-- mensaje). Migración puramente aditiva: 2 columnas nuevas con default, no
-- toca ask_data_template (que ahora se usa como la PRIMERA pregunta,
-- teléfono) ni ninguna fila existente.

alter table public.dulabs_campaign_bot_config
  add column if not exists ask_company_template text not null default
    E'Perfecto 😊 ¿Me indicas el nombre de la compañía actual?';

alter table public.dulabs_campaign_bot_config
  add column if not exists ask_rut_template text not null default
    E'Excelente, ahora por último indícame tu número de RUT para así validar tu oferta disponible.';

comment on column public.dulabs_campaign_bot_config.ask_data_template is
  'Primera pregunta de la secuencia (teléfono) -- se envía justo después de que el cliente presiona SÍ.';
comment on column public.dulabs_campaign_bot_config.ask_company_template is
  'Segunda pregunta de la secuencia (compañía actual) -- se envía después de recibir el teléfono.';
comment on column public.dulabs_campaign_bot_config.ask_rut_template is
  'Tercera y última pregunta de la secuencia (RUT) -- se envía después de recibir la compañía.';
