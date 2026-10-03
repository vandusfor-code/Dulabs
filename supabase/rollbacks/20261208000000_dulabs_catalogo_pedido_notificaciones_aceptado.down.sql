-- ROLLBACK de 20261208000000_dulabs_catalogo_pedido_notificaciones_aceptado.sql (Fase 3B.8: tipo 'aceptado').
--
-- Deja el CHECK de `tipo` EXACTAMENTE como estaba (sin 'aceptado').
--
-- Se NIEGA a correr si ya hay filas de tipo 'aceptado': borrarlas perdería el registro de lo que se le escribió al cliente
-- (y la garantía de no repetirlo). Revisarlas antes.
-- No es una migración (vive fuera de supabase/migrations a propósito). Se ejecuta a mano, en una transacción.
\set ON_ERROR_STOP on
begin;

do $$
begin
  if to_regclass('public.dulabs_catalogo_pedido_notificaciones') is null then
    raise notice 'dulabs_catalogo_pedido_notificaciones no existe: nada que revertir';
    return;
  end if;
  if exists (select 1 from public.dulabs_catalogo_pedido_notificaciones where tipo = 'aceptado') then
    raise exception 'hay notificaciones de tipo aceptado: el rollback las perdería (revisarlas antes)';
  end if;
end $$;

do $$
declare
  c record;
begin
  if to_regclass('public.dulabs_catalogo_pedido_notificaciones') is null then
    return;
  end if;
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.dulabs_catalogo_pedido_notificaciones'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%pago_recibido%'
  loop
    execute format('alter table public.dulabs_catalogo_pedido_notificaciones drop constraint %I', c.conname);
  end loop;
  alter table public.dulabs_catalogo_pedido_notificaciones
    add constraint dulabs_catalogo_pedido_notificaciones_tipo_check
    check (tipo in ('pago_recibido', 'en_preparacion', 'enviado', 'entregado', 'completado', 'cancelado', 'rechazado'));
end $$;

commit;
