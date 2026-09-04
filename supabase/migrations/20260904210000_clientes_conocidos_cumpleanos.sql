-- AMORE (Fase 3 del portal de reservas, autorizado) — prepara el dato de
-- cumpleaños (SOLO día y mes, nunca año) sobre dulabs_clientes_conocidos ya
-- existente. Aditivo: nadie que no mande estos dos campos ve cambiar su
-- fila (recordarNombreCliente, lib/clientes-conocidos.ts, solo los incluye
-- en el upsert si ambos vienen). NO implementa cumpleaños/automatizaciones
-- todavía -- eso es una fase futura explícita.

alter table public.dulabs_clientes_conocidos
  add column if not exists cumple_dia smallint,
  add column if not exists cumple_mes smallint;

alter table public.dulabs_clientes_conocidos
  add constraint dulabs_clientes_conocidos_cumple_dia_valido check (cumple_dia is null or cumple_dia between 1 and 31);

alter table public.dulabs_clientes_conocidos
  add constraint dulabs_clientes_conocidos_cumple_mes_valido check (cumple_mes is null or cumple_mes between 1 and 12);

comment on column public.dulabs_clientes_conocidos.cumple_dia is
  'Día de nacimiento (1-31), sin año. Preparado para una fase futura de cumpleaños/fidelización -- todavía no se usa para nada automático.';
comment on column public.dulabs_clientes_conocidos.cumple_mes is
  'Mes de nacimiento (1-12), sin año. Ver cumple_dia.';
