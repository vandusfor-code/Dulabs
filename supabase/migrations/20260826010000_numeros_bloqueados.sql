-- Lista negra de números a los que la IA NUNCA debe responder, sin importar
-- nada más (a diferencia de ia_restringida_a, que es una lista blanca para
-- pruebas). Mismo formato: dígitos separados por coma, con indicativo de país.
alter table public.dulabs_clientes_config
  add column if not exists ia_numeros_bloqueados text;
