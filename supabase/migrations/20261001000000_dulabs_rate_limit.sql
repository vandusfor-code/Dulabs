-- Fase 11 (Completion & Debt Zero, autorizado) — rate limiting real para las
-- APIs de dashboard. F10 dejó documentado "sin rate limiting formal en APIs
-- de dashboard" como limitación conocida; esta migración lo cierra.
--
-- Por qué una tabla en vez de un contador en memoria: el proyecto corre en
-- funciones serverless de Vercel -- cada invocación puede aterrizar en una
-- instancia distinta, así que un contador en memoria de proceso no protege
-- nada de verdad (cada instancia tendría su propio contador). Se necesita
-- un contador compartido real -- reutilizando Postgres (ya la única base de
-- datos del proyecto) en vez de agregar una dependencia nueva (Redis/Upstash)
-- solo para esto.
--
-- Diseño: ventana fija (fixed window), no sliding window -- más simple,
-- suficientemente preciso para "protección razonable contra abuso" (nunca
-- se pidió precisión de milisegundo), y una sola fila por (clave, ventana)
-- gracias al PRIMARY KEY compuesto, así que el INSERT ... ON CONFLICT de la
-- función de abajo es atómico bajo concurrencia real sin necesitar un
-- candado aparte (mismo principio que dulabs_chat_lock, otra tabla que ya
-- usa un constraint único como mecanismo de exclusión real).
create table if not exists public.dulabs_rate_limit_counters (
  clave text not null,
  ventana_inicio timestamptz not null,
  conteo int not null default 1,
  constraint dulabs_rate_limit_counters_pkey primary key (clave, ventana_inicio)
);

-- Índice para el cleanup oportunista (ver función de abajo) -- barrer filas
-- viejas por rango de tiempo sin tener que escanear toda la tabla.
create index if not exists dulabs_rate_limit_counters_ventana_idx
  on public.dulabs_rate_limit_counters (ventana_inicio);

comment on table public.dulabs_rate_limit_counters is
  'Fase 11 -- contadores de rate limiting real por ventana fija. clave = "<recurso>:<tenant o ip>:<ventana en segundos>". Crece y se limpia sola vía dulabs_rate_limit_incrementar (borra ventanas de más de 1 hora en cada llamada, best-effort) -- nunca requiere un cron dedicado.';

-- Incrementa el contador de `p_clave` para la ventana fija actual (de
-- tamaño `p_ventana_seg`) y devuelve si la petición debe permitirse
-- (conteo <= p_limite) junto con el conteo actual y cuándo abre la
-- siguiente ventana (para el header Retry-After). Atómico: el UPSERT con
-- `conteo = dulabs_rate_limit_counters.conteo + 1` es una sola sentencia,
-- sin race entre leer y escribir.
create or replace function public.dulabs_rate_limit_incrementar(
  p_clave text,
  p_ventana_seg int,
  p_limite int
)
returns table (
  permitido boolean,
  conteo int,
  reinicia_en timestamptz
)
language plpgsql
as $$
declare
  v_ventana_inicio timestamptz;
  v_conteo int;
begin
  v_ventana_inicio := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_ventana_seg) * p_ventana_seg);

  insert into public.dulabs_rate_limit_counters (clave, ventana_inicio, conteo)
  values (p_clave, v_ventana_inicio, 1)
  on conflict (clave, ventana_inicio)
  do update set conteo = public.dulabs_rate_limit_counters.conteo + 1
  returning public.dulabs_rate_limit_counters.conteo into v_conteo;

  -- Cleanup oportunista, sin cron dedicado: 1 de cada ~50 llamadas (barato,
  -- aleatorio, nunca bloquea la respuesta) barre ventanas de más de 1 hora.
  -- Nunca borra la ventana actual (siempre más reciente que ese corte).
  if random() < 0.02 then
    delete from public.dulabs_rate_limit_counters
    where ventana_inicio < clock_timestamp() - interval '1 hour';
  end if;

  return query select (v_conteo <= p_limite), v_conteo, (v_ventana_inicio + make_interval(secs => p_ventana_seg));
end;
$$;

comment on function public.dulabs_rate_limit_incrementar is
  'Fase 11 -- incrementa y evalúa un contador de rate limiting de ventana fija. Nunca debe fallar la petición real que lo llama si el propio rate limiter falla -- eso lo decide el caller (lib/rate-limit.ts), no esta función.';

-- Mismo criterio de seguridad que las funciones RPC de F10 (ver
-- 20260930000000_dulabs_f10_analytics_indices.sql): Postgres otorga EXECUTE
-- a PUBLIC por defecto en funciones nuevas. Esta función no valida
-- ownership de `p_clave` -- confía en que el caller (siempre backend con
-- service-role) construye la clave a partir de datos de sesión reales, no
-- de un valor que el cliente pueda inventar libremente. Sin este REVOKE,
-- cualquier usuario autenticado podría llamarla directamente y manipular
-- (o agotar) el contador de OTRO tenant.
revoke all on function public.dulabs_rate_limit_incrementar(text, int, int) from public;
grant execute on function public.dulabs_rate_limit_incrementar(text, int, int) to service_role;

alter table public.dulabs_rate_limit_counters enable row level security;
-- Sin policies para authenticated/anon a propósito -- exactamente igual que
-- dulabs_flow_credentials y otras tablas de uso exclusivo de service_role.
