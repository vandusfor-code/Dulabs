-- ============================================================
-- F12 -- BLOQUE SQL PARA EL OPERADOR (Supabase SQL Editor)
-- Generado a partir de las 3 migraciones F11 pendientes.
-- Idempotente: seguro de ejecutar mas de una vez.
-- No borra datos, no hace DROP destructivo, no hace UPDATE masivo.
-- ============================================================

-- ==== 1/3: supabase/migrations/20261001000000_dulabs_rate_limit.sql ====
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

-- ==== 2/3: supabase/migrations/20261002000000_dulabs_inbox_realtime.sql ====
-- Fase 11 (Completion & Debt Zero, autorizado) — habilita Supabase Realtime
-- (Postgres Changes) para el Human Inbox: F9 dejó el Inbox con refresco
-- 100% manual. Esta migración NO crea infraestructura nueva de
-- websockets/backend -- usa el mecanismo ya integrado de Supabase
-- (publicación lógica de Postgres + Realtime Authorization), que YA respeta
-- las políticas RLS reales de estas tablas (ver
-- 20260717090000_politicas_rls_lectura_tenant.sql +
-- 20260718090300_rls_tenant_por_membresia.sql, donde tenant_select en
-- dulabs_mensajes_log ya resuelve el tenant vía membresía de equipo real,
-- no auth.uid() literal) -- verificado antes de escribir esto: esas
-- políticas son correctas para el modelo de equipo actual, así que
-- Realtime hereda el MISMO aislamiento por tenant que ya protege cualquier
-- lectura directa del navegador, sin necesitar ninguna política nueva.
--
-- Solo lectura vía suscripción: el navegador nunca escribe a través de
-- Realtime, solo recibe notificaciones de cambios para refrescar la UI
-- (que sigue llamando a las mismas APIs de siempre para los datos reales).

-- Hallazgo real al preparar esto: dulabs_conversacion_eventos y
-- dulabs_conversacion_estado (F9) tienen RLS habilitado pero SIN ninguna
-- política de SELECT para `authenticated` -- deny-by-default, así que hoy
-- Realtime no les devolvería ninguna fila a un usuario real (no es un
-- riesgo de seguridad, pero sí dejaría esa parte de esta fase inútil sin
-- esto). Se agregan las políticas de solo lectura por tenant que faltaban,
-- MISMO criterio exacto que ya usa dulabs_mensajes_log/dulabs_pausas_chat
-- (20260717090000_politicas_rls_lectura_tenant.sql): nunca INSERT/UPDATE/
-- DELETE para authenticated, esa escritura sigue siendo exclusiva del
-- backend con service-role.
drop policy if exists tenant_select on public.dulabs_conversacion_eventos;
create policy tenant_select on public.dulabs_conversacion_eventos
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));

drop policy if exists tenant_select on public.dulabs_conversacion_estado;
create policy tenant_select on public.dulabs_conversacion_estado
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dulabs_mensajes_log'
  ) then
    alter publication supabase_realtime add table public.dulabs_mensajes_log;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dulabs_conversacion_eventos'
  ) then
    alter publication supabase_realtime add table public.dulabs_conversacion_eventos;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dulabs_conversacion_estado'
  ) then
    alter publication supabase_realtime add table public.dulabs_conversacion_estado;
  end if;
end $$;

-- ==== 3/3: supabase/migrations/20261003000000_dulabs_tiempo_hasta_toma.sql ====
-- Fase 11 (Completion & Debt Zero, autorizado) — cierra la limitación
-- documentada en F10 ("tiempo hasta toma por agente no implementado").
--
-- Definición elegida (la única que tiene un timestamp real y confiable sin
-- inventar una columna/estado nuevo): para cada evento real de handoff
-- explícito a un humano (dulabs_conversacion_eventos.tipo='asignado' con
-- detalle->>'motivo'='handoff_tomado', el MISMO evento que ya distingue F10
-- entre "tomar" y una reasignación simple), el tiempo hasta toma es la
-- diferencia entre ese evento y el mensaje ENTRANTE más reciente de esa
-- misma conversación anterior a ese evento -- "cuánto tardó el equipo en
-- reaccionar al último mensaje real del cliente antes de que alguien la
-- tomara". Cero columnas nuevas, cero eventos nuevos: solo un cálculo sobre
-- datos que ya existían desde F9.
create or replace function public.dulabs_tiempo_hasta_toma_promedio_seg(
  p_phone_number_ids text[],
  p_desde timestamptz,
  p_hasta timestamptz
)
returns table (
  promedio_seg double precision,
  muestras bigint
)
language sql
stable
as $$
  select
    avg(extract(epoch from (ev.created_at - ultimo_mensaje.created_at))),
    count(*)
  from public.dulabs_conversacion_eventos ev
  cross join lateral (
    select m.created_at
    from public.dulabs_mensajes_log m
    where m.phone_number_id = ev.phone_number_id
      and m.telefono_cliente = ev.telefono_cliente
      and m.direccion = 'entrante'
      and m.created_at < ev.created_at
    order by m.created_at desc
    limit 1
  ) ultimo_mensaje
  where ev.phone_number_id = any(p_phone_number_ids)
    and ev.tipo = 'asignado'
    and ev.detalle ->> 'motivo' = 'handoff_tomado'
    and ev.created_at between p_desde and p_hasta
$$;

comment on function public.dulabs_tiempo_hasta_toma_promedio_seg is
  'Fase 11 -- tiempo promedio (segundos) entre el último mensaje entrante de una conversación y el momento en que un agente la tomó explícitamente (handoff_tomado), para los phone_number_id y rango de fechas dados. muestras=0 si no hubo ningún handoff en el rango (promedio_seg viene null en ese caso, nunca 0 falso).';

-- Mismo criterio de seguridad que el resto de funciones RPC de F10/F11: sin
-- este REVOKE, cualquier authenticated/anon podría invocarla con el
-- phone_number_id de otro tenant.
revoke all on function public.dulabs_tiempo_hasta_toma_promedio_seg(text[], timestamptz, timestamptz) from public;
grant execute on function public.dulabs_tiempo_hasta_toma_promedio_seg(text[], timestamptz, timestamptz) to service_role;

-- ============================================================
-- VERIFICACION -- correr DESPUES de aplicar el bloque de arriba.
-- ============================================================

select 'dulabs_rate_limit_counters' as objeto, count(*) as filas from public.dulabs_rate_limit_counters;
select dulabs_rate_limit_incrementar('verificacion:manual', 60, 1000000);

select schemaname, tablename, policyname from pg_policies where tablename in ('dulabs_conversacion_eventos', 'dulabs_conversacion_estado') and policyname = 'tenant_select';
select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('dulabs_mensajes_log', 'dulabs_conversacion_eventos', 'dulabs_conversacion_estado');

select dulabs_tiempo_hasta_toma_promedio_seg(array['verificacion'], now() - interval '1 day', now());
