-- Permite que UNA persona (mismo número de WhatsApp) tenga más de una
-- "especialidad" registrada -- ej. Daniela ya tiene "pestañas" (bloquea
-- horario, una a la vez) y ahora también necesita cubrir el resto de
-- servicios del spa (uñas, semipermanente, acrílicas...), donde SÍ puede
-- haber varias citas a la misma hora porque son 3 personas atendiendo en
-- paralelo. Antes el número era único por sí solo; ahora lo es junto con
-- el servicio (no se puede repetir la MISMA especialidad dos veces).
alter table public.dulabs_especialistas
  drop constraint dulabs_especialistas_numero_unico;
alter table public.dulabs_especialistas
  add constraint dulabs_especialistas_numero_unico unique (phone_number_id, numero_whatsapp, servicio);

-- bloquea_horario: si este especialista es un recurso de "una persona, un
-- turno" (como pestañas con Nicol/Daniela) o un catálogo donde varias citas
-- a la misma hora son normales. Se copia a cada cita al crearla porque el
-- constraint EXCLUDE solo puede mirar columnas de su propia fila, no de una
-- tabla relacionada.
alter table public.dulabs_especialistas
  add column if not exists bloquea_horario boolean not null default true;
alter table public.dulabs_citas_especialista
  add column if not exists bloquea_horario boolean not null default true;

alter table public.dulabs_citas_especialista
  drop constraint dulabs_citas_especialista_sin_solape;
alter table public.dulabs_citas_especialista
  add constraint dulabs_citas_especialista_sin_solape
  exclude using gist (
    especialista_id with =,
    tstzrange(inicio, fin) with &&
  ) where (estado in ('pendiente', 'confirmada', 'propuesta') and bloquea_horario);

-- es_general: catálogo de respaldo para cualquier servicio que no calce con
-- ningún especialista específico (como "pestañas"). Debe existir como mucho
-- uno activo por negocio.
alter table public.dulabs_especialistas
  add column if not exists es_general boolean not null default false;
