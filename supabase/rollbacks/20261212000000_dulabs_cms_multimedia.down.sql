-- ROLLBACK de 20261212000000_dulabs_cms_multimedia.sql (las fotos y videos del inicio de la tienda como tipo del CMS comercial, y los videos MP4 como archivos del CMS).
--
-- Vuelve las restricciones de dulabs_cms_entidades, dulabs_cms_auditoria y dulabs_cms_assets a como quedaron con 20261211000000_dulabs_cms_pie_y_paginas.sql (sin el tipo 'multimedia' y sin
-- el formato 'video/mp4'). NO toca ninguna otra tabla ni función, ni los demás tipos del CMS.
--
-- Se NIEGA a correr si ya existen fotos y videos, algún registro de su historial o algún video guardado: las versiones y la auditoría son de solo añadir (triggers de inmutabilidad), así que esas
-- filas no se pueden quitar y sin los valores nuevos las restricciones anteriores no se podrían crear. Si ya se usaron, esta migración se queda: no estorba a nadie. Si solo quieres que la tienda
-- vuelva a sus videos de siempre, despublica «Fotos y videos» desde «Administrar tienda» (no hace falta ningún SQL).
-- No es una migración (vive fuera de supabase/migrations a propósito). Se ejecuta a mano, en una transacción.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_elementos integer := 0;
  v_historial integer := 0;
  v_videos integer := 0;
begin
  if to_regclass('public.dulabs_cms_entidades') is not null then
    select count(*) into v_elementos from public.dulabs_cms_entidades where tipo = 'multimedia';
  end if;
  if to_regclass('public.dulabs_cms_auditoria') is not null then
    select count(*) into v_historial from public.dulabs_cms_auditoria where entidad_tipo = 'multimedia';
  end if;
  if to_regclass('public.dulabs_cms_assets') is not null then
    select count(*) into v_videos from public.dulabs_cms_assets where mime_type = 'video/mp4';
  end if;
  if v_elementos > 0 or v_historial > 0 or v_videos > 0 then
    raise exception 'ya existen fotos y videos o videos guardados (% elementos, % registros de historial, % videos): las versiones y la auditoría no se pueden borrar, así que no se puede volver atrás. Despublica desde el panel lo que no quieras que se vea en la tienda.', v_elementos, v_historial, v_videos;
  end if;
end $$;

do $$
begin
  if to_regclass('public.dulabs_cms_entidades') is not null then
    alter table public.dulabs_cms_entidades drop constraint if exists dulabs_cms_entidades_multimedia_ck;
    alter table public.dulabs_cms_entidades drop constraint if exists dulabs_cms_entidades_tipo_ck;
    alter table public.dulabs_cms_entidades
      add constraint dulabs_cms_entidades_tipo_ck check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie', 'pagina'));
  end if;
  if to_regclass('public.dulabs_cms_auditoria') is not null then
    alter table public.dulabs_cms_auditoria drop constraint if exists dulabs_cms_auditoria_tipo_ck;
    alter table public.dulabs_cms_auditoria
      add constraint dulabs_cms_auditoria_tipo_ck check (entidad_tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie', 'pagina', 'imagen'));
  end if;
  if to_regclass('public.dulabs_cms_assets') is not null then
    alter table public.dulabs_cms_assets drop constraint if exists dulabs_cms_assets_mime_ck;
    alter table public.dulabs_cms_assets
      add constraint dulabs_cms_assets_mime_ck check (mime_type in ('image/webp', 'image/jpeg', 'image/png'));
  end if;
end $$;

commit;
