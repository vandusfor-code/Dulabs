-- Footer (pie de página) opcional para plantillas de WhatsApp. Aditiva: una
-- sola columna nullable, no toca botones ni ninguna otra columna existente.
-- Mismo criterio que 20260731090000_plantillas_botones.sql (esa migración
-- no se toca ni se repite).

alter table public.dulabs_plantillas
  add column if not exists footer text;

comment on column public.dulabs_plantillas.footer is
  'Texto del componente FOOTER de la plantilla de Meta (pie de página, ej. "Aplican términos y condiciones."). NULL = sin footer -- las plantillas existentes (creadas antes de esta columna) siguen funcionando exactamente igual, sin FOOTER en su payload a Meta.';
