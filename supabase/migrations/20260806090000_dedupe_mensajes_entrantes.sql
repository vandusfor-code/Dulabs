-- Cierra el hallazgo #6 de la auditoría: no había deduplicación real de
-- mensajes entrantes de WhatsApp. Meta reentrega el mismo webhook si no
-- respondemos 200 a tiempo, y sin este candado, un reintento legítimo
-- reprocesaba el mensaje completo — duplicando el historial, el consumo de
-- cupo de IA, y en modo Agenda pudiendo generar una segunda cita real para
-- el mismo mensaje del cliente.
--
-- dulabs_mensajes_log.wamid ya existía (id del mensaje asignado por Meta,
-- hoy usado solo para correlacionar estados de entrega de mensajes
-- SALIENTES vía los webhooks de status) pero sin ninguna restricción de
-- unicidad. Se reutiliza tal cual para mensajes ENTRANTES y ecos de
-- coexistencia en vez de crear una tabla nueva: cada mensaje real de
-- WhatsApp (entrante o saliente) tiene un wamid único asignado por Meta, así
-- que un UNIQUE aquí es semánticamente correcto para ambos casos. NULL se
-- permite repetido (comportamiento estándar de un UNIQUE constraint en
-- Postgres) para no romper filas antiguas ni el caso donde enviarTexto no
-- devuelva wamid.
--
-- Verificado antes de escribir esta migración: 51/51 filas con wamid no
-- nulo eran ya únicas en la base real, así que el ADD CONSTRAINT no falla.

drop index if exists public.dulabs_mensajes_log_wamid_idx;

alter table public.dulabs_mensajes_log
  add constraint dulabs_mensajes_log_wamid_unico unique (wamid);

comment on column public.dulabs_mensajes_log.wamid is
  'ID del mensaje asignado por Meta (WAMID). Único cuando no es null: correlaciona estados de entrega de mensajes salientes Y sirve de candado de deduplicación real para mensajes entrantes/ecos contra reintentos del webhook de Meta (el INSERT en app/webhook-dulabs/route.ts falla con 23505 si este wamid ya fue procesado).';
