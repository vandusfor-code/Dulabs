-- Saldo de mensajes MASIVOS (campañas) de cortesía, por tenant. Totalmente
-- independiente de dulabs_clientes_config.mensajes_usados_mes/mes_actual
-- (ese es el cupo MENSUAL, con reinicio, de mensajes de IA conversacional
-- normal, ver lib/plan-limits.ts) -- este es un saldo TOTAL, sin reinicio
-- automático, exclusivo de envíos de campañas masivas (app/api/campanas/enviar).
--
-- Mismo patrón arquitectónico que dulabs_campanas_concurrencia +
-- dulabs_intentar_iniciar_campana/dulabs_finalizar_campana
-- (20260801090000_planes_agentes_campanas.sql): tabla simple por tenant +
-- función RPC atómica (UPDATE...WHERE...RETURNING en una sola sentencia) --
-- Postgres serializa los UPDATE sobre la misma fila, así que dos campañas
-- simultáneas del mismo tenant nunca pueden juntas superar el límite: la
-- segunda ve el saldo ya reducido por la primera.
--
-- Migración puramente aditiva: no modifica ninguna columna existente
-- (dulabs_campanas gana una columna nueva, ver más abajo).

create table if not exists public.dulabs_creditos_mensajes_masivos (
  id_tenant uuid primary key,
  limite integer not null default 0,
  usados integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dulabs_creditos_mensajes_masivos enable row level security;

drop policy if exists tenant_select on public.dulabs_creditos_mensajes_masivos;
create policy tenant_select on public.dulabs_creditos_mensajes_masivos
  for select to authenticated
  using (id_tenant = public.dulabs_tenant_del_usuario());

comment on table public.dulabs_creditos_mensajes_masivos is
  'Saldo de mensajes masivos de cortesía por tenant (limite/usados totales, SIN reinicio automático). Independiente del cupo mensual de IA conversacional. Solo el backend (service_role, vía RPC) lo escribe.';

-- Reserva (consume) atómicamente p_cantidad créditos si el saldo alcanza.
-- Devuelve false sin cambiar nada si no alcanza -- el caller debe rechazar
-- la campaña COMPLETA en ese caso, nunca enviar una parte.
create or replace function public.dulabs_consumir_creditos_masivos(p_tenant uuid, p_cantidad int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usados int;
begin
  update public.dulabs_creditos_mensajes_masivos
  set usados = usados + p_cantidad, updated_at = now()
  where id_tenant = p_tenant and (limite - usados) >= p_cantidad
  returning usados into v_usados;

  return v_usados is not null;
end;
$$;

revoke all on function public.dulabs_consumir_creditos_masivos(uuid, int) from public;
grant execute on function public.dulabs_consumir_creditos_masivos(uuid, int) to service_role;

comment on function public.dulabs_consumir_creditos_masivos(uuid, int) is
  'Reserva atómicamente p_cantidad créditos de mensajes masivos para el tenant si el saldo alcanza (limite - usados >= p_cantidad); devuelve false si no. Llamar ANTES de procesar la campaña (primer lote, con el total real de destinatarios) -- nunca enviar y descontar después.';

-- Devuelve créditos previamente reservados que terminaron NO usándose de
-- verdad (destinatarios que Meta rechazó) -- nunca deja `usados` negativo.
-- El saldo final siempre refleja únicamente envíos realmente aceptados.
create or replace function public.dulabs_reembolsar_creditos_masivos(p_tenant uuid, p_cantidad int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_cantidad <= 0 then
    return;
  end if;
  update public.dulabs_creditos_mensajes_masivos
  set usados = greatest(0, usados - p_cantidad), updated_at = now()
  where id_tenant = p_tenant;
end;
$$;

revoke all on function public.dulabs_reembolsar_creditos_masivos(uuid, int) from public;
grant execute on function public.dulabs_reembolsar_creditos_masivos(uuid, int) to service_role;

comment on function public.dulabs_reembolsar_creditos_masivos(uuid, int) is
  'Devuelve p_cantidad créditos previamente reservados con dulabs_consumir_creditos_masivos que no llegaron a usarse de verdad (destinatarios fallidos). Nunca deja usados negativo.';

-- Auditoría: cuántos de los destinatarios de esta campaña realmente
-- consumieron un crédito (envío aceptado por Meta) -- junto con
-- destinatarios_total y created_at (ya existentes), permite reconstruir
-- después cómo se gastó el saldo campaña por campaña.
alter table public.dulabs_campanas
  add column if not exists mensajes_masivos_consumidos integer not null default 0;

comment on column public.dulabs_campanas.mensajes_masivos_consumidos is
  'Cuántos destinatarios de esta campaña realmente consumieron un crédito de dulabs_creditos_mensajes_masivos (envíos aceptados por Meta) -- puede ser menor que destinatarios_total si hubo fallos.';
