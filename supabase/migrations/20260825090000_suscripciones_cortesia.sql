-- Suscripciones de cortesía (ej. la cuenta del dueño de la plataforma):
-- estado='activa' de verdad, con los límites reales del plan, pero el
-- cron de cobro mensual nunca las toca. Migración puramente aditiva.

alter table public.dulabs_suscripciones
  add column if not exists cortesia boolean not null default false;

comment on column public.dulabs_suscripciones.cortesia is
  'true = suscripción de cortesía (ej. cuenta del dueño): activa con los límites reales del plan, pero el cron de cobro mensual (app/api/wompi/cobro-mensual) la excluye siempre, nunca intenta cobrarle.';
