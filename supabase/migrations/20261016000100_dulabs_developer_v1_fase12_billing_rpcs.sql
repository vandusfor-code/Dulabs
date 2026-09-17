-- DuLabs Developer V1 -- Fase 12 (Billing, Wompi). RPCs atómicos de billing,
-- security definer, solo service_role. Aditivo. Espeja el patrón probado de
-- Business (dulabs_reservar_suscripcion) PERO en el dominio/tablas de Developer
-- (dulabs_dev_billing_*). No toca Business.

-- ============================================================
-- 1. RESERVA ATÓMICA DE CHECKOUT (anti doble-cobro / doble-checkout)
-- ============================================================
-- Invierte el orden: reservar primero, cobrar en Wompi después. Bajo un
-- advisory lock por cuenta: si ya hay un pago PENDING reciente para la cuenta
-- (checkout en curso, otro tab, reintento de red), devuelve 'checkout_en_curso'
-- y el caller DEBE abortar SIN llamar a Wompi. Si no, crea la fila de pago
-- PENDING (que ES el registro de checkout) y devuelve su id. El caller es
-- responsable de marcar la fila DECLINED/ERROR/VOIDED si el cobro falla, para
-- no dejar la cuenta bloqueada.
create or replace function public.dulabs_dev_billing_reservar_checkout(
  p_account_id uuid,
  p_reference text,
  p_tipo text,
  p_plan_codigo text,
  p_intervalo text,
  p_precio_usd_cents integer,
  p_monto_cop_cents integer,
  p_fx_rate numeric
)
returns table (resultado text, payment_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if p_tipo not in ('checkout', 'renewal', 'upgrade') then
    return query select 'tipo_invalido'::text, null::bigint; return;
  end if;
  if p_intervalo not in ('month', 'year') then
    return query select 'intervalo_invalido'::text, null::bigint; return;
  end if;
  if p_precio_usd_cents is null or p_precio_usd_cents < 0
     or p_monto_cop_cents is null or p_monto_cop_cents < 0
     or p_fx_rate is null or p_fx_rate <= 0 then
    return query select 'valor_invalido'::text, null::bigint; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('dev:billing:checkout:' || p_account_id::text, 0));

  if not exists (select 1 from public.dulabs_dev_accounts a where a.id = p_account_id) then
    return query select 'cuenta_no_encontrada'::text, null::bigint; return;
  end if;
  if not exists (select 1 from public.dulabs_dev_plans p where p.codigo = p_plan_codigo) then
    return query select 'plan_invalido'::text, null::bigint; return;
  end if;

  -- Anti doble-checkout: un pago PENDING reciente = checkout en curso.
  if exists (
    select 1 from public.dulabs_dev_billing_payments p
     where p.account_id = p_account_id
       and p.estado = 'PENDING'
       and p.created_at > now() - interval '30 minutes'
  ) then
    return query select 'checkout_en_curso'::text, null::bigint; return;
  end if;

  insert into public.dulabs_dev_billing_payments
    (account_id, reference, tipo, plan_codigo, intervalo, precio_usd_cents, monto_cop_cents, fx_rate, estado)
  values
    (p_account_id, p_reference, p_tipo, p_plan_codigo, p_intervalo, p_precio_usd_cents, p_monto_cop_cents, p_fx_rate, 'PENDING')
  returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$$;

revoke all on function public.dulabs_dev_billing_reservar_checkout(uuid, text, text, text, text, integer, integer, numeric) from public;
grant execute on function public.dulabs_dev_billing_reservar_checkout(uuid, text, text, text, text, integer, integer, numeric) to service_role;

comment on function public.dulabs_dev_billing_reservar_checkout is
  'DuLabs Developer V1 (Fase 12). Reserva atómica de checkout: crea el pago PENDING bajo advisory lock por cuenta y rechaza si ya hay un checkout en curso (devuelve resultado=checkout_en_curso). Cierra la ventana de doble cobro antes de tocar Wompi.';
