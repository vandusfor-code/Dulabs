-- DuLabs Developer V1 -- Fase 11. RPCs atómicos de creación de recursos con
-- límite A NIVEL DE CUENTA: crear workspace y crear/activar miembro. Ambos
-- con advisory lock por cuenta para que la concurrencia nunca supere el tope.

-- ============================================================
-- 1. CREAR WORKSPACE bajo una cuenta (límite maxWorkspaces)
-- ============================================================
-- Inserta el mapeo workspace->cuenta y una membresía OWNER para el dueño, de
-- forma atómica. workspace_id se genera acá (gen_random_uuid). Cuenta el total
-- de workspaces de la cuenta bajo el lock. p_limite_workspaces NULL = sin tope.
create or replace function public.dulabs_dev_crear_workspace(
  p_account_id uuid,
  p_owner_user_id uuid,
  p_limite_workspaces integer
)
returns table (resultado text, workspace_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt integer;
  v_ws uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('acct:ws:' || p_account_id::text, 0));

  if not exists (select 1 from public.dulabs_dev_accounts a where a.id = p_account_id) then
    return query select 'cuenta_no_encontrada'::text, null::uuid; return;
  end if;

  if p_limite_workspaces is not null then
    select count(*) into v_cnt from public.dulabs_dev_workspace_plans wp where wp.account_id = p_account_id;
    if v_cnt >= p_limite_workspaces then
      return query select 'limite_workspaces_excedido'::text, null::uuid; return;
    end if;
  end if;

  v_ws := gen_random_uuid();
  insert into public.dulabs_dev_workspace_plans (workspace_id, account_id)
  values (v_ws, p_account_id);

  insert into public.dulabs_dev_memberships (workspace_id, user_id, rol, estado)
  values (v_ws, p_owner_user_id, 'OWNER', 'activo')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.dulabs_dev_account_audit (account_id, actor_user_id, accion, despues)
  values (p_account_id, p_owner_user_id, 'CREATE_WORKSPACE', jsonb_build_object('workspace_id', v_ws));

  return query select 'ok'::text, v_ws;
end;
$$;

revoke all on function public.dulabs_dev_crear_workspace(uuid, uuid, integer) from public;
grant execute on function public.dulabs_dev_crear_workspace(uuid, uuid, integer) to service_role;

-- ============================================================
-- 2. CREAR MIEMBRO con límite de cuenta (usuarios ACTIVOS distintos)
-- ============================================================
-- Semántica aprobada: máximo N usuarios DISTINTOS ACTIVOS por CUENTA,
-- compartidos entre workspaces. La exención "ya es miembro -> no consume cupo"
-- aplica SOLO si el usuario ya está ACTIVO en la cuenta (cambiar su rol no
-- agrega un usuario nuevo). Si el usuario NO está activo (no existe o está
-- suspendido), alta/REACTIVACIÓN cuenta como usuario activo nuevo y DEBE
-- pasar el chequeo de límite -> una membresía suspendida jamás puede
-- reactivarse por encima de maxMembers. p_limite_miembros NULL = sin tope.
create or replace function public.dulabs_dev_crear_miembro_con_limite(
  p_workspace_id uuid,
  p_user_id uuid,
  p_rol text,
  p_limite_miembros integer
)
returns table (resultado text, membership_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_cnt integer;
  v_ya_activo integer;
  v_id uuid;
begin
  if p_rol not in ('OWNER', 'ADMIN', 'MEMBER') then
    return query select 'rol_invalido'::text, null::uuid; return;
  end if;

  select wp.account_id into v_account_id
    from public.dulabs_dev_workspace_plans wp where wp.workspace_id = p_workspace_id;

  if v_account_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('acct:mem:' || v_account_id::text, 0));
    -- ¿el usuario ya está ACTIVO en ALGÚN workspace de la cuenta?
    select count(*) into v_ya_activo
      from public.dulabs_dev_memberships m
      join public.dulabs_dev_workspace_plans wp on wp.workspace_id = m.workspace_id
     where wp.account_id = v_account_id and m.user_id = p_user_id and m.estado = 'activo';
    -- Solo chequear cupo si el alta/reactivación AGREGA un usuario activo nuevo.
    if p_limite_miembros is not null and v_ya_activo = 0 then
      select count(distinct m.user_id) into v_cnt
        from public.dulabs_dev_memberships m
        join public.dulabs_dev_workspace_plans wp on wp.workspace_id = m.workspace_id
       where wp.account_id = v_account_id and m.estado = 'activo';
      if v_cnt >= p_limite_miembros then
        return query select 'limite_miembros_excedido'::text, null::uuid; return;
      end if;
    end if;
  else
    -- Legacy sin cuenta: límite por-workspace (compat), misma semántica ACTIVO.
    perform pg_advisory_xact_lock(hashtextextended('ws:mem:' || p_workspace_id::text, 0));
    select count(*) into v_ya_activo from public.dulabs_dev_memberships m
      where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.estado = 'activo';
    if p_limite_miembros is not null and v_ya_activo = 0 then
      select count(distinct m.user_id) into v_cnt from public.dulabs_dev_memberships m
        where m.workspace_id = p_workspace_id and m.estado = 'activo';
      if v_cnt >= p_limite_miembros then
        return query select 'limite_miembros_excedido'::text, null::uuid; return;
      end if;
    end if;
  end if;

  insert into public.dulabs_dev_memberships (workspace_id, user_id, rol, estado, updated_at)
  values (p_workspace_id, p_user_id, p_rol, 'activo', now())
  on conflict (workspace_id, user_id)
    do update set rol = excluded.rol, estado = 'activo', updated_at = now()
  returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$$;

revoke all on function public.dulabs_dev_crear_miembro_con_limite(uuid, uuid, text, integer) from public;
grant execute on function public.dulabs_dev_crear_miembro_con_limite(uuid, uuid, text, integer) to service_role;

-- ============================================================
-- 3. ENSURE ACCOUNT FOR WORKSPACE -- materialización ATÓMICA
-- ============================================================
-- Garantía DB (no solo TS) contra la carrera de materialización: dos requests
-- concurrentes sobre el MISMO workspace nunca crean dos cuentas huérfanas.
-- Advisory lock por workspace -> el segundo espera y ve la cuenta ya creada.
-- Idempotente. NO hace backfill de otros workspaces del owner (solo enlaza
-- ESTE). El aislamiento tenant y el gate OWNER/ADMIN los aplica la ruta que
-- llama (conSesionDeveloper) -- esta función es service_role.
create or replace function public.dulabs_dev_ensure_account_for_workspace(
  p_workspace_id uuid,
  p_owner_user_id uuid
)
returns table (account_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acc uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('ensure_acct:ws:' || p_workspace_id::text, 0));

  select wp.account_id into v_acc
    from public.dulabs_dev_workspace_plans wp where wp.workspace_id = p_workspace_id;
  if v_acc is not null then
    return query select v_acc, false; return;
  end if;

  insert into public.dulabs_dev_accounts (owner_user_id, plan_codigo, estado, periodo_inicio, periodo_fin)
  values (p_owner_user_id, 'DEVELOPER', 'active', now(), now() + interval '1 month')
  returning id into v_acc;

  insert into public.dulabs_dev_workspace_plans (workspace_id, account_id)
  values (p_workspace_id, v_acc)
  on conflict (workspace_id)
    do update set account_id = coalesce(public.dulabs_dev_workspace_plans.account_id, excluded.account_id), updated_at = now();

  -- Fuente de verdad final: el account_id que quedó en la fila (defensa en
  -- profundidad; bajo el lock siempre será el recién creado).
  select wp.account_id into v_acc
    from public.dulabs_dev_workspace_plans wp where wp.workspace_id = p_workspace_id;

  return query select v_acc, true;
end;
$$;

revoke all on function public.dulabs_dev_ensure_account_for_workspace(uuid, uuid) from public;
grant execute on function public.dulabs_dev_ensure_account_for_workspace(uuid, uuid) to service_role;
