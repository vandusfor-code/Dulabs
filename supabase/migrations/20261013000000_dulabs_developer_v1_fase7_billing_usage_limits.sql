-- DuLabs Developer V1 -- Fase 7 (Billing + Usage + Limits, autorizado).
-- Migración puramente ADITIVA, aislada del esquema de Business y de AMORE.
-- Ninguna tabla existente se borra; solo se agrega una columna nueva a
-- dulabs_dev_usage_ledger (period), dos tablas nuevas (planes + mapeo
-- workspace->plan) y dos funciones atómicas.
--
-- Alcance Fase 7 = SOLO el motor interno: planes (fuente de verdad),
-- usage mensual, reserva atómica contra cuota, límite de números. NO hay
-- cobros, ni Stripe, ni checkout, ni facturación (fases posteriores).
--
-- Decisiones aprobadas:
--   - dulabs_dev_plans es la fuente de verdad de los límites.
--   - DEVELOPER: 20.000 mensajes/mes, 2 números incluidos, +USD 5 por
--     número adicional (metadato, Fase 7 no cobra), 2 msg/s por número.
--   - AGENCY / ENTERPRISE: límites NULL = "configurable / sin límite
--     definido todavía" (NUNCA se inventan cifras -> NULL no bloquea).
--   - Todo workspace sin fila en dulabs_dev_workspace_plans se resuelve
--     como DEVELOPER por defecto (ver lib/developer/plans.ts).
--   - El 3er número se rechaza al superar el límite (sin overflow pagado).
--
-- Zona horaria del período: America/Bogota (UTC-5, sin DST) -- misma que
-- usa el resto del sistema. El período es determinista: YYYY-MM del
-- momento local de Colombia.

-- ============================================================
-- 1. PLANES (fuente de verdad de límites)
-- ============================================================
create table if not exists public.dulabs_dev_plans (
  codigo text primary key,
  nombre text not null,
  -- NULL = límite no definido / sin límite (nunca se inventan cifras para
  -- AGENCY/ENTERPRISE). El enforcement trata NULL como "no aplicar límite".
  mensajes_mensuales_incluidos integer check (mensajes_mensuales_incluidos is null or mensajes_mensuales_incluidos >= 0),
  numeros_incluidos integer check (numeros_incluidos is null or numeros_incluidos >= 0),
  mensajes_por_segundo_por_numero integer check (mensajes_por_segundo_por_numero is null or mensajes_por_segundo_por_numero >= 0),
  -- Metadatos comerciales -- Fase 7 NO cobra; se guardan para las fases de
  -- pricing/checkout futuras, nunca se exponen en GET /api/v1/usage.
  precio_numero_adicional_usd numeric(10, 2),
  precio_mensual_usd numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dulabs_dev_plans enable row level security;

-- El catálogo de planes es dato de referencia no sensible -- cualquier
-- usuario autenticado puede leerlo. Las mutaciones son exclusivas del
-- backend con service_role (sin política de INSERT/UPDATE/DELETE).
drop policy if exists plans_select on public.dulabs_dev_plans;
create policy plans_select on public.dulabs_dev_plans
  for select to authenticated using (true);

comment on table public.dulabs_dev_plans is
  'DuLabs Developer V1 (Fase 7). Fuente de verdad de límites de plan. Columnas de límite NULL = configurable/sin límite definido (AGENCY/ENTERPRISE) -> el enforcement no bloquea. Precios = metadato, Fase 7 no cobra.';

-- Seed. on conflict do nothing: re-correr la migración nunca pisa un valor
-- que un admin haya ajustado en runtime. DEVELOPER con cifras concretas;
-- AGENCY/ENTERPRISE con límites NULL (configurables) y solo el precio base.
insert into public.dulabs_dev_plans
  (codigo, nombre, mensajes_mensuales_incluidos, numeros_incluidos, mensajes_por_segundo_por_numero, precio_numero_adicional_usd, precio_mensual_usd)
values
  ('DEVELOPER',  'Developer',  20000, 2,    2,    5.00,  19.00),
  ('AGENCY',     'Agency/Pro', null,  null, null, null,  59.00),
  ('ENTERPRISE', 'Enterprise', null,  null, null, null,  199.00)
on conflict (codigo) do nothing;

-- ============================================================
-- 2. MAPEO workspace -> plan
-- ============================================================
create table if not exists public.dulabs_dev_workspace_plans (
  workspace_id uuid primary key,
  plan_codigo text not null default 'DEVELOPER' references public.dulabs_dev_plans (codigo),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dulabs_dev_workspace_plans enable row level security;

drop policy if exists tenant_select on public.dulabs_dev_workspace_plans;
create policy tenant_select on public.dulabs_dev_workspace_plans
  for select to authenticated
  using (workspace_id = public.dulabs_tenant_del_usuario());

comment on table public.dulabs_dev_workspace_plans is
  'DuLabs Developer V1 (Fase 7). Mapeo workspace->plan. AUSENCIA de fila = plan DEVELOPER por defecto (todos los workspaces existentes son DEVELOPER sin necesidad de backfill). Ver lib/developer/plans.ts::resolverPlanDelWorkspace.';

-- ============================================================
-- 3. USAGE LEDGER -- dimensión de período mensual
-- ============================================================
-- period (YYYY-MM en hora de Colombia) permite el conteo mensual de cuota.
-- Default a nivel de columna -> los INSERT existentes de reservarUso (Fase
-- 2/3, que no conocen period) siguen funcionando sin cambios. La función
-- atómica de abajo lo fija explícitamente con el MISMO valor para que el
-- conteo y la fila insertada sean consistentes dentro de la misma llamada.
alter table public.dulabs_dev_usage_ledger
  add column if not exists period text;

update public.dulabs_dev_usage_ledger
  set period = to_char((created_at at time zone 'America/Bogota'), 'YYYY-MM')
  where period is null;

alter table public.dulabs_dev_usage_ledger
  alter column period set default to_char((now() at time zone 'America/Bogota'), 'YYYY-MM');

alter table public.dulabs_dev_usage_ledger
  alter column period set not null;

-- Conteo mensual por workspace en O(index): (workspace_id, period).
create index if not exists dulabs_dev_usage_ledger_workspace_period_idx
  on public.dulabs_dev_usage_ledger (workspace_id, period);

-- ============================================================
-- 4. RESERVA MENSUAL ATÓMICA (idempotencia + cuota + job + ledger)
-- ============================================================
-- Prioridad máxima de Fase 7: reserva atómica y CERO idempotency-key/job
-- huérfano cuando se excede la cuota.
--
-- Todo ocurre en UNA sola llamada/transacción:
--   1. Reclama idempotencia (UNIQUE(workspace_id, idempotency_key) real).
--      - conflicto de payload distinto -> 'conflicto_payload_distinto'.
--      - misma clave + mismo payload -> 'duplicado_identico' (NUNCA vuelve
--        a chequear cuota ni a reservar: la reserva original ya cuenta).
--   2. Solo para requests NUEVOS: advisory lock por (workspace, período) ->
--      serializa la lectura+reserva de la cuota mensual (elimina el race
--      "dos leen N, ambos insertan"). Si la cuota se excede, se lanza una
--      excepción que hace ROLLBACK de TODO -- incluido el reclamo de
--      idempotencia del paso 1 -> nunca queda un idempotency-key apuntando
--      a un job que no existe, ni job, ni ledger, ni se publica nada.
--   3. Inserta el job y la reserva de ledger con el MISMO job_id.
--
-- p_limite_mensual NULL = plan sin límite (AGENCY/ENTERPRISE) -> no se
-- aplica cuota. El límite lo resuelve el caller desde el plan (lib/
-- developer/plans.ts) y lo pasa acá -- esta función es un primitivo
-- genérico "reserva bajo límite", lo que además permite probarla con
-- límites pequeños en los tests de concurrencia.
create or replace function public.dulabs_dev_reclamar_reservar_mensaje(
  p_workspace_id uuid,
  p_idempotency_key text,
  p_payload_hash text,
  p_payload jsonb,
  p_whatsapp_number_id uuid,
  p_limite_mensual integer,
  p_cantidad integer default 1
)
returns table (resultado text, job_id uuid, periodo text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_existing_hash text;
  v_existing_job uuid;
  v_period text;
  v_usado integer;
begin
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'cantidad debe ser un entero positivo' using errcode = '22023';
  end if;

  -- 1) Reclamo de idempotencia (atómico por el UNIQUE de Fase 1).
  begin
    insert into public.dulabs_dev_idempotency_keys (workspace_id, idempotency_key, payload_hash)
    values (p_workspace_id, p_idempotency_key, p_payload_hash)
    returning dulabs_dev_idempotency_keys.job_id into v_job_id;
  exception when unique_violation then
    select k.payload_hash, k.job_id
      into v_existing_hash, v_existing_job
      from public.dulabs_dev_idempotency_keys k
     where k.workspace_id = p_workspace_id
       and k.idempotency_key = p_idempotency_key;
    if v_existing_hash is distinct from p_payload_hash then
      return query select 'conflicto_payload_distinto'::text, null::uuid, null::text;
      return;
    end if;
    return query select 'duplicado_identico'::text, v_existing_job, null::text;
    return;
  end;

  -- 2) Cuota mensual atómica -- SOLO requests nuevos.
  v_period := to_char((now() at time zone 'America/Bogota'), 'YYYY-MM');
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || v_period, 0));

  if p_limite_mensual is not null then
    select coalesce(sum(l.cantidad), 0)
      into v_usado
      from public.dulabs_dev_usage_ledger l
     where l.workspace_id = p_workspace_id
       and l.period = v_period
       and l.estado in ('reservado', 'confirmado');
    if v_usado + p_cantidad > p_limite_mensual then
      -- ROLLBACK total (incluye el reclamo de idempotencia del paso 1).
      raise exception 'DULABS_LIMITE_MENSUAL_EXCEDIDO' using errcode = 'P0001';
    end if;
  end if;

  -- 3) Persistencia atómica: job + reserva de ledger, mismo job_id.
  insert into public.dulabs_dev_jobs (id, workspace_id, whatsapp_number_id, status, physical_outcome, payload)
  values (v_job_id, p_workspace_id, p_whatsapp_number_id, 'created', 'pre_send', p_payload);

  insert into public.dulabs_dev_usage_ledger (workspace_id, job_id, estado, cantidad, period)
  values (p_workspace_id, v_job_id, 'reservado', p_cantidad, v_period);

  return query select 'nuevo'::text, v_job_id, v_period;
end;
$$;

revoke all on function public.dulabs_dev_reclamar_reservar_mensaje(uuid, text, text, jsonb, uuid, integer, integer) from public;
grant execute on function public.dulabs_dev_reclamar_reservar_mensaje(uuid, text, text, jsonb, uuid, integer, integer) to service_role;

-- ============================================================
-- 5. REGISTRO DE NÚMERO CON LÍMITE ATÓMICO
-- ============================================================
-- Un número NUEVO para el workspace consume cupo; una RECONEXIÓN del mismo
-- phone_number_id (mismo workspace) no. Concurrencia protegida por advisory
-- lock por workspace -> dos altas concurrentes de números distintos con un
-- solo cupo libre nunca superan el límite. p_limite_numeros NULL = plan sin
-- límite. El token de Meta llega YA cifrado desde TS (nunca en claro acá).
create or replace function public.dulabs_dev_registrar_numero_con_limite(
  p_workspace_id uuid,
  p_phone_number_id text,
  p_waba_id text,
  p_display_name text,
  p_meta_token_cifrado text,
  p_limite_numeros integer
)
returns table (resultado text, numero_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_workspace uuid;
  v_existing_id uuid;
  v_count integer;
  v_id uuid;
begin
  select n.workspace_id, n.id
    into v_existing_workspace, v_existing_id
    from public.dulabs_dev_whatsapp_numbers n
   where n.phone_number_id = p_phone_number_id;

  -- phone_number_id es único GLOBAL -- si ya es de OTRO workspace, se rechaza.
  if v_existing_workspace is not null and v_existing_workspace <> p_workspace_id then
    return query select 'numero_ya_conectado_a_otro_workspace'::text, null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('numbers:' || p_workspace_id::text, 0));

  -- Reconexión del mismo número (mismo workspace) -- no consume cupo nuevo.
  if v_existing_workspace = p_workspace_id then
    update public.dulabs_dev_whatsapp_numbers
       set whatsapp_business_account_id = coalesce(p_waba_id, whatsapp_business_account_id),
           display_name = coalesce(p_display_name, display_name),
           estado = 'conectado',
           meta_token_cifrado = coalesce(p_meta_token_cifrado, meta_token_cifrado),
           updated_at = now()
     where id = v_existing_id
     returning id into v_id;
    return query select 'reconectado'::text, v_id;
    return;
  end if;

  -- Número NUEVO -- chequeo de cupo atómico bajo el lock.
  if p_limite_numeros is not null then
    select count(*)
      into v_count
      from public.dulabs_dev_whatsapp_numbers n
     where n.workspace_id = p_workspace_id;
    if v_count >= p_limite_numeros then
      return query select 'limite_numeros_excedido'::text, null::uuid;
      return;
    end if;
  end if;

  insert into public.dulabs_dev_whatsapp_numbers
    (workspace_id, phone_number_id, whatsapp_business_account_id, display_name, estado, meta_token_cifrado)
  values
    (p_workspace_id, p_phone_number_id, p_waba_id, p_display_name, 'conectado', p_meta_token_cifrado)
  returning id into v_id;

  return query select 'creado'::text, v_id;
end;
$$;

revoke all on function public.dulabs_dev_registrar_numero_con_limite(uuid, text, text, text, text, integer) from public;
grant execute on function public.dulabs_dev_registrar_numero_con_limite(uuid, text, text, text, text, integer) to service_role;
