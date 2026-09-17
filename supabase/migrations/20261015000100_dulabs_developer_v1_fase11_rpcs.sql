-- DuLabs Developer V1 -- Fase 11 (Plans / Pricing / Subscriptions, autorizado).
-- RPCs de Fase 11. Todo atómico (advisory lock por cuenta), security definer,
-- solo service_role. Aditivo/compatible: los 2 RPCs de Fase 7 se extienden a
-- "account-aware" CONSERVANDO su firma exacta y su comportamiento legacy
-- cuando el workspace no tiene cuenta (account_id NULL) -> los tests y call
-- sites de Fase 7/10 no cambian.
--
-- Modelo aprobado: números, mensajes, miembros y workspaces se cuentan A
-- NIVEL DE CUENTA (agregado across los workspaces de la cuenta). Un workspace
-- sin cuenta = DEVELOPER legacy y se cuenta por-workspace (idéntico a Fase 7).

-- ============================================================
-- 1. RESERVA MENSUAL DE MENSAJE -- account-aware (misma firma)
-- ============================================================
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
  v_account_id uuid;
begin
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'cantidad debe ser un entero positivo' using errcode = '22023';
  end if;

  -- 1) Reclamo de idempotencia (atómico por el UNIQUE de Fase 1). Igual que Fase 7.
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

  -- 2) Cuota mensual atómica. Fase 11: scope de CUENTA si el workspace tiene
  --    account_id; si no, scope de workspace (legacy Fase 7, idéntico).
  v_period := to_char((now() at time zone 'America/Bogota'), 'YYYY-MM');
  select wp.account_id into v_account_id
    from public.dulabs_dev_workspace_plans wp
   where wp.workspace_id = p_workspace_id;

  if v_account_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('acct:' || v_account_id::text || ':' || v_period, 0));
    if p_limite_mensual is not null then
      select coalesce(sum(l.cantidad), 0)
        into v_usado
        from public.dulabs_dev_usage_ledger l
        join public.dulabs_dev_workspace_plans wp on wp.workspace_id = l.workspace_id
       where wp.account_id = v_account_id
         and l.period = v_period
         and l.estado in ('reservado', 'confirmado');
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || v_period, 0));
    if p_limite_mensual is not null then
      select coalesce(sum(l.cantidad), 0)
        into v_usado
        from public.dulabs_dev_usage_ledger l
       where l.workspace_id = p_workspace_id
         and l.period = v_period
         and l.estado in ('reservado', 'confirmado');
    end if;
  end if;

  if p_limite_mensual is not null and v_usado + p_cantidad > p_limite_mensual then
    raise exception 'DULABS_LIMITE_MENSUAL_EXCEDIDO' using errcode = 'P0001';
  end if;

  -- 3) Persistencia atómica: job + reserva de ledger, mismo job_id. Igual que Fase 7.
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
-- 2. REGISTRO DE NÚMERO CON LÍMITE -- account-aware (misma firma)
-- ============================================================
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
  v_account_id uuid;
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

  select wp.account_id into v_account_id
    from public.dulabs_dev_workspace_plans wp
   where wp.workspace_id = p_workspace_id;

  -- Lock por CUENTA (pool de números de la cuenta) o por workspace (legacy).
  if v_account_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('numbers:acct:' || v_account_id::text, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended('numbers:' || p_workspace_id::text, 0));
  end if;

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

  -- Número NUEVO -- chequeo de cupo atómico bajo el lock, scope de cuenta o workspace.
  if p_limite_numeros is not null then
    if v_account_id is not null then
      select count(*)
        into v_count
        from public.dulabs_dev_whatsapp_numbers n
        join public.dulabs_dev_workspace_plans wp on wp.workspace_id = n.workspace_id
       where wp.account_id = v_account_id;
    else
      select count(*)
        into v_count
        from public.dulabs_dev_whatsapp_numbers n
       where n.workspace_id = p_workspace_id;
    end if;
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

-- ============================================================
-- 3. CAMBIO DE PLAN -- atómico, con validación de downgrade (opción A)
-- ============================================================
-- Bloquea el downgrade si algún recurso de la cuenta (números, workspaces,
-- miembros) supera el límite del plan destino. Al bajar a un plan que no
-- permite adicionales, fuerza numeros_adicionales = 0 (solo si ya cabe).
create or replace function public.dulabs_dev_cambiar_plan(
  p_account_id uuid,
  p_nuevo_plan text,
  p_actor_user_id uuid,
  p_motivo text
)
returns table (resultado text, detalle text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_actual text;
  v_permite_adic boolean;
  v_max_num integer;   -- numeros_incluidos del plan destino
  v_max_ws integer;
  v_max_mem integer;
  v_cnt_num integer;
  v_cnt_ws integer;
  v_cnt_mem integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('acct:plan:' || p_account_id::text, 0));

  select a.plan_codigo into v_plan_actual from public.dulabs_dev_accounts a where a.id = p_account_id;
  if v_plan_actual is null then
    return query select 'cuenta_no_encontrada'::text, null::text; return;
  end if;

  select p.numeros_incluidos, p.max_workspaces, p.max_members, p.permite_numeros_adicionales
    into v_max_num, v_max_ws, v_max_mem, v_permite_adic
    from public.dulabs_dev_plans p where p.codigo = p_nuevo_plan;
  if not found then
    return query select 'plan_invalido'::text, null::text; return;
  end if;

  -- Conteos actuales A NIVEL DE CUENTA.
  select count(*) into v_cnt_num
    from public.dulabs_dev_whatsapp_numbers n
    join public.dulabs_dev_workspace_plans wp on wp.workspace_id = n.workspace_id
   where wp.account_id = p_account_id;
  select count(*) into v_cnt_ws
    from public.dulabs_dev_workspace_plans wp where wp.account_id = p_account_id;
  select count(distinct m.user_id) into v_cnt_mem
    from public.dulabs_dev_memberships m
    join public.dulabs_dev_workspace_plans wp on wp.workspace_id = m.workspace_id
   where wp.account_id = p_account_id and m.estado = 'activo';

  -- Validación de downgrade (opción A): NULL en el destino = sin límite -> no bloquea.
  if v_max_num is not null and v_cnt_num > v_max_num then
    return query select 'downgrade_bloqueado'::text, ('numeros:' || v_cnt_num || '>' || v_max_num)::text; return;
  end if;
  if v_max_ws is not null and v_cnt_ws > v_max_ws then
    return query select 'downgrade_bloqueado'::text, ('workspaces:' || v_cnt_ws || '>' || v_max_ws)::text; return;
  end if;
  if v_max_mem is not null and v_cnt_mem > v_max_mem then
    return query select 'downgrade_bloqueado'::text, ('miembros:' || v_cnt_mem || '>' || v_max_mem)::text; return;
  end if;

  update public.dulabs_dev_accounts
     set plan_codigo = p_nuevo_plan,
         numeros_adicionales = case when v_permite_adic then numeros_adicionales else 0 end,
         updated_at = now()
   where id = p_account_id;

  insert into public.dulabs_dev_account_audit (account_id, actor_user_id, accion, antes, despues, motivo)
  values (p_account_id, p_actor_user_id, 'CHANGE_PLAN', jsonb_build_object('plan', v_plan_actual), jsonb_build_object('plan', p_nuevo_plan), p_motivo);

  return query select 'ok'::text, null::text;
end;
$$;

revoke all on function public.dulabs_dev_cambiar_plan(uuid, text, uuid, text) from public;
grant execute on function public.dulabs_dev_cambiar_plan(uuid, text, uuid, text) to service_role;

-- ============================================================
-- 4. SET NÚMEROS ADICIONALES -- atómico (Agency/Enterprise)
-- ============================================================
-- Solo si el plan permite adicionales. En decremento, rechaza si los números
-- activos de la cuenta superarían el nuevo tope (incluidos + adicionales).
create or replace function public.dulabs_dev_set_numeros_adicionales(
  p_account_id uuid,
  p_nuevo_total integer,
  p_actor_user_id uuid,
  p_motivo text
)
returns table (resultado text, detalle text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_permite boolean;
  v_incluidos integer;
  v_actual integer;
  v_cnt_num integer;
begin
  if p_nuevo_total is null or p_nuevo_total < 0 then
    return query select 'valor_invalido'::text, null::text; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('acct:plan:' || p_account_id::text, 0));

  select a.plan_codigo, a.numeros_adicionales into v_plan, v_actual
    from public.dulabs_dev_accounts a where a.id = p_account_id;
  if v_plan is null then
    return query select 'cuenta_no_encontrada'::text, null::text; return;
  end if;

  select p.permite_numeros_adicionales, p.numeros_incluidos into v_permite, v_incluidos
    from public.dulabs_dev_plans p where p.codigo = v_plan;
  if not v_permite then
    return query select 'no_permitido'::text, null::text; return;
  end if;

  -- Decremento: no dejar números activos por encima del nuevo tope.
  if p_nuevo_total < v_actual then
    select count(*) into v_cnt_num
      from public.dulabs_dev_whatsapp_numbers n
      join public.dulabs_dev_workspace_plans wp on wp.workspace_id = n.workspace_id
     where wp.account_id = p_account_id;
    if v_incluidos is not null and v_cnt_num > (v_incluidos + p_nuevo_total) then
      return query select 'recursos_por_encima'::text, ('numeros:' || v_cnt_num || '>' || (v_incluidos + p_nuevo_total))::text; return;
    end if;
  end if;

  update public.dulabs_dev_accounts
     set numeros_adicionales = p_nuevo_total, updated_at = now()
   where id = p_account_id;

  insert into public.dulabs_dev_account_audit (account_id, actor_user_id, accion, antes, despues, motivo)
  values (p_account_id, p_actor_user_id, 'SET_ADDITIONAL_NUMBERS', jsonb_build_object('numeros_adicionales', v_actual), jsonb_build_object('numeros_adicionales', p_nuevo_total), p_motivo);

  return query select 'ok'::text, null::text;
end;
$$;

revoke all on function public.dulabs_dev_set_numeros_adicionales(uuid, integer, uuid, text) from public;
grant execute on function public.dulabs_dev_set_numeros_adicionales(uuid, integer, uuid, text) to service_role;

-- ============================================================
-- 5. SET ESTADO -- atómico (lo usará Fase 12 al integrar pagos)
-- ============================================================
create or replace function public.dulabs_dev_set_estado(
  p_account_id uuid,
  p_estado text,
  p_actor_user_id uuid,
  p_motivo text
)
returns table (resultado text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual text;
begin
  if p_estado not in ('active', 'past_due', 'canceled') then
    return query select 'estado_invalido'::text; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('acct:plan:' || p_account_id::text, 0));
  select a.estado into v_actual from public.dulabs_dev_accounts a where a.id = p_account_id;
  if v_actual is null then
    return query select 'cuenta_no_encontrada'::text; return;
  end if;
  update public.dulabs_dev_accounts set estado = p_estado, updated_at = now() where id = p_account_id;
  insert into public.dulabs_dev_account_audit (account_id, actor_user_id, accion, antes, despues, motivo)
  values (p_account_id, p_actor_user_id, 'SET_ESTADO', jsonb_build_object('estado', v_actual), jsonb_build_object('estado', p_estado), p_motivo);
  return query select 'ok'::text;
end;
$$;

revoke all on function public.dulabs_dev_set_estado(uuid, text, uuid, text) from public;
grant execute on function public.dulabs_dev_set_estado(uuid, text, uuid, text) to service_role;
