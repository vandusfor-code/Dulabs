-- Corrige el default de dulabs_especialistas.token: 'base64url' no es una
-- codificación reconocida por encode() en esta versión de Postgres (fallaba
-- con "unrecognized encoding" en cualquier insert sin token explícito).
-- 'hex' es igual de seguro para un token de URL y no necesita caracteres
-- especiales (+ / =) que haya que escapar.

alter table public.dulabs_especialistas
  alter column token set default encode(gen_random_bytes(18), 'hex');
