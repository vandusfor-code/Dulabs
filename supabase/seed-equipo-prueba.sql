-- Datos de PRUEBA para verificar roles de equipo (admin/agente/lectura) en un
-- mismo tenant. No es una migración de esquema — no la pongas en
-- supabase/migrations/. Corre esto UNA VEZ en el SQL Editor de Supabase,
-- después de aplicar todas las migraciones (incluida
-- 20260718090000_dulabs_miembros_equipo.sql y sus siguientes).
--
-- Antes de correr este script:
-- 1. En el Dashboard de Supabase → Authentication → Users → Add user, crea
--    dos usuarios nuevos (con contraseña, sin invitación) con los correos
--    que uses abajo en v_email_agente / v_email_lectura. No se pueden crear
--    filas de auth.users seguras por SQL directo — hay que usar el Dashboard
--    o supabase.auth.admin.createUser().
-- 2. Reemplaza v_email_dueno por el correo de una cuenta que YA tenga un
--    número de WhatsApp conectado (el tenant al que se van a unir).
--
-- Es seguro volver a correrlo: usa "on conflict (user_id) do nothing", así
-- que no duplica filas si ya existen.

do $$
declare
  v_email_dueno text := 'duvan.ramos@peoplebpo.com'; -- cambia esto por tu cuenta de prueba
  v_email_agente text := 'agente-prueba@dulabs.co';   -- debe existir ya en auth.users
  v_email_lectura text := 'lectura-prueba@dulabs.co'; -- debe existir ya en auth.users
  v_tenant uuid;
  v_user_agente uuid;
  v_user_lectura uuid;
begin
  select id into v_tenant from auth.users where email = v_email_dueno;
  if v_tenant is null then
    raise exception 'No se encontró el usuario % en auth.users', v_email_dueno;
  end if;

  select id into v_user_agente from auth.users where email = v_email_agente;
  if v_user_agente is null then
    raise exception 'No se encontró el usuario % en auth.users — créalo primero desde el Dashboard (Authentication → Users → Add user)', v_email_agente;
  end if;

  select id into v_user_lectura from auth.users where email = v_email_lectura;
  if v_user_lectura is null then
    raise exception 'No se encontró el usuario % en auth.users — créalo primero desde el Dashboard (Authentication → Users → Add user)', v_email_lectura;
  end if;

  insert into public.dulabs_miembros_equipo (tenant_id, user_id, email, rol, estado)
  values (v_tenant, v_user_agente, v_email_agente, 'agente', 'activo')
  on conflict (user_id) do nothing;

  insert into public.dulabs_miembros_equipo (tenant_id, user_id, email, rol, estado)
  values (v_tenant, v_user_lectura, v_email_lectura, 'lectura', 'activo')
  on conflict (user_id) do nothing;

  raise notice 'Listo. % (admin, dueño original), % (agente) y % (lectura) comparten el tenant %.',
    v_email_dueno, v_email_agente, v_email_lectura, v_tenant;
end $$;
