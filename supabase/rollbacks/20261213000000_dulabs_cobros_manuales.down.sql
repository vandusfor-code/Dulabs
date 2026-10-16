-- ROLLBACK de 20261213000000_dulabs_cobros_manuales.sql (cobros manuales: recordatorio de pago por WhatsApp y suspensión del bot por falta de pago).
--
-- Quita la función dulabs_cobro_registrar_pago, la tabla dulabs_cobros_ciclos y las cuatro columnas nuevas de dulabs_suscripciones. NO toca ninguna otra tabla ni función.
--
-- Se NIEGA a correr si ya hay ciclos registrados (recordatorios enviados o pagos manuales) o suscripciones con datos de cobro / suspendidas: esa información no se podría recuperar
-- después. Los pagos manuales ya guardados en dulabs_pagos se quedan (son pagos reales). Si solo quieres detener los recordatorios, pon COBROS_MANUALES_MODO=simulacion (o quítala)
-- en Vercel y vuelve a desplegar: no hace falta ningún SQL. Si hay alguien suspendido, levanta la suspensión desde el Panel de Operaciones antes de revertir.
-- No es una migración (vive fuera de supabase/migrations a propósito). Se ejecuta a mano, en una transacción.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_ciclos integer := 0;
  v_con_datos integer := 0;
begin
  if to_regclass('public.dulabs_cobros_ciclos') is not null then
    select count(*) into v_ciclos from public.dulabs_cobros_ciclos;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dulabs_suscripciones' and column_name = 'suspendida_por_pago_at') then
    select count(*) into v_con_datos from public.dulabs_suscripciones
      where telefono_cobro is not null or nombre_cobro is not null or dia_cobro is not null or suspendida_por_pago_at is not null;
  end if;
  if v_ciclos > 0 or v_con_datos > 0 then
    raise exception 'ya hay datos de cobro (% ciclos registrados, % suscripciones con teléfono/nombre/día de cobro o suspendidas): no se puede volver atrás sin perderlos. Pon COBROS_MANUALES_MODO=simulacion para detener los recordatorios.', v_ciclos, v_con_datos;
  end if;
end;
$$;

drop function if exists public.dulabs_cobro_registrar_pago(uuid, date, integer, text, text);
drop table if exists public.dulabs_cobros_ciclos;

alter table public.dulabs_suscripciones drop constraint if exists dulabs_suscripciones_dia_cobro_ck;
alter table public.dulabs_suscripciones drop constraint if exists dulabs_suscripciones_telefono_cobro_ck;
alter table public.dulabs_suscripciones
  drop column if exists telefono_cobro,
  drop column if exists nombre_cobro,
  drop column if exists dia_cobro,
  drop column if exists suspendida_por_pago_at;

commit;
