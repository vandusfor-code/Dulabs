-- Cierra el hallazgo #4 de la auditoría: doble cobro real por doble clic o
-- reintento de red en app/api/pagos/suscribir/route.ts. El fix invierte el
-- orden — reservar primero de forma atómica, cobrar en Wompi después — para
-- que un segundo intento concurrente nunca llegue a llamar a Wompi.
--
-- dulabs_suscripciones ya tiene un unique constraint TOTAL sobre id_tenant
-- (una fila por tenant, sin importar su estado), así que un índice único
-- parcial adicional sobre esa misma columna sería redundante: la exclusión
-- mutua real se logra con un INSERT ... ON CONFLICT ... DO UPDATE ... WHERE
-- condicional dentro de esta función (mismo patrón que
-- dulabs_intentar_iniciar_campana en 20260801090000_planes_agentes_campanas.sql).

alter table public.dulabs_suscripciones
  alter column wompi_payment_source_id drop not null,
  alter column wompi_customer_email drop not null;

comment on column public.dulabs_suscripciones.wompi_payment_source_id is
  'ID de la "fuente de pago" tokenizada en Wompi, reutilizado cada mes para el cobro recurrente (recurrent: true). Null mientras estado=pendiente_pago (reserva en curso, todavía no se llamó a Wompi).';
comment on column public.dulabs_suscripciones.wompi_customer_email is
  'Null mientras estado=pendiente_pago (reserva en curso, todavía no se llamó a Wompi).';

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
    (id_tenant, plan, precio_cop, estado, fecha_proximo_cobro, wompi_payment_source_id, wompi_customer_email)
  values
    (p_tenant, p_plan, p_precio_cop, 'pendiente_pago', p_fecha_proximo_cobro, null, null)
  on conflict (id_tenant) do update
    set plan = excluded.plan,
        precio_cop = excluded.precio_cop,
        estado = 'pendiente_pago',
        fecha_proximo_cobro = excluded.fecha_proximo_cobro,
        updated_at = now()
  where s.estado not in ('activa', 'pendiente_pago')
  returning s.id, s.estado;
end;
$$;

revoke all on function public.dulabs_reservar_suscripcion(uuid, text, integer, date) from public;
grant execute on function public.dulabs_reservar_suscripcion(uuid, text, integer, date) to service_role;

comment on function public.dulabs_reservar_suscripcion is
  'Reserva atómica de la fila de suscripción de un tenant antes de cobrar en Wompi (pone estado=pendiente_pago). Devuelve 0 filas si ya hay una suscripción activa o una reserva en curso para ese tenant — el llamador debe abortar SIN cobrar en ese caso. El llamador es responsable de revertir a un estado terminal (p.ej. vencida) si el cobro falla o lanza excepción, para no dejar al tenant bloqueado.';
