-- Plan elegido en /business y conteo real de mensajes enviados por negocio,
-- reemplazando los valores de placeholder usados durante las pruebas.
alter table public.dulabs_clientes_config
  add column if not exists plan text,
  add column if not exists mensajes_usados_mes integer not null default 0,
  add column if not exists mes_actual text not null default to_char(now(), 'YYYY-MM');

comment on column public.dulabs_clientes_config.plan is
  'Plan elegido en /business al momento de conectar el número (Plan Básico / Plan Pro / Plan Enterprise). Null = elegido antes de que existiera esta columna.';
comment on column public.dulabs_clientes_config.mensajes_usados_mes is
  'Mensajes salientes enviados por la IA en mes_actual. Se reinicia a 1 cuando mes_actual cambia respecto al mes en curso.';
