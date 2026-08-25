-- Acorta el token por defecto de las nuevas especialistas: 36 caracteres
-- hex era pensado para pegar en la URL a secas, pero ahora el link real es
-- "nombre-del-spa-{token}" (ver lib/especialistas.ts construirRutaAgenda) --
-- el nombre ya hace que el link se vea bien, así que el token puede ser
-- corto. 8 caracteres hex (4 bytes) alcanza de sobra para una agenda de un
-- solo negocio, sin ser una cadena larga y fea al final del link.

alter table public.dulabs_especialistas
  alter column token set default encode(gen_random_bytes(4), 'hex');
