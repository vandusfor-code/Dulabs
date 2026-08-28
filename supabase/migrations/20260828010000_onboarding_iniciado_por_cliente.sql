-- Cambia quién inicia la conversación de onboarding: en vez de que DuLabs le
-- escriba primero al cliente (lo que exige una plantilla aprobada por Meta
-- para saltarse la ventana de 24h), ahora el checkout redirige al cliente a
-- un link wa.me con el mensaje ya escrito -- el cliente lo envía él mismo,
-- eso abre la ventana de servicio de verdad, y AHÍ el backend responde con
-- la bienvenida real (ver app/webhook-dulabs/route.ts, atenderMensajeOnboarding).
--
-- dispararOnboardingSiAplica (lib/onboarding-trigger.ts) deja de mandar nada
-- por WhatsApp al confirmarse el pago -- solo crea la sesión. Esta columna
-- distingue "sesión creada, esperando el primer mensaje real del cliente" de
-- "ya se le mandó la bienvenida" para no volver a mandarla dos veces.
alter table public.dulabs_onboarding_sesiones
  add column if not exists bienvenida_enviada_at timestamptz;

comment on column public.dulabs_onboarding_sesiones.bienvenida_enviada_at is
  'Momento en que se envió la bienvenida real (botones), disparada por el primer mensaje del cliente -- no por el pago. Null = aún no ha escrito.';
