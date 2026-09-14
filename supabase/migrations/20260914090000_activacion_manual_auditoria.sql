-- FASE F14 (SaaS Commercial Readiness, autorizado) -- hallazgo real: a
-- diferencia de la cortesía de Marketplace (ver 20260827080000_marketplace_cortesia.sql,
-- que sí registra `cortesia_activada_por`/`cortesia_motivo`), la activación
-- manual de suscripciones (app/api/admin/activar-suscripcion/route.ts) puede
-- cambiar el plan/precio/estado de CUALQUIER tenant vía un secreto
-- compartido (PLATFORM_ADMIN_SECRET, sin sesión de usuario) sin dejar
-- ningún rastro de quién lo hizo ni por qué. Migración puramente aditiva:
-- ambas columnas son opcionales, así que no rompe llamadas existentes que
-- todavía no manden estos campos.

alter table public.dulabs_suscripciones
  add column if not exists activada_manualmente_por text;

alter table public.dulabs_suscripciones
  add column if not exists activada_manualmente_motivo text;

comment on column public.dulabs_suscripciones.activada_manualmente_por is
  'Identificador en texto libre (nombre/correo) de quién ejecutó la activación manual vía /api/admin/activar-suscripcion -- esa ruta se autentica con un secreto compartido, no con una sesión real, así que no hay un user_id de auth.users que registrar automáticamente. Null en suscripciones creadas por el flujo normal de pago (checkout/Wompi).';
comment on column public.dulabs_suscripciones.activada_manualmente_motivo is
  'Motivo corto en texto libre (ej. "Cliente real, pago confirmado por el operador fuera de banda"). Null en suscripciones creadas por el flujo normal de pago.';
