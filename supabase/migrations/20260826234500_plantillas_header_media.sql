-- Soporte de encabezado con media (imagen/video/documento) en plantillas de
-- WhatsApp -- hasta ahora dulabs_plantillas solo modelaba BODY/FOOTER/BUTTONS,
-- ninguna plantilla con imagen podía registrarse ni enviarse desde el panel.
-- NULL = sin encabezado de media (como todas las plantillas existentes).

alter table public.dulabs_plantillas
  add column if not exists header_formato text; -- 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null
