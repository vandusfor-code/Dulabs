-- DuLabs — Bloque 14: topes de costo y abuso del agente (por cliente y por negocio).
--
-- 100 % ADITIVO. Requiere 20261113000000_dulabs_agente_trazas.sql (el consumo se lee de las
-- trazas: no hay contadores aparte que se puedan desincronizar). Sin esta migración el agente
-- funciona igual, con los topes por defecto del código… que no se pueden medir (sin trazas no
-- hay consumo): no frena ninguna venta.
--
--   dulabs_agente_runtime_config.limites   topes del agente (jsonb, opcional). Vacío = por defecto:
--       {"turnos_por_minuto_cliente": 8, "turnos_por_dia_cliente": 300, "tokens_por_dia_negocio": 20000000}
--   dulabs_agente_consumo(negocio, número, contact_ref)
--       turnos con modelo del cliente en el último minuto y en las últimas 24 h, y tokens del
--       negocio en las últimas 24 h (entrada + salida + razonamiento).
--
-- Qué hace el agente al superarlos:
--   ritmo por minuto del cliente   -> no llama al modelo ni responde ese mensaje (spam / bucle);
--   turnos del día del cliente     -> pasa la conversación a una asesora (mensaje fijo);
--   tokens del día del negocio     -> cada conversación nueva pasa a una asesora (mensaje fijo).
--
-- Rollback:
--   drop function if exists public.dulabs_agente_consumo(uuid, text, text);
--   alter table public.dulabs_agente_runtime_config drop column if exists limites;
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md).

begin;

alter table public.dulabs_agente_runtime_config
  add column if not exists limites jsonb not null default '{}'::jsonb
  check (jsonb_typeof(limites) = 'object' and pg_column_size(limites) <= 1024);

comment on column public.dulabs_agente_runtime_config.limites is
  'Bloque 14 — topes del agente: turnos_por_minuto_cliente, turnos_por_dia_cliente, tokens_por_dia_negocio. Vacío = valores por defecto del código.';

create or replace function public.dulabs_agente_consumo(p_tenant uuid, p_pn text, p_contact_ref text)
returns table (turnos_minuto_cliente integer, turnos_dia_cliente integer, tokens_dia_negocio bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    (select count(*)::integer from public.dulabs_agente_trazas
      where phone_number_id = p_pn and contact_ref = p_contact_ref and tipo = 'turn'
        and created_at > now() - interval '1 minute' and coalesce((traza ->> 'rounds')::integer, 0) > 0),
    (select count(*)::integer from public.dulabs_agente_trazas
      where phone_number_id = p_pn and contact_ref = p_contact_ref and tipo = 'turn'
        and created_at > now() - interval '24 hours' and coalesce((traza ->> 'rounds')::integer, 0) > 0),
    (select coalesce(sum(coalesce((traza #>> '{usage,input}')::bigint, 0) + coalesce((traza #>> '{usage,output}')::bigint, 0) + coalesce((traza #>> '{usage,thinking}')::bigint, 0)), 0)
       from public.dulabs_agente_trazas
      where id_tenant = p_tenant and tipo = 'turn' and created_at > now() - interval '24 hours')
$$;

revoke all on function public.dulabs_agente_consumo(uuid, text, text) from public, anon, authenticated;
grant execute on function public.dulabs_agente_consumo(uuid, text, text) to service_role;

commit;
