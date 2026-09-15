-- F16.2 (Onboarding comercial: pago -> conectar WhatsApp con Meta ->
-- plantilla bienvenida_dulabs, autorizado) -- migración puramente aditiva.
--
-- Reusa dulabs_onboarding_sesiones (ya existía, una fila por tenant para
-- siempre -- ver 20260827050000_onboarding_dulabs.sql) en vez de crear una
-- tabla nueva. bienvenida_enviada_at ya trackea la bienvenida CONVERSACIONAL
-- (la que dispara el link wa.me del checkout, ver lib/onboarding-trigger.ts);
-- estas columnas son un evento DISTINTO -- la plantilla `bienvenida_dulabs`
-- que se manda cuando Meta confirma el número del cliente como ACTIVE
-- (después del pago, en el nuevo orden pago -> conectar WhatsApp). Un tenant
-- puede en teoría recibir ambas (no se excluyen), así que van en columnas
-- separadas, no se reutiliza bienvenida_enviada_at para no mezclar dos
-- eventos con semántica distinta.
alter table public.dulabs_onboarding_sesiones
  add column if not exists bienvenida_meta_enviada_at timestamptz;

comment on column public.dulabs_onboarding_sesiones.bienvenida_meta_enviada_at is
  'Cuándo se envió realmente la plantilla de Meta bienvenida_dulabs (o NULL si no se ha enviado/no aplicó todavía). Es el guard de idempotencia real: el envío hace un UPDATE...WHERE bienvenida_meta_enviada_at IS NULL, nunca "if (!sent) send()".';

alter table public.dulabs_onboarding_sesiones
  add column if not exists bienvenida_meta_error text;

comment on column public.dulabs_onboarding_sesiones.bienvenida_meta_error is
  'Último error al intentar enviar bienvenida_dulabs (ej. plantilla no aprobada, falla de Meta). NULL si nunca falló o si ya se envió con éxito. Se limpia al reintentar con éxito.';

alter table public.dulabs_onboarding_sesiones
  add column if not exists bienvenida_meta_intentado_at timestamptz;

comment on column public.dulabs_onboarding_sesiones.bienvenida_meta_intentado_at is
  'Marca de tiempo del último intento (éxito o error) de enviar bienvenida_dulabs -- para que /admin distinga "nunca se intentó" de "se intentó y falló".';
