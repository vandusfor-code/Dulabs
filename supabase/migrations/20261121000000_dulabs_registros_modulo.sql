-- REGISTROS DE MÓDULO — respaldo y conciliación de la acción GENÉRICA `registrar_en_modulo`.
--
-- Problema que resuelve: si el registro en un módulo (p. ej. una solicitud) falla por un error
-- transitorio o ambiguo, el Flow igual continúa (la atención humana no se bloquea), pero el
-- registro NO puede perderse en silencio. Antes de intentar el registro, el motor deja aquí una
-- fila "pendiente" (bandeja de salida). Si el registro termina bien pasa a "registrado"; si el
-- error es definitivo, a "fallido" (visible, con su motivo); si es transitorio queda "pendiente"
-- y un conciliador lo reprocesa más tarde leyendo los datos de la EJECUCIÓN ORIGINAL.
--
-- Genérico: no conoce ningún negocio. `modulo` es el id del módulo del tenant y `campos` el mapa
-- campo del módulo → variable del Flow que declaró la acción. El registro final lo hace el
-- manejador del módulo, que es idempotente por flow_execution_id (una ejecución → un registro).
--
-- Garantías en la BASE DE DATOS:
--   1. Una fila por (tenant, módulo, ejecución): UNIQUE. Reintentos y reprocesos no la duplican.
--   2. La fila solo se crea si el número es del tenant y la ejecución REAL existe para ese
--      tenant, número y teléfono (no se aceptan ids inventados).
--   3. Reclamo concurrente seguro: FOR UPDATE SKIP LOCKED + lease. Varios conciliadores a la vez
--      nunca toman la misma fila al mismo tiempo; y aunque la tomaran, el registro final es
--      idempotente (UNIQUE del módulo).
--   4. Estados terminales: una fila "registrado" o "fallido" no vuelve a cambiar sola; "fallido"
--      solo vuelve a "pendiente" por una acción explícita (reencolar) del equipo del tenant.
--   5. Solo service_role. RLS activo sin políticas; revocado a anon/authenticated.
--
-- ADITIVA: no modifica ninguna tabla, dato, índice, trigger ni permiso existente.
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE). Rollback (solo sin datos reales):
--   drop function if exists public.dulabs_registro_modulo_abrir(uuid, text, uuid, text, text, text, jsonb, integer),
--     public.dulabs_registro_modulo_resolver(uuid, bigint, text, text, text, integer),
--     public.dulabs_registro_modulo_reclamar(integer, uuid, integer),
--     public.dulabs_registro_modulo_resumen(uuid, text),
--     public.dulabs_registro_modulo_reencolar(uuid, bigint);
--   drop table if exists public.dulabs_registros_modulo;

begin;

create table if not exists public.dulabs_registros_modulo (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  modulo text not null,
  flow_execution_id uuid not null,
  phone_number_id text not null,
  telefono_cliente text not null,
  node_id text,
  -- campo del módulo → variable del Flow (los VALORES se leen de la ejecución al conciliar).
  campos jsonb not null,
  estado text not null default 'pendiente',
  intentos integer not null default 0,
  ultimo_error text,
  registro_id text,
  proximo_intento_at timestamptz not null default now(),
  lease_hasta timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resuelto_at timestamptz,
  constraint dulabs_registros_modulo_ejecucion_key unique (tenant_id, modulo, flow_execution_id),
  constraint dulabs_registros_modulo_estado_check check (estado in ('pendiente', 'registrado', 'fallido')),
  constraint dulabs_registros_modulo_modulo_check check (modulo ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint dulabs_registros_modulo_campos_check check (jsonb_typeof(campos) = 'object'),
  constraint dulabs_registros_modulo_intentos_check check (intentos >= 0),
  constraint dulabs_registros_modulo_error_check check (ultimo_error is null or char_length(ultimo_error) <= 300),
  constraint dulabs_registros_modulo_registro_check check (registro_id is null or char_length(registro_id) <= 100)
);

comment on table public.dulabs_registros_modulo is
  'Respaldo/conciliación de registrar_en_modulo (genérico): una fila por (tenant, módulo, ejecución). pendiente → registrado | fallido. Solo service_role.';

-- Cola del conciliador y resumen del dashboard.
create index if not exists dulabs_registros_modulo_cola_idx
  on public.dulabs_registros_modulo (proximo_intento_at, id) where estado = 'pendiente';
create index if not exists dulabs_registros_modulo_tenant_idx
  on public.dulabs_registros_modulo (tenant_id, modulo, estado, created_at desc);

alter table public.dulabs_registros_modulo enable row level security;
revoke all on table public.dulabs_registros_modulo from anon, authenticated;

-- Abre (o devuelve) la fila de una ejecución. p_gracia_segundos: el conciliador no la toma
-- mientras el motor todavía la está procesando en línea.
create or replace function public.dulabs_registro_modulo_abrir(
  p_tenant uuid,
  p_modulo text,
  p_flow_execution_id uuid,
  p_phone_number_id text,
  p_telefono text,
  p_node_id text,
  p_campos jsonb,
  p_gracia_segundos integer
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_fila public.dulabs_registros_modulo;
begin
  if not exists (
    select 1 from public.dulabs_clientes_config c where c.phone_number_id = p_phone_number_id and c.id_tenant = p_tenant
  ) then
    raise exception 'registro_numero_ajeno' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.dulabs_flow_executions e
     where e.tenant_id = p_tenant and e.id = p_flow_execution_id
       and e.phone_number_id = p_phone_number_id and e.telefono_cliente = p_telefono
  ) then
    raise exception 'registro_ejecucion_inexistente' using errcode = 'P0001';
  end if;

  insert into public.dulabs_registros_modulo (
    tenant_id, modulo, flow_execution_id, phone_number_id, telefono_cliente, node_id, campos, proximo_intento_at
  ) values (
    p_tenant, p_modulo, p_flow_execution_id, p_phone_number_id, p_telefono, p_node_id, p_campos,
    now() + make_interval(secs => greatest(coalesce(p_gracia_segundos, 0), 0))
  )
  on conflict (tenant_id, modulo, flow_execution_id) do nothing;

  select * into v_fila from public.dulabs_registros_modulo r
   where r.tenant_id = p_tenant and r.modulo = p_modulo and r.flow_execution_id = p_flow_execution_id;
  return jsonb_build_object('id', v_fila.id, 'estado', v_fila.estado, 'intentos', v_fila.intentos);
end;
$$;

-- Cierra una ronda de procesamiento. Solo actúa sobre filas "pendiente" (los estados terminales
-- no se pisan). p_estado: 'registrado' | 'fallido' | 'pendiente' (con p_reintentar_en_segundos).
create or replace function public.dulabs_registro_modulo_resolver(
  p_tenant uuid,
  p_id bigint,
  p_estado text,
  p_registro_id text,
  p_error text,
  p_reintentar_en_segundos integer
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_fila public.dulabs_registros_modulo;
begin
  if p_estado not in ('registrado', 'fallido', 'pendiente') then
    raise exception 'registro_estado_invalido' using errcode = 'P0001';
  end if;
  update public.dulabs_registros_modulo r
     set estado = p_estado,
         intentos = r.intentos + 1,
         registro_id = coalesce(left(p_registro_id, 100), r.registro_id),
         ultimo_error = case when p_estado = 'registrado' then r.ultimo_error else left(p_error, 300) end,
         proximo_intento_at = case when p_estado = 'pendiente'
                                   then now() + make_interval(secs => greatest(coalesce(p_reintentar_en_segundos, 60), 1))
                                   else r.proximo_intento_at end,
         lease_hasta = null,
         resuelto_at = case when p_estado = 'pendiente' then null else now() end,
         updated_at = now()
   where r.id = p_id and r.tenant_id = p_tenant and r.estado = 'pendiente'
  returning * into v_fila;
  return jsonb_build_object('actualizado', v_fila.id is not null, 'estado', v_fila.estado, 'intentos', v_fila.intentos);
end;
$$;

-- Reclama hasta p_limite filas vencidas (todas o de un tenant) con un lease. Devuelve cada fila
-- con las variables de su ejecución ORIGINAL (null si la ejecución ya no existe o no coincide en
-- tenant, número y teléfono).
create or replace function public.dulabs_registro_modulo_reclamar(p_limite integer, p_tenant uuid, p_lease_segundos integer)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_resultado jsonb;
begin
  with elegidos as (
    select r.id
      from public.dulabs_registros_modulo r
     where r.estado = 'pendiente'
       and r.proximo_intento_at <= now()
       and (r.lease_hasta is null or r.lease_hasta < now())
       and (p_tenant is null or r.tenant_id = p_tenant)
     order by r.proximo_intento_at, r.id
     limit least(greatest(coalesce(p_limite, 25), 1), 200)
     for update skip locked
  ),
  tomados as (
    update public.dulabs_registros_modulo r
       set lease_hasta = now() + make_interval(secs => least(greatest(coalesce(p_lease_segundos, 120), 10), 3600)),
           updated_at = now()
      from elegidos e
     where r.id = e.id
    returning r.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'tenantId', t.tenant_id,
    'modulo', t.modulo,
    'flowExecutionId', t.flow_execution_id,
    'phoneNumberId', t.phone_number_id,
    'telefonoCliente', t.telefono_cliente,
    'campos', t.campos,
    'intentos', t.intentos,
    'variables', e.variables
  ) order by t.id), '[]'::jsonb)
    into v_resultado
    from tomados t
    left join public.dulabs_flow_executions e
      on e.tenant_id = t.tenant_id and e.id = t.flow_execution_id
     and e.phone_number_id = t.phone_number_id and e.telefono_cliente = t.telefono_cliente;
  return v_resultado;
end;
$$;

-- Resumen para el dashboard del tenant: cuántos pendientes/fallidos y los últimos 50 sin registrar.
create or replace function public.dulabs_registro_modulo_resumen(p_tenant uuid, p_modulo text)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'pendientes', (select count(*) from public.dulabs_registros_modulo r
                    where r.tenant_id = p_tenant and r.modulo = p_modulo and r.estado = 'pendiente'),
    'fallidos', (select count(*) from public.dulabs_registros_modulo r
                  where r.tenant_id = p_tenant and r.modulo = p_modulo and r.estado = 'fallido'),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'estado', x.estado,
        'telefono', x.telefono_cliente,
        'flowExecutionId', x.flow_execution_id,
        'intentos', x.intentos,
        'ultimoError', x.ultimo_error,
        'proximoIntentoAt', x.proximo_intento_at,
        'createdAt', x.created_at
      ) order by x.created_at desc, x.id desc)
      from (
        select * from public.dulabs_registros_modulo r
         where r.tenant_id = p_tenant and r.modulo = p_modulo and r.estado <> 'registrado'
         order by r.created_at desc, r.id desc
         limit 50
      ) x
    ), '[]'::jsonb)
  );
$$;

-- Vuelve a poner en cola una fila "fallido" del tenant (p. ej. tras habilitar el módulo).
create or replace function public.dulabs_registro_modulo_reencolar(p_tenant uuid, p_id bigint)
returns jsonb
language sql
set search_path = public, pg_temp
as $$
  with r as (
    update public.dulabs_registros_modulo r
       set estado = 'pendiente', proximo_intento_at = now(), lease_hasta = null, resuelto_at = null, updated_at = now()
     where r.id = p_id and r.tenant_id = p_tenant and r.estado = 'fallido'
    returning r.id
  )
  select jsonb_build_object('reencolado', exists (select 1 from r));
$$;

revoke all on function public.dulabs_registro_modulo_abrir(uuid, text, uuid, text, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.dulabs_registro_modulo_resolver(uuid, bigint, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.dulabs_registro_modulo_reclamar(integer, uuid, integer) from public, anon, authenticated;
revoke all on function public.dulabs_registro_modulo_resumen(uuid, text) from public, anon, authenticated;
revoke all on function public.dulabs_registro_modulo_reencolar(uuid, bigint) from public, anon, authenticated;
grant execute on function public.dulabs_registro_modulo_abrir(uuid, text, uuid, text, text, text, jsonb, integer) to service_role;
grant execute on function public.dulabs_registro_modulo_resolver(uuid, bigint, text, text, text, integer) to service_role;
grant execute on function public.dulabs_registro_modulo_reclamar(integer, uuid, integer) to service_role;
grant execute on function public.dulabs_registro_modulo_resumen(uuid, text) to service_role;
grant execute on function public.dulabs_registro_modulo_reencolar(uuid, bigint) to service_role;

commit;
