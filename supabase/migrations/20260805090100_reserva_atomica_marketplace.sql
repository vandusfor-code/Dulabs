-- Cierra el hallazgo #4 de la auditoría para el Marketplace: doble cobro
-- real por doble clic o reintento de red en
-- app/api/dashboard/marketplace/activar/route.ts. El fix invierte el orden
-- — reservar primero con un INSERT protegido por el índice único existente,
-- cobrar en Wompi después — así un segundo intento concurrente para el
-- mismo número recibe un error de índice único ANTES de llamar a Wompi.

-- El nombre del check constraint de "estado" se resuelve dinámicamente (no
-- se asume el nombre autogenerado por Postgres) para no romper la migración
-- si alguna vez se le puso un nombre distinto.
do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'dulabs_marketplace_activaciones'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%estado%';

  if v_constraint_name is not null then
    execute format('alter table public.dulabs_marketplace_activaciones drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.dulabs_marketplace_activaciones
  add constraint dulabs_marketplace_activaciones_estado_check
  check (estado in ('activa', 'vencida', 'cancelada', 'pendiente_pago'));

drop index if exists dulabs_marketplace_una_activa_por_numero;
create unique index dulabs_marketplace_una_activa_por_numero
  on public.dulabs_marketplace_activaciones (phone_number_id)
  where estado in ('activa', 'pendiente_pago');

comment on index public.dulabs_marketplace_una_activa_por_numero is
  'Bloquea dos activaciones/reservas simultáneas para el mismo número. pendiente_pago es el estado transitorio entre el INSERT de reserva y la confirmación del cobro en Wompi; si el segundo INSERT choca aquí, se rechaza ANTES de cobrar.';

comment on column public.dulabs_marketplace_activaciones.estado is
  'activa | vencida | cancelada | pendiente_pago (reserva atómica, transitorio, entre el INSERT y la confirmación del cobro en Wompi).';
