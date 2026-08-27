alter table dulabs_mensajes_log
  add column if not exists error_codigo integer,
  add column if not exists error_detalle text;
