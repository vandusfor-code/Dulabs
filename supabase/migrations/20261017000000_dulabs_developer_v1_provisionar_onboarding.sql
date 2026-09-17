-- DuLabs Developer V1 -- Provisión de onboarding (aditivo, autorizado).
--
-- GAP real detectado: un usuario nuevo se crea en auth.users al registrarse,
-- pero NO existía ninguna auto-provisión de su primer workspace. Como los
-- workspaces salen de dulabs_dev_memberships (o del fallback Business), un
-- signup 100% nuevo quedaba con 0 workspaces -> el dashboard mostraba
-- "Select a workspace" y no podía operar. Los RPCs existentes
-- (dulabs_dev_crear_workspace / dulabs_dev_ensure_account_for_workspace)
-- asumen que YA existe una cuenta o un workspace, así que no cubren el
-- arranque en frío del primer workspace del usuario.
--
-- Esta función compone la MISMA lógica de esos dos RPCs (crear cuenta
-- DEVELOPER + crear workspace + membership OWNER) en un solo bootstrap
-- ATÓMICO e IDEMPOTENTE. No es una arquitectura paralela: usa exactamente las
-- mismas tablas (dulabs_dev_accounts, dulabs_dev_workspace_plans,
-- dulabs_dev_memberships, dulabs_dev_account_audit), el mismo plan por defecto
-- ('DEVELOPER', active, período mensual) y el mismo grant (service_role).
--
-- Idempotencia: advisory lock por USUARIO + si el usuario ya tiene una
-- membership Developer activa, devuelve ese workspace sin crear nada (created
-- = false). Dos requests concurrentes del mismo usuario nunca crean dos
-- workspaces. NO toca Business/AMORE ni el fallback dulabs_miembros_equipo.
-- Aislamiento: la identidad humana la valida la ruta (auth.getUser) y pasa el
-- user_id ya verificado; la función nunca crea nada para un tercero.

create or replace function public.dulabs_dev_provisionar_onboarding(
  p_owner_user_id uuid
)
returns table (workspace_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_ws uuid;
  v_acc uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('dev:provision:' || p_owner_user_id::text, 0));

  -- Idempotente: si ya tiene una membership Developer activa, ese es su workspace.
  select m.workspace_id into v_ws
    from public.dulabs_dev_memberships m
    where m.user_id = p_owner_user_id and m.estado = 'activo'
    order by m.created_at asc
    limit 1;
  if v_ws is not null then
    return query select v_ws, false; return;
  end if;

  -- Cuenta DEVELOPER nueva (misma forma que ensure_account_for_workspace).
  insert into public.dulabs_dev_accounts (owner_user_id, plan_codigo, estado, periodo_inicio, periodo_fin)
  values (p_owner_user_id, 'DEVELOPER', 'active', now(), now() + interval '1 month')
  returning id into v_acc;

  -- Workspace + membership OWNER (misma forma que dulabs_dev_crear_workspace).
  v_ws := gen_random_uuid();
  insert into public.dulabs_dev_workspace_plans (workspace_id, account_id)
  values (v_ws, v_acc);

  insert into public.dulabs_dev_memberships (workspace_id, user_id, rol, estado)
  values (v_ws, p_owner_user_id, 'OWNER', 'activo')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.dulabs_dev_account_audit (account_id, actor_user_id, accion, despues)
  values (v_acc, p_owner_user_id, 'CREATE_WORKSPACE', jsonb_build_object('workspace_id', v_ws, 'via', 'provisionar_onboarding'));

  return query select v_ws, true;
end;
$$;

revoke all on function public.dulabs_dev_provisionar_onboarding(uuid) from public;
grant execute on function public.dulabs_dev_provisionar_onboarding(uuid) to service_role;

comment on function public.dulabs_dev_provisionar_onboarding(uuid) is
  'DuLabs Developer V1. Bootstrap atómico e idempotente del primer workspace de un usuario nuevo: crea cuenta DEVELOPER + workspace + membership OWNER (o devuelve el workspace existente). Cierra el gap de auto-provisión del registro. Solo service_role.';
