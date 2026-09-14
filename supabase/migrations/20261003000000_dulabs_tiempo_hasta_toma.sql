-- Fase 11 (Completion & Debt Zero, autorizado) — cierra la limitación
-- documentada en F10 ("tiempo hasta toma por agente no implementado").
--
-- Definición elegida (la única que tiene un timestamp real y confiable sin
-- inventar una columna/estado nuevo): para cada evento real de handoff
-- explícito a un humano (dulabs_conversacion_eventos.tipo='asignado' con
-- detalle->>'motivo'='handoff_tomado', el MISMO evento que ya distingue F10
-- entre "tomar" y una reasignación simple), el tiempo hasta toma es la
-- diferencia entre ese evento y el mensaje ENTRANTE más reciente de esa
-- misma conversación anterior a ese evento -- "cuánto tardó el equipo en
-- reaccionar al último mensaje real del cliente antes de que alguien la
-- tomara". Cero columnas nuevas, cero eventos nuevos: solo un cálculo sobre
-- datos que ya existían desde F9.
create or replace function public.dulabs_tiempo_hasta_toma_promedio_seg(
  p_phone_number_ids text[],
  p_desde timestamptz,
  p_hasta timestamptz
)
returns table (
  promedio_seg double precision,
  muestras bigint
)
language sql
stable
as $$
  select
    avg(extract(epoch from (ev.created_at - ultimo_mensaje.created_at))),
    count(*)
  from public.dulabs_conversacion_eventos ev
  cross join lateral (
    select m.created_at
    from public.dulabs_mensajes_log m
    where m.phone_number_id = ev.phone_number_id
      and m.telefono_cliente = ev.telefono_cliente
      and m.direccion = 'entrante'
      and m.created_at < ev.created_at
    order by m.created_at desc
    limit 1
  ) ultimo_mensaje
  where ev.phone_number_id = any(p_phone_number_ids)
    and ev.tipo = 'asignado'
    and ev.detalle ->> 'motivo' = 'handoff_tomado'
    and ev.created_at between p_desde and p_hasta
$$;

comment on function public.dulabs_tiempo_hasta_toma_promedio_seg is
  'Fase 11 -- tiempo promedio (segundos) entre el último mensaje entrante de una conversación y el momento en que un agente la tomó explícitamente (handoff_tomado), para los phone_number_id y rango de fechas dados. muestras=0 si no hubo ningún handoff en el rango (promedio_seg viene null en ese caso, nunca 0 falso).';

-- Mismo criterio de seguridad que el resto de funciones RPC de F10/F11: sin
-- este REVOKE, cualquier authenticated/anon podría invocarla con el
-- phone_number_id de otro tenant.
revoke all on function public.dulabs_tiempo_hasta_toma_promedio_seg(text[], timestamptz, timestamptz) from public;
grant execute on function public.dulabs_tiempo_hasta_toma_promedio_seg(text[], timestamptz, timestamptz) to service_role;
