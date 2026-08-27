-- Precio negociado por tenant: algunos clientes (ej. ventas directas antes de
-- que el precio de lista subiera) quedaron con un valor mensual distinto al
-- que hoy muestra lib/planes.ts para su plan. Migración puramente aditiva.
--
-- Cuando esta columna NO es null, app/api/pagos/suscribir/route.ts la usa en
-- vez del precio de lista del plan -- tanto para lo que se cobra de verdad en
-- Wompi como para lo que queda guardado en precio_cop. Como el cron de cobro
-- mensual (app/api/wompi/cobro-mensual) ya lee precio_cop DE LA FILA (nunca
-- del plan), una vez pagada la primera vez la suscripción sigue cobrando ese
-- mismo valor cada mes sin ninguna acción adicional.
--
-- Se lee siempre del lado del servidor, de una fila que el cliente no puede
-- escribir -- nunca de un parámetro que mande el navegador, así que ningún
-- cliente puede manipular su propio precio.

alter table public.dulabs_suscripciones
  add column if not exists precio_negociado_cop integer;

comment on column public.dulabs_suscripciones.precio_negociado_cop is
  'Precio mensual negociado para este tenant, si difiere del precio de lista de su plan (lib/planes.ts). Null = usa el precio de lista normal. Nunca se lee de un parámetro del cliente -- solo el equipo de DuLabs lo puede fijar directo en la base de datos.';

-- La reserva de suscripción (ver 20260805090000_reserva_atomica_suscripcion.sql)
-- ya apagaba `cortesia` -- no, en realidad nunca lo hacía: era un hallazgo real
-- de esta auditoría. Un tenant que estaba en cortesía (precio_cop=0) y hace un
-- pago real de verdad debe dejar de estar marcado como cortesía, o el cron de
-- cobro mensual (que filtra `cortesia = false`) nunca lo vuelve a cobrar el
-- mes siguiente aunque el primer cobro sí se haya procesado.
create or replace function public.dulabs_reservar_suscripcion(
  p_tenant uuid,
  p_plan text,
  p_precio_cop integer,
  p_fecha_proximo_cobro date
) returns table (id bigint, estado text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.dulabs_suscripciones as s
    (id_tenant, plan, precio_cop, estado, fecha_proximo_cobro, wompi_payment_source_id, wompi_customer_email, cortesia)
  values
    (p_tenant, p_plan, p_precio_cop, 'pendiente_pago', p_fecha_proximo_cobro, null, null, false)
  on conflict (id_tenant) do update
    set plan = excluded.plan,
        precio_cop = excluded.precio_cop,
        estado = 'pendiente_pago',
        fecha_proximo_cobro = excluded.fecha_proximo_cobro,
        cortesia = false,
        updated_at = now()
  where s.estado not in ('activa', 'pendiente_pago')
  returning s.id, s.estado;
end;
$$;

comment on function public.dulabs_reservar_suscripcion is
  'Reserva atómica de la fila de suscripción de un tenant antes de cobrar en Wompi (pone estado=pendiente_pago, cortesia=false -- un pago real siempre saca al tenant de cortesía). Devuelve 0 filas si ya hay una suscripción activa o una reserva en curso para ese tenant -- el llamador debe abortar SIN cobrar en ese caso. El llamador es responsable de revertir a un estado terminal (p.ej. vencida) si el cobro falla o lanza excepción, para no dejar al tenant bloqueado.';
