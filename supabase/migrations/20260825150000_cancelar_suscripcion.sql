-- Cancelación de suscripción. Hasta ahora el estado 'cancelada' existía en
-- el esquema pero ningún endpoint lo asignaba nunca: la única salida real
-- para un cliente era borrar la cuenta entera.
--
-- La cancelación es DIFERIDA a propósito: el cliente ya pagó el periodo en
-- curso, así que se le respeta hasta fecha_proximo_cobro y ahí se corta, en
-- vez de quitarle el servicio el mismo día que cancela. Mientras tanto la
-- suscripción sigue 'activa' (conserva acceso) pero marcada para no
-- renovarse -- el cron de cobro mensual la cierra al llegar la fecha.

alter table public.dulabs_suscripciones
  add column if not exists cancelar_al_vencer boolean not null default false;

comment on column public.dulabs_suscripciones.cancelar_al_vencer is
  'true = el cliente canceló; conserva el servicio hasta fecha_proximo_cobro y ahí el cron pasa estado a cancelada en vez de cobrar. Se puede revertir (reactivar) mientras no haya vencido.';
