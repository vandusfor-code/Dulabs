-- ROLLBACK de 20261214000000_dulabs_agente_minimo_mayorista.sql (mínimo de la compra inicial mayorista editable desde el panel de la tienda).
--
-- Quita las funciones nuevas y la tabla de auditoría dulabs_agente_config_cambios. NO toca dulabs_agente_runtime_config ni su `negocio`: los cambios de mínimo y de textos que ya se hicieron desde el
-- panel se quedan tal como están (son datos reales del asistente).
--
-- Se NIEGA a correr si ya hay cambios auditados: esa huella (quién cambió el mínimo, cuándo y cómo eran los textos antes) no se podría recuperar después. Para deshacer UN cambio concreto, los
-- textos de antes están en la columna `antes` de esa fila (ruta → texto) y el mínimo de antes en antes->>'minimo'.
-- No es una migración (vive fuera de supabase/migrations a propósito). Se ejecuta a mano, en una transacción.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_cambios integer := 0;
begin
  if to_regclass('public.dulabs_agente_config_cambios') is not null then
    select count(*) into v_cambios from public.dulabs_agente_config_cambios;
  end if;
  if v_cambios > 0 then
    raise exception 'ya hay % cambios auditados del mínimo mayorista: no se puede volver atrás sin perder quién los hizo ni cómo eran los textos antes.', v_cambios;
  end if;
end;
$$;

drop function if exists public.dulabs_agente_minimo_mayorista_aplicar(uuid, uuid, bigint, bigint, jsonb);
drop function if exists public.dulabs_agente_minimo_mayorista_ver(uuid);

drop table if exists public.dulabs_agente_config_cambios;
drop function if exists public.dulabs_agente_config_cambios_inmutables();

commit;
