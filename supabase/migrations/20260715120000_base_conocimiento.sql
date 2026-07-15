-- Base de conocimiento por negocio: texto extraído de un Excel/CSV (listado
-- de precios/productos) o PDF (estatutos, políticas, catálogo) subido por el
-- cliente, que se agrega al contexto del sistema en cada respuesta de la IA.

alter table public.dulabs_clientes_config
  add column if not exists base_conocimiento text,
  add column if not exists base_conocimiento_nombre_archivo text,
  add column if not exists base_conocimiento_actualizado_at timestamptz;

comment on column public.dulabs_clientes_config.base_conocimiento is
  'Texto extraído del último archivo subido (Excel/CSV/PDF), inyectado en el system prompt de la IA junto con prompt_sistema.';
