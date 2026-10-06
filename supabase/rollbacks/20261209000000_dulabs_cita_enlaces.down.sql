-- ROLLBACK de 20261209000000_dulabs_cita_enlaces.sql (AMORE «Mi cita»).
--
-- Borra la tabla de enlaces personales. Efecto: todos los enlaces «Mi cita» ya enviados dejan de abrir (la página muestra «enlace no válido») y las
-- reservas nuevas siguen funcionando, solo que sin enlace de gestión. Las citas NO se tocan.
--
-- Se NIEGA a correr si hay enlaces activos (no revocados y no vencidos): borrarlos dejaría sin enlace a clientas que ya lo recibieron por WhatsApp.
-- Revísalos antes, o revócalos a propósito (update ... set revocado_at = now()) si quieres invalidarlos.
-- No es una migración (vive fuera de supabase/migrations a propósito). Se ejecuta a mano, en una transacción.
\set ON_ERROR_STOP on
begin;

do $$
begin
  if to_regclass('public.dulabs_cita_enlaces') is null then
    raise notice 'dulabs_cita_enlaces no existe: nada que revertir';
    return;
  end if;
  if exists (select 1 from public.dulabs_cita_enlaces where revocado_at is null and expira_at > now()) then
    raise exception 'hay enlaces «Mi cita» activos: el rollback los dejaría sin abrir (revisarlos o revocarlos antes)';
  end if;
end $$;

drop table if exists public.dulabs_cita_enlaces;

commit;
