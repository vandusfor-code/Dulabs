-- DuLabs — CMS comercial: las FOTOS Y VIDEOS del inicio de la tienda (los videos de la portada, la colección, la marca y los mayoristas, y la imagen de presentación de cada categoría)
-- como un tipo del CMS («multimedia»), con el mismo ciclo que todo lo demás: BORRADOR → VALIDACIÓN → PUBLICAR → VERSIÓN ACTIVA (+ historial, restauración y auditoría).
--
-- NO crea tablas ni funciones: amplía CUATRO restricciones de las tablas que ya existen (20261210000000_dulabs_cms_comercial.sql y 20261211000000_dulabs_cms_pie_y_paginas.sql):
--   1. dulabs_cms_entidades.tipo admite 'multimedia' (UNO por negocio; su código es siempre 'multimedia').
--   2. dulabs_cms_entidades_multimedia_ck: el único código de ese tipo es 'multimedia' (así no puede haber dos por negocio).
--   3. dulabs_cms_auditoria.entidad_tipo admite 'multimedia' (el historial de cambios).
--   4. dulabs_cms_assets.mime_type admite 'video/mp4' (hasta hoy el CMS solo guardaba imágenes). El peso máximo de un archivo (10 MB) no cambia: la aplicación acepta videos de hasta 3 MB.
-- Las funciones del CMS (crear, guardar borrador, publicar, restaurar, pausar…, lectura activa, assets) no distinguen tipos ni formatos: no cambian.
--
-- Sin esta migración la aplicación sigue igual: la tienda muestra los videos y las fotos de siempre y, en el panel, crear «Fotos y videos» o subir un video avisa que todavía no está disponible.
-- Con ella, la administradora cambia los videos y las imágenes de categoría en «Administrar tienda» y NADA cambia para los clientes hasta que lo publique.
--
-- SEGURIDAD: no toca RLS, permisos ni datos. Las filas que ya existen cumplen las restricciones nuevas (solo se agregan valores permitidos y una regla que ningún tipo actual usa).
-- RECUPERACIÓN: supabase/rollbacks/20261212000000_dulabs_cms_multimedia.down.sql (se niega a correr si ya existen fotos y videos, su historial o algún video guardado: son de solo añadir).
-- Idempotente: se puede ejecutar más de una vez. Se aplica a mano en el SQL Editor de Supabase, DESPUÉS de 20261211000000_dulabs_cms_pie_y_paginas.sql.
-- ORDEN: 20261210 → 20261211 → 20261212. Si por error se vuelve a ejecutar 20261211 después de esta, esa deja la restricción de tipos sin 'multimedia' (y con fotos y videos ya creados se niega,
-- sin cambiar nada): vuelve a ejecutar esta y queda todo como estaba. Para revertir, primero esta (su rollback) y después, si hiciera falta, la del pie.

begin;

do $$
begin
  if to_regclass('public.dulabs_cms_entidades') is null or to_regclass('public.dulabs_cms_auditoria') is null or to_regclass('public.dulabs_cms_assets') is null then
    raise exception 'falta aplicar antes 20261210000000_dulabs_cms_comercial.sql (las tablas del CMS comercial no existen)';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dulabs_cms_entidades_tipo_ck' and pg_get_constraintdef(oid) like '%''pagina''%') then
    raise exception 'falta aplicar antes 20261211000000_dulabs_cms_pie_y_paginas.sql (el CMS todavía no admite el pie ni las páginas)';
  end if;
end;
$$;

-- 1. Un elemento del CMS puede ser las fotos y videos del inicio (uno por negocio).
alter table public.dulabs_cms_entidades drop constraint if exists dulabs_cms_entidades_tipo_ck;
alter table public.dulabs_cms_entidades
  add constraint dulabs_cms_entidades_tipo_ck check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie', 'pagina', 'multimedia'));

-- 2. Su código es siempre 'multimedia'.
alter table public.dulabs_cms_entidades drop constraint if exists dulabs_cms_entidades_multimedia_ck;
alter table public.dulabs_cms_entidades
  add constraint dulabs_cms_entidades_multimedia_ck check (tipo <> 'multimedia' or clave = 'multimedia');

-- 3. El historial reconoce el tipo nuevo.
alter table public.dulabs_cms_auditoria drop constraint if exists dulabs_cms_auditoria_tipo_ck;
alter table public.dulabs_cms_auditoria
  add constraint dulabs_cms_auditoria_tipo_ck check (entidad_tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie', 'pagina', 'multimedia', 'imagen'));

-- 4. Los archivos del CMS pueden ser videos MP4 (además de imágenes).
alter table public.dulabs_cms_assets drop constraint if exists dulabs_cms_assets_mime_ck;
alter table public.dulabs_cms_assets
  add constraint dulabs_cms_assets_mime_ck check (mime_type in ('image/webp', 'image/jpeg', 'image/png', 'video/mp4'));

commit;
