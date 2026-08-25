-- Agrega el estado 'propuesta': cuando la especialista no puede al horario
-- pedido pero sí puede en otro, propone un nuevo horario en la MISMA fila
-- (se actualiza inicio/fin) en vez de crear una fila aparte -- así el
-- constraint EXCLUDE sigue reteniendo el horario propuesto atómicamente
-- mientras la clienta decide, exactamente igual que pendiente/confirmada.
-- Sin esto, alguien más podría tomar ese horario mientras la clienta piensa.

alter table public.dulabs_citas_especialista
  drop constraint dulabs_citas_especialista_estado_valido;
alter table public.dulabs_citas_especialista
  add constraint dulabs_citas_especialista_estado_valido
  check (estado in ('pendiente', 'confirmada', 'rechazada', 'cancelada', 'propuesta'));

alter table public.dulabs_citas_especialista
  drop constraint dulabs_citas_especialista_sin_solape;
alter table public.dulabs_citas_especialista
  add constraint dulabs_citas_especialista_sin_solape
  exclude using gist (
    especialista_id with =,
    tstzrange(inicio, fin) with &&
  ) where (estado in ('pendiente', 'confirmada', 'propuesta'));
