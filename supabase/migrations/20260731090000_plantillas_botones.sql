-- Botones de respuesta rápida (QUICK_REPLY) para plantillas de WhatsApp.
-- Aditiva: agrega una sola columna, no toca nada existente.

alter table public.dulabs_plantillas
  add column if not exists botones jsonb not null default '[]'::jsonb;

comment on column public.dulabs_plantillas.botones is
  'Textos de los botones QUICK_REPLY de la plantilla (arreglo de hasta 3 strings), enviados a Meta al crearla. Vacío = sin botones.';
