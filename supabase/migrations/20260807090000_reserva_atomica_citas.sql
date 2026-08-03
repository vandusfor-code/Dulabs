-- Cierra el hallazgo #5 de la auditoría: lib/marketplace-citas.ts hacía un
-- SELECT de disponibilidad y un INSERT/UPDATE separado, sin transacción ni
-- lock — dos o más clientes pidiendo el mismo horario casi simultáneamente
-- podían todos ver "cupo libre" y todos quedar agendados, superando
-- recursos_disponibles.
--
-- A diferencia de los hallazgos #4/#6 (exclusión mutua "uno o cero", resuelta
-- con un UNIQUE/INSERT ON CONFLICT), aquí la regla real es "hasta N
-- simultáneos" con solapamiento de horario arbitrario (duración variable, no
-- alineada a slots fijos) — un índice único no alcanza para modelarlo. La
-- garantía viene de serializar con un advisory lock TRANSACCIONAL
-- (pg_advisory_xact_lock, se libera solo al terminar la función) sobre la
-- combinación (activacion_id, fecha) antes de contar solapamientos e
-- insertar/actualizar — así ninguna segunda llamada concurrente para el
-- mismo día de la misma activación puede contar los mismos huecos "libres"
-- que la primera.
--
-- La clave del lock se compone como activacion_id * 100000 +
-- (fecha - 2000-01-01) en vez de un hash: es determinística y sin colisión
-- posible (100000 días de margen ~ 273 años por activación), a diferencia de
-- hashtextextended que podría (con probabilidad ínfima) hacer chocar el lock
-- de dos activaciones/fechas distintas sin relación entre sí.

create or replace function public.dulabs_reservar_cita(
  p_activacion_id bigint,
  p_phone_number_id text,
  p_numero_cliente text,
  p_nombre_cliente text,
  p_fecha date,
  p_hora time,
  p_duracion_min int,
  p_servicio text,
  p_recursos_disponibles int
) returns table (
  id bigint,
  activacion_id bigint,
  phone_number_id text,
  numero_cliente text,
  nombre_cliente text,
  fecha date,
  hora_inicio time,
  duracion_min int,
  servicio text,
  estado text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ocupados int;
begin
  perform pg_advisory_xact_lock(p_activacion_id * 100000 + (p_fecha - date '2000-01-01'));

  select count(*) into v_ocupados
  from public.dulabs_marketplace_citas c
  where c.activacion_id = p_activacion_id
    and c.fecha = p_fecha
    and c.estado = 'agendada'
    and c.hora_inicio < (p_hora + make_interval(mins => p_duracion_min))
    and p_hora < (c.hora_inicio + make_interval(mins => c.duracion_min));

  if v_ocupados >= p_recursos_disponibles then
    return; -- 0 filas: sin cupo, el llamador no debe reintentar solo
  end if;

  return query
  insert into public.dulabs_marketplace_citas as nc
    (activacion_id, phone_number_id, numero_cliente, nombre_cliente, fecha, hora_inicio, duracion_min, servicio, estado)
  values
    (p_activacion_id, p_phone_number_id, p_numero_cliente, p_nombre_cliente, p_fecha, p_hora, p_duracion_min, p_servicio, 'agendada')
  returning nc.id, nc.activacion_id, nc.phone_number_id, nc.numero_cliente, nc.nombre_cliente, nc.fecha, nc.hora_inicio, nc.duracion_min, nc.servicio, nc.estado, nc.created_at, nc.updated_at;
end;
$$;

revoke all on function public.dulabs_reservar_cita(bigint, text, text, text, date, time, int, text, int) from public;
grant execute on function public.dulabs_reservar_cita(bigint, text, text, text, date, time, int, text, int) to service_role;

comment on function public.dulabs_reservar_cita is
  'Reserva atómica de una cita: cuenta solapamientos contra recursos_disponibles y solo inserta si hay cupo, serializado con un advisory lock transaccional por (activacion_id, fecha). Devuelve 0 filas si no hay cupo — el llamador (lib/marketplace-citas.ts crearCita) debe tratar eso como "sin disponibilidad", no como error.';

-- Mismo mecanismo para reagendar (mover una cita existente a otra fecha/hora
-- sin crear una fila nueva): excluye la propia cita del conteo de
-- solapamientos, bajo el mismo lock.
create or replace function public.dulabs_reagendar_cita(
  p_cita_id bigint,
  p_activacion_id bigint,
  p_fecha date,
  p_hora time,
  p_duracion_min int,
  p_recursos_disponibles int
) returns table (
  id bigint,
  activacion_id bigint,
  phone_number_id text,
  numero_cliente text,
  nombre_cliente text,
  fecha date,
  hora_inicio time,
  duracion_min int,
  servicio text,
  estado text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ocupados int;
begin
  perform pg_advisory_xact_lock(p_activacion_id * 100000 + (p_fecha - date '2000-01-01'));

  select count(*) into v_ocupados
  from public.dulabs_marketplace_citas c
  where c.activacion_id = p_activacion_id
    and c.fecha = p_fecha
    and c.estado = 'agendada'
    and c.id <> p_cita_id
    and c.hora_inicio < (p_hora + make_interval(mins => p_duracion_min))
    and p_hora < (c.hora_inicio + make_interval(mins => c.duracion_min));

  if v_ocupados >= p_recursos_disponibles then
    return;
  end if;

  return query
  update public.dulabs_marketplace_citas as nc
  set fecha = p_fecha, hora_inicio = p_hora, updated_at = now()
  where nc.id = p_cita_id and nc.activacion_id = p_activacion_id
  returning nc.id, nc.activacion_id, nc.phone_number_id, nc.numero_cliente, nc.nombre_cliente, nc.fecha, nc.hora_inicio, nc.duracion_min, nc.servicio, nc.estado, nc.created_at, nc.updated_at;
end;
$$;

revoke all on function public.dulabs_reagendar_cita(bigint, bigint, date, time, int, int) from public;
grant execute on function public.dulabs_reagendar_cita(bigint, bigint, date, time, int, int) to service_role;

comment on function public.dulabs_reagendar_cita is
  'Mueve una cita existente a otra fecha/hora de forma atómica (mismo lock y conteo de solapamientos que dulabs_reservar_cita, excluyendo la propia cita). Devuelve 0 filas si el nuevo horario no tiene cupo o la cita/activación no coincide.';
