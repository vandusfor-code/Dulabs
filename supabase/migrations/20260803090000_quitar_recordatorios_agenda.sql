-- Elimina los recordatorios automáticos de citas y las notificaciones al
-- admin del módulo de Agenda: ambos dependían de mensajes de texto libre
-- fuera de la ventana de 24h de WhatsApp, que fallan sin una plantilla
-- Utility aprobada por Meta (nunca se construyó esa plantilla). El módulo se
-- queda solo con lo que funciona de forma confiable dentro de la
-- conversación misma: agendar, cancelar, reagendar, consultar — incluida la
-- consulta del admin ("¿qué citas tengo mañana?"), que no depende de
-- mensajes proactivos.
--
-- Elimina las columnas que solo servían para esa lógica ahora retirada.

drop index if exists public.dulabs_marketplace_citas_recordatorio_idx;

alter table public.dulabs_marketplace_citas
  drop column if exists recordatorio_enviado;

alter table public.dulabs_marketplace_activaciones
  drop column if exists recordatorio_template_name;
