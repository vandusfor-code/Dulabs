-- DuLabs Developer V1 -- Fase 11 (fix aditivo, autorizado). Corrige el error
-- de runtime `column reference "workspace_id" is ambiguous` en
-- dulabs_dev_crear_workspace: la columna de salida `workspace_id` (RETURNS
-- TABLE) es una variable PL/pgSQL en alcance y colisiona con la columna
-- `workspace_id` de las tablas referenciadas en el cuerpo (INSERT / ON
-- CONFLICT), bajo el `#variable_conflict` por defecto (error).
--
-- Corrección MÍNIMA (Opción A aprobada): se añade la directiva
-- `#variable_conflict use_column` como primera línea del cuerpo, de modo que
-- toda referencia ambigua resuelva a la COLUMNA. El contrato es idéntico:
-- mismos parámetros, mismo RETURNS TABLE (resultado text, workspace_id uuid),
-- misma semántica y advisory lock. El TS que la invoca no cambia.
--
-- Aditiva: NO modifica ni re-ejecuta las migraciones históricas
-- 20261015000000 / 00100 / 00200. Solo hace CREATE OR REPLACE de esta función.
-- No toca datos, no toca Business/AMORE ni las Fases 1-10, no toca el número
-- real conectado (phone_number_id 1359526083904105 / waba 1447966503807955).

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
#variable_conflict use_column
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
