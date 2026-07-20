-- Bloqueo temporal de login tras intentos fallidos repetidos. Guarda una
-- fila por intento fallido (no por cuenta) para poder contar cuántos hubo
-- en la ventana reciente sin necesitar un UPDATE con locking. Se limpia
-- automáticamente al loguearse con éxito (ver app/api/auth/login/route.ts).
--
-- A propósito NO es un bloqueo permanente: una cuenta bloqueada para
-- siempre tras 3 intentos sería un vector para que cualquiera deje sin
-- acceso a un usuario legítimo con solo fallar la contraseña 3 veces.

create table public.dulabs_intentos_login_fallidos (
  id bigint generated always as identity primary key,
  email text not null,
  created_at timestamptz not null default now()
);

create index dulabs_intentos_login_fallidos_email_idx
  on public.dulabs_intentos_login_fallidos (email, created_at desc);

comment on table public.dulabs_intentos_login_fallidos is
  'Un registro por intento de login fallido. Sin columna de tenant — se consulta por email antes de que exista sesión. Solo el backend (service role) la toca.';

alter table public.dulabs_intentos_login_fallidos enable row level security;
-- Sin políticas: ni anon ni authenticated pueden leerla directo, coherente
-- con el resto de tablas sensibles (ver dulabs_clientes_config).
