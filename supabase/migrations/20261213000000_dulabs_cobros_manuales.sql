-- DuLabs — COBROS MANUALES: recordatorio de pago por WhatsApp y suspensión del bot por falta de pago.
--
-- Qué resuelve: los clientes que pagan fuera de Wompi (transferencia, efectivo) no dejaban ningún registro: el sistema no sabía quién pagó ni hacía nada el día de pago. Con esto:
--   1. Cada suscripción manual guarda a QUIÉN se le avisa (telefono_cobro), cómo se le nombra (nombre_cobro) y su día de cobro (dia_cobro: AMORE paga siempre el 30).
--   2. El cron diario (/api/cron/cobros-manuales) marca la suscripción como «suspendida por pago» (suspendida_por_pago_at) el día de pago si no se registró el pago, y manda la plantilla
--      `pendiente_pago` desde el número de Dulabs. El bot deja de responder mientras esa marca exista (webhook de Meta y pipeline de WhatsApp-QR); NO se pausa ningún número ni se toca
--      ia_pausada, flow_activo ni ninguna otra configuración del cliente.
--   3. dulabs_cobros_ciclos guarda UNA fila por ciclo de cobro (tenant + fecha): garantiza que el recordatorio se manda una sola vez por ciclo, deja la huella de cada intento y guarda el
--      pago manual cuando se registra.
--   4. dulabs_cobro_registrar_pago() registra el pago (en dulabs_pagos, como cualquier otro), mueve la fecha de cobro al mes siguiente respetando el día (el 30 de febrero es 28/29) y
--      levanta la suspensión, todo en UNA transacción.
--
-- ADITIVA: columnas nuevas que aceptan nulo, una tabla nueva y una función. No cambia ni borra ninguna fila existente: nadie recibe nada ni se suspende hasta que una suscripción tenga
-- fecha de cobro vencida Y teléfono de cobro Y el cron esté en modo «activo» (COBROS_MANUALES_MODO). Sin esta migración la aplicación sigue igual (todo lo nuevo falla ABIERTO).
-- SEGURIDAD: la tabla nueva y la función son solo del backend (service_role); las columnas nuevas las puede leer el dueño de su propia suscripción, igual que el resto de la fila.
-- RECUPERACIÓN: supabase/rollbacks/20261213000000_dulabs_cobros_manuales.down.sql (se niega a correr si ya hay ciclos registrados o suscripciones con datos de cobro).
-- Idempotente: se puede ejecutar más de una vez. Se aplica a mano en el SQL Editor de Supabase.

begin;

do $$
begin
  if to_regclass('public.dulabs_suscripciones') is null or to_regclass('public.dulabs_pagos') is null then
    raise exception 'faltan las tablas dulabs_suscripciones / dulabs_pagos (migración 20260714120000_suscripciones_wompi.sql)';
  end if;
end;
$$;

-- ============================================================
-- 1. DATOS DE COBRO EN LA SUSCRIPCIÓN
-- ============================================================
alter table public.dulabs_suscripciones
  add column if not exists telefono_cobro text,
  add column if not exists nombre_cobro text,
  add column if not exists dia_cobro smallint,
  add column if not exists suspendida_por_pago_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dulabs_suscripciones_dia_cobro_ck') then
    alter table public.dulabs_suscripciones
      add constraint dulabs_suscripciones_dia_cobro_ck check (dia_cobro is null or dia_cobro between 1 and 31);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dulabs_suscripciones_telefono_cobro_ck') then
    alter table public.dulabs_suscripciones
      add constraint dulabs_suscripciones_telefono_cobro_ck check (telefono_cobro is null or telefono_cobro ~ '^[0-9]{10,15}$');
  end if;
end;
$$;

comment on column public.dulabs_suscripciones.telefono_cobro is
  'WhatsApp (solo dígitos, con indicativo: 573001234567) de la PERSONA que paga, al que se le manda el recordatorio de pago. NUNCA el número del bot del cliente (ahí lo leería su propio bot).';
comment on column public.dulabs_suscripciones.nombre_cobro is
  'Cómo se saluda al cliente en el recordatorio de pago («Hola, AMORE»). Si es nulo se usa el nombre del negocio.';
comment on column public.dulabs_suscripciones.dia_cobro is
  'Día del mes en que vence el cobro (1-31). Al registrar un pago, la nueva fecha cae en ese día; en un mes más corto cae en su último día. Nulo = el día de la fecha de cobro actual.';
comment on column public.dulabs_suscripciones.suspendida_por_pago_at is
  'Momento en que el cron marcó el cobro como vencido sin pago: mientras no sea nulo el bot NO responde (webhook de Meta y WhatsApp-QR). Lo limpia dulabs_cobro_registrar_pago() o el botón «Levantar suspensión» del Panel de Operaciones.';

-- ============================================================
-- 2. UNA FILA POR CICLO DE COBRO
-- ============================================================
create table if not exists public.dulabs_cobros_ciclos (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  -- Fecha de cobro (vencimiento) del ciclo: la fecha_proximo_cobro que tenía la suscripción cuando venció.
  fecha_cobro date not null,
  monto_cop integer not null check (monto_cop >= 0),
  -- Destino del recordatorio tal como estaba al detectar el vencimiento.
  telefono text,
  estado text not null default 'pendiente',
  intentos smallint not null default 0,
  suspendido_at timestamptz,
  recordatorio_wamid text,
  recordatorio_enviado_at timestamptz,
  ultimo_error text,
  pago_id bigint references public.dulabs_pagos (id) on delete set null,
  pagado_at timestamptz,
  registrado_por text,
  nota text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Idempotencia: un solo ciclo por tenant y fecha, aunque el cron corra dos veces.
  constraint dulabs_cobros_ciclos_unico unique (id_tenant, fecha_cobro),
  constraint dulabs_cobros_ciclos_estado_ck check (estado in ('pendiente', 'enviado', 'fallido', 'pagado', 'omitido'))
);

create index if not exists dulabs_cobros_ciclos_estado_idx on public.dulabs_cobros_ciclos (estado, fecha_cobro);

alter table public.dulabs_cobros_ciclos enable row level security;
revoke all on table public.dulabs_cobros_ciclos from anon, authenticated;

comment on table public.dulabs_cobros_ciclos is
  'Un ciclo de cobro de una suscripción manual: recordatorio por WhatsApp (pendiente/enviado/fallido) o pago registrado (pagado). Solo service_role.';
comment on column public.dulabs_cobros_ciclos.estado is
  'pendiente (detectado, aviso sin enviar todavía) | enviado (recordatorio entregado a Meta) | fallido (el envío falló; el cron lo reintenta hasta el tope) | pagado (se registró el pago) | omitido (no se tocará más).';

-- ============================================================
-- 3. REGISTRAR UN PAGO MANUAL (atómico)
-- ============================================================
-- p_fecha_cobro es la fecha de cobro que el operador VE en pantalla: si la suscripción ya avanzó a otro ciclo (doble clic, otro operador), se rechaza en vez de pagar dos veces.
create or replace function public.dulabs_cobro_registrar_pago(
  p_tenant uuid,
  p_fecha_cobro date,
  p_monto_cop integer default null,
  p_operador text default null,
  p_nota text default null
)
returns table (fecha_pagada date, proximo_cobro date, monto_registrado integer, pago_id_registrado bigint, estaba_suspendida boolean)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sub public.dulabs_suscripciones;
  v_monto integer;
  v_tx text;
  v_pago_id bigint;
  v_dia integer;
  v_mes_siguiente date;
  v_ultimo_dia integer;
  v_proximo date;
begin
  select * into v_sub from public.dulabs_suscripciones s where s.id_tenant = p_tenant for update;
  if not found then
    raise exception 'cobro_sin_suscripcion' using errcode = 'P0001';
  end if;
  if v_sub.estado <> 'activa' then
    raise exception 'cobro_suscripcion_no_activa' using errcode = 'P0001';
  end if;
  if v_sub.cortesia then
    raise exception 'cobro_es_cortesia' using errcode = 'P0001';
  end if;
  if v_sub.wompi_payment_source_id is not null then
    raise exception 'cobro_no_es_manual' using errcode = 'P0001';
  end if;
  if p_fecha_cobro is distinct from v_sub.fecha_proximo_cobro then
    raise exception 'cobro_ciclo_desactualizado' using errcode = 'P0001';
  end if;

  v_monto := coalesce(p_monto_cop, v_sub.precio_cop);
  if v_monto is null or v_monto <= 0 then
    raise exception 'cobro_monto_invalido' using errcode = 'P0001';
  end if;

  -- Un pago manual por ciclo: el identificador es único por tenant y fecha de cobro.
  v_tx := 'manual-' || p_tenant::text || '-' || to_char(v_sub.fecha_proximo_cobro, 'YYYY-MM-DD');
  insert into public.dulabs_pagos (id_tenant, wompi_transaction_id, monto_cop, estado, tipo, plan)
    values (p_tenant, v_tx, v_monto, 'APPROVED', 'suscripcion', v_sub.plan)
  on conflict (wompi_transaction_id) do nothing
  returning id into v_pago_id;
  if v_pago_id is null then
    raise exception 'cobro_ciclo_ya_pagado' using errcode = 'P0001';
  end if;

  -- Siguiente fecha: el mismo día del mes siguiente (o el último día de ese mes si es más corto), contado desde la fecha de cobro, NO desde hoy.
  v_dia := coalesce(v_sub.dia_cobro, extract(day from v_sub.fecha_proximo_cobro)::integer);
  v_mes_siguiente := (date_trunc('month', v_sub.fecha_proximo_cobro) + interval '1 month')::date;
  v_ultimo_dia := extract(day from (v_mes_siguiente + interval '1 month' - interval '1 day'))::integer;
  v_proximo := v_mes_siguiente + (least(v_dia, v_ultimo_dia) - 1);

  update public.dulabs_suscripciones s
     set fecha_proximo_cobro = v_proximo, suspendida_por_pago_at = null, updated_at = now()
   where s.id_tenant = p_tenant;

  insert into public.dulabs_cobros_ciclos (id_tenant, fecha_cobro, monto_cop, estado, pago_id, pagado_at, registrado_por, nota)
    values (p_tenant, v_sub.fecha_proximo_cobro, v_monto, 'pagado', v_pago_id, now(), p_operador, p_nota)
  on conflict (id_tenant, fecha_cobro) do update
    set estado = 'pagado', monto_cop = excluded.monto_cop, pago_id = excluded.pago_id, pagado_at = excluded.pagado_at,
        registrado_por = excluded.registrado_por, nota = excluded.nota, updated_at = now();

  fecha_pagada := v_sub.fecha_proximo_cobro;
  proximo_cobro := v_proximo;
  monto_registrado := v_monto;
  pago_id_registrado := v_pago_id;
  estaba_suspendida := v_sub.suspendida_por_pago_at is not null;
  return next;
end;
$$;

revoke all on function public.dulabs_cobro_registrar_pago(uuid, date, integer, text, text) from public, anon, authenticated;
grant execute on function public.dulabs_cobro_registrar_pago(uuid, date, integer, text, text) to service_role;

commit;
