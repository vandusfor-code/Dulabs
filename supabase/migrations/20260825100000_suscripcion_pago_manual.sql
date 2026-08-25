-- Permite activar una suscripción sin fuente de pago de Wompi (facturación
-- manual/negociada -- típicamente Enterprise). wompi_payment_source_id era
-- NOT NULL porque hasta ahora toda suscripción se creaba vía checkout con
-- tarjeta; ahora también se puede crear a mano vía
-- POST /api/admin/activar-suscripcion. Migración puramente aditiva.

alter table public.dulabs_suscripciones
  alter column wompi_payment_source_id drop not null;

comment on column public.dulabs_suscripciones.wompi_payment_source_id is
  'ID de la "fuente de pago" tokenizada en Wompi, reutilizado cada mes para el cobro recurrente. NULL = facturación manual/negociada fuera de Wompi (ver /api/admin/activar-suscripcion) -- el cron de cobro mensual la excluye siempre, igual que las de cortesia.';
