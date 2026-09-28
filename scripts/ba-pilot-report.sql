-- Business Agent 2.0 — FASE 10: métricas del piloto. SOLO LECTURA (no escribe nada).
--
-- Uso: SQL Editor de Supabase. Cambia el tenant y la ventana en `params` y ejecuta.
-- Todo sale de tablas reales del Business Agent; nada se estima salvo el costo (tarifas declaradas, ver FASE 9 §7).
-- Si una métrica no tiene fuente real, NO está aquí (ver FASE-10-PRODUCCION-CONTROLADA.md §Métricas).
-- Verificado contra PostgreSQL 16 con la cadena de migraciones: scripts/verify-ba-pilot-report.sh.

with params as (
  select '00000000-0000-0000-0000-000000000000'::uuid as tenant,   -- ← id del tenant piloto
         now() - interval '7 days'                  as since       -- ← ventana
),
usage as (
  select coalesce(sum(u.turns), 0)                    as turns,
         coalesce(sum(u.ai_calls), 0)                 as ai_calls,
         coalesce(sum(u.input_tokens), 0)             as input_tokens,
         coalesce(sum(u.output_tokens), 0)            as output_tokens,
         coalesce(sum(u.estimated_cost_micro_usd), 0) as cost_micro_usd,
         coalesce(sum(u.turn_errors), 0)              as turn_errors,
         coalesce(sum(u.latency_ms_total), 0)         as latency_ms_total
  from public.dulabs_ba_usage_daily u, params p
  where u.id_tenant = p.tenant and u.day >= (p.since at time zone 'UTC')::date
),
execs as (
  select e.* from public.dulabs_ba_action_executions e, params p
  where e.id_tenant = p.tenant and e.created_at >= p.since
),
incidents as (
  select i.* from public.dulabs_ba_incidents i, params p
  where i.id_tenant = p.tenant and i.occurred_at >= p.since
),
reminders as (
  select r.* from public.dulabs_ba_reminders r, params p
  where r.id_tenant = p.tenant and r.created_at >= p.since
),
-- Efecto duplicado real: la MISMA escritura (conversación + acción + argumentos) exitosa más de una vez.
duplicated as (
  select count(*) as n from (
    select conversation_id, action, arguments_hash
    from execs
    where status = 'SUCCEEDED' and action in ('crear_cita_nylas_generico', 'agendar_cita_especialista', 'cancelar_cita_cliente', 'reprogramar_cita_cliente', 'ba_guardar_lead', 'ba_programar_recordatorio', 'transferir_soporte')
    group by 1, 2, 3 having count(*) > 1
  ) d
),
m as (
  select 1 as orden, 'mensajes_atendidos' as metrica, (select turns from usage)::numeric as valor, 'dulabs_ba_usage_daily.turns' as fuente
  union all select 2, 'llamadas_ia', (select ai_calls from usage), 'dulabs_ba_usage_daily.ai_calls'
  union all select 3, 'tokens_entrada', (select input_tokens from usage), 'dulabs_ba_usage_daily.input_tokens'
  union all select 4, 'tokens_salida', (select output_tokens from usage), 'dulabs_ba_usage_daily.output_tokens'
  union all select 5, 'costo_estimado_usd', round((select cost_micro_usd from usage) / 1e6, 4), 'estimación (tarifas declaradas)'
  union all select 6, 'latencia_promedio_ms', case when (select turns from usage) > 0 then round((select latency_ms_total from usage)::numeric / (select turns from usage), 0) end, 'latency_ms_total / turns'
  union all select 7, 'errores_de_turno', (select turn_errors from usage), 'dulabs_ba_usage_daily.turn_errors'
  union all select 8, 'acciones_ejecutadas', (select count(*) from execs where status = 'SUCCEEDED'), 'dulabs_ba_action_executions'
  union all select 9, 'acciones_rechazadas', (select count(*) from execs where status = 'REJECTED'), 'dulabs_ba_action_executions'
  union all select 10, 'acciones_fallidas', (select count(*) from execs where status = 'FAILED'), 'dulabs_ba_action_executions'
  union all select 11, 'acciones_timeout_desenlace_desconocido', (select count(*) from execs where status = 'TIMED_OUT'), 'dulabs_ba_action_executions'
  union all select 12, 'reservas', (select count(*) from execs where status = 'SUCCEEDED' and action in ('crear_cita_nylas_generico', 'agendar_cita_especialista')), 'dulabs_ba_action_executions'
  union all select 13, 'cancelaciones', (select count(*) from execs where status = 'SUCCEEDED' and action = 'cancelar_cita_cliente'), 'dulabs_ba_action_executions'
  union all select 14, 'reprogramaciones', (select count(*) from execs where status = 'SUCCEEDED' and action = 'reprogramar_cita_cliente'), 'dulabs_ba_action_executions'
  union all select 15, 'traspasos_por_accion', (select count(*) from execs where status = 'SUCCEEDED' and action = 'transferir_soporte'), 'dulabs_ba_action_executions (los del Gate por frase no pasan por aquí)'
  union all select 16, 'recordatorios_programados', (select count(*) from reminders), 'dulabs_ba_reminders'
  union all select 17, 'recordatorios_enviados', (select count(*) from reminders where status = 'sent'), 'dulabs_ba_reminders'
  union all select 18, 'recordatorios_fallidos', (select count(*) from reminders where status = 'failed'), 'dulabs_ba_reminders'
  union all select 19, 'recordatorios_desconocidos', (select count(*) from reminders where status = 'unknown'), 'dulabs_ba_reminders'
  union all select 20, 'errores_ia', (select count(*) from incidents where error_class = 'AI'), 'dulabs_ba_incidents'
  union all select 21, 'errores_integracion', (select count(*) from incidents where error_class = 'INTEGRATION'), 'dulabs_ba_incidents'
  union all select 22, 'errores_sistema', (select count(*) from incidents where error_class = 'SYSTEM'), 'dulabs_ba_incidents'
  union all select 23, 'efectos_duplicados', (select n from duplicated), 'misma escritura exitosa > 1 vez (debe ser 0)'
  -- Tasas (%). NULL = sin datos suficientes (nunca se inventa un 0 %).
  union all select 24, 'tasa_fallback_ia_pct', case when (select turns from usage) > 0 then round(100.0 * (select count(*) from incidents where error_class = 'AI') / (select turns from usage), 2) end, 'incidentes AI / mensajes'
  union all select 25, 'tasa_fallo_acciones_pct', case when (select count(*) from execs) > 0 then round(100.0 * (select count(*) from execs where status in ('FAILED', 'TIMED_OUT')) / (select count(*) from execs), 2) end, '(FAILED + TIMED_OUT) / ejecuciones'
  union all select 26, 'tasa_efecto_duplicado_pct', case when (select count(*) from execs where status = 'SUCCEEDED') > 0 then round(100.0 * (select n from duplicated) / (select count(*) from execs where status = 'SUCCEEDED'), 2) end, 'duplicados / exitosas'
  union all select 27, 'tasa_desenlace_desconocido_pct', case when (select count(*) from execs) > 0 then round(100.0 * (select count(*) from execs where status = 'TIMED_OUT') / (select count(*) from execs), 2) end, 'TIMED_OUT / ejecuciones'
)
select metrica, valor, fuente from m order by orden;
