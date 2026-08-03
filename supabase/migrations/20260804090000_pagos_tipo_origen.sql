-- Fix de auditoría: el webhook de Wompi (app/api/wompi/webhook/route.ts)
-- actualizaba dulabs_suscripciones para CUALQUIER transacción del tenant,
-- sin distinguir si era un pago de la suscripción del plan o de una
-- activación del Marketplace — un cobro de Marketplace DECLINED podía
-- marcar el plan principal como vencido y cortarle el WhatsApp/IA a un
-- cliente por un producto de $19.900 que ni siquiera es su plan.
--
-- dulabs_marketplace_activaciones.id es bigint (identity), no uuid.

alter table public.dulabs_pagos
  add column if not exists tipo text not null default 'suscripcion'
    check (tipo in ('suscripcion', 'marketplace')),
  add column if not exists marketplace_activacion_id bigint
    references public.dulabs_marketplace_activaciones(id) on delete set null;

create index if not exists dulabs_pagos_marketplace_activacion_idx
  on public.dulabs_pagos (marketplace_activacion_id)
  where marketplace_activacion_id is not null;

comment on column public.dulabs_pagos.tipo is
  'A qué se debe este cobro: suscripcion (plan principal) o marketplace (agente comprado aparte). El webhook de Wompi lo usa para saber qué actualizar cuando el estado de la transacción cambia.';
comment on column public.dulabs_pagos.marketplace_activacion_id is
  'Activación del Marketplace asociada, solo cuando tipo = marketplace. null en pagos de suscripción.';
