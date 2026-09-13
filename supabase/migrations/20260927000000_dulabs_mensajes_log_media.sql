-- FASE F8.4 (WhatsApp Media, autorizado) -- columnas de metadata de media
-- en dulabs_mensajes_log, additive-only (mismo criterio que
-- 20260827020000_error_entrega_mensajes.sql / 20260715090000_campanas_y_estado_entrega.sql:
-- columnas nuevas, nullable, default NULL, cero cambio de comportamiento
-- para ninguna fila existente).
--
-- Deliberadamente NO se agrega ninguna columna para el binario en sí --
-- ver regla de F8.4 "no almacenar contenido binario innecesariamente en
-- Supabase": solo se persiste la REFERENCIA (media_id de Meta, o la URL que
-- el propio Flow configuró), nunca los bytes. Meta es quien sirve/descarga
-- el archivo real en ambos sentidos.

alter table public.dulabs_mensajes_log
  add column if not exists media_tipo text, -- image | video | audio | document | sticker (ver FlowMediaType)
  add column if not exists media_id text, -- media id de Meta (si se envió/recibió por id)
  add column if not exists media_url text, -- URL pública configurada por el Flow (si se envió por link) -- NUNCA la URL firmada temporal de Meta para descarga entrante
  add column if not exists media_mime_type text,
  add column if not exists media_filename text, -- solo aplica a document
  add column if not exists media_tamano_bytes bigint;

comment on column public.dulabs_mensajes_log.media_tipo is
  'FASE F8.4 -- tipo de media Meta Cloud API (image/video/audio/document/sticker), NULL para mensajes sin media.';
comment on column public.dulabs_mensajes_log.media_id is
  'FASE F8.4 -- media id de Meta. Para outbound: presente solo si el Flow lo envió por mediaId (no por URL). Para un futuro inbound: el media id que Meta asigna al archivo recibido.';
comment on column public.dulabs_mensajes_log.media_url is
  'FASE F8.4 -- URL pública que el Flow configuró para el envío (nunca una URL firmada de descarga de Meta, esas expiran en minutos y no se persisten).';
comment on column public.dulabs_mensajes_log.media_mime_type is
  'FASE F8.4 -- MIME type del archivo, cuando se conoce.';
comment on column public.dulabs_mensajes_log.media_filename is
  'FASE F8.4 -- nombre de archivo mostrado al destinatario, solo aplica a media_tipo=document.';
comment on column public.dulabs_mensajes_log.media_tamano_bytes is
  'FASE F8.4 -- tamaño en bytes cuando esté disponible (Meta no siempre lo reporta en outbound).';

create index if not exists dulabs_mensajes_log_media_tipo_idx
  on public.dulabs_mensajes_log (phone_number_id, media_tipo)
  where media_tipo is not null;
