-- DuLabs — CMS comercial: el PIE DE PÁGINA y las PÁGINAS de la tienda (política de privacidad, términos…) como tipos del CMS, con el mismo ciclo que todo lo demás:
--   BORRADOR → VALIDACIÓN → PUBLICAR → VERSIÓN ACTIVA (+ historial, restauración y auditoría).
--
-- NO crea tablas ni funciones: amplía DOS restricciones de las tablas que ya existen (20261210000000_dulabs_cms_comercial.sql):
--   1. dulabs_cms_entidades.tipo admite 'pie' (UNO por negocio, su código es siempre 'pie') y 'pagina' (varias por negocio; su código es la parte final de la dirección:
--      /catalogo/{tienda}/p/politica-de-privacidad).
--   2. dulabs_cms_auditoria.entidad_tipo admite 'pie' y 'pagina' (el historial de cambios).
-- Las funciones del CMS (crear, guardar borrador, publicar, restaurar, pausar…, lectura activa) no distinguen tipos: no cambian.
--
-- Sin esta migración la aplicación sigue igual: la tienda dibuja su pie de siempre y, en el panel, crear el pie o una página avisa que todavía no está disponible.
-- Con ella, la administradora crea su pie y sus páginas en «Administrar tienda» y NADA cambia para los clientes hasta que lo publique.
--
-- SEGURIDAD: no toca RLS, permisos ni datos. Las filas que ya existen cumplen las restricciones nuevas (solo se agregan dos valores permitidos y una regla que ningún tipo actual usa).
-- RECUPERACIÓN: supabase/rollbacks/20261211000000_dulabs_cms_pie_y_paginas.down.sql (se niega a correr si ya existe un pie o una página: su historial es de solo añadir).
-- Idempotente: se puede ejecutar más de una vez. Se aplica a mano en el SQL Editor de Supabase, DESPUÉS de 20261210000000_dulabs_cms_comercial.sql.

begin;

do $$
begin
  if to_regclass('public.dulabs_cms_entidades') is null or to_regclass('public.dulabs_cms_auditoria') is null then
    raise exception 'falta aplicar antes 20261210000000_dulabs_cms_comercial.sql (las tablas del CMS comercial no existen)';
  end if;
end;
$$;

-- 1. Un elemento del CMS puede ser el pie de página (uno por negocio) o una página (varias).
alter table public.dulabs_cms_entidades drop constraint if exists dulabs_cms_entidades_tipo_ck;
alter table public.dulabs_cms_entidades
  add constraint dulabs_cms_entidades_tipo_ck check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie', 'pagina'));

alter table public.dulabs_cms_entidades drop constraint if exists dulabs_cms_entidades_pie_ck;
alter table public.dulabs_cms_entidades
  add constraint dulabs_cms_entidades_pie_ck check (tipo <> 'pie' or clave = 'pie');

-- 2. El historial reconoce los dos tipos nuevos.
alter table public.dulabs_cms_auditoria drop constraint if exists dulabs_cms_auditoria_tipo_ck;
alter table public.dulabs_cms_auditoria
  add constraint dulabs_cms_auditoria_tipo_ck check (entidad_tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie', 'pagina', 'imagen'));

commit;
