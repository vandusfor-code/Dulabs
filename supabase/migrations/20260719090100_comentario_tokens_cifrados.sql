-- Documenta que meta_permanent_token y api_key_ia ahora se guardan cifrados
-- a nivel de aplicación (ver lib/crypto.ts, AES-256-GCM con
-- TOKEN_ENCRYPTION_KEY). No cambia el tipo de columna — el texto cifrado
-- sigue siendo "text", solo con el formato "v1:<iv>:<authTag>:<ciphertext>"
-- en vez del valor plano. Los valores existentes se migran aparte con
-- scripts/cifrar-tokens-existentes.mjs (no vía esta migración, porque el
-- backfill necesita la clave de cifrado, que no vive en Postgres).

comment on column public.dulabs_clientes_config.meta_permanent_token is
  'Token de Meta cifrado a nivel de app (AES-256-GCM, ver lib/crypto.ts). Formato "v1:iv:authTag:ciphertext"; valores legacy en texto plano se toleran en lectura hasta que corra el backfill.';

comment on column public.dulabs_clientes_config.api_key_ia is
  'API key de Anthropic (BYOK) cifrada a nivel de app, mismo esquema que meta_permanent_token.';
