-- ROLLBACK de 20261211000000_dulabs_cms_pie_y_paginas.sql (el pie de página y las páginas propias de la tienda como tipos del CMS comercial).
--
-- Vuelve las restricciones de dulabs_cms_entidades y dulabs_cms_auditoria a como quedaron con 20261210000000_dulabs_cms_comercial.sql (sin los tipos 'pie' ni 'pagina').
-- NO toca ninguna otra tabla ni función, ni los demás tipos del CMS.
--
-- Se NIEGA a correr si ya existe un pie o una página (o algún registro de su historial): las versiones y la auditoría son de solo añadir (triggers de inmutabilidad), así que esas filas no se pueden
-- quitar y sin los valores 'pie' y 'pagina' las restricciones anteriores no se podrían crear. Si ya se usaron, esta migración se queda: no estorba a nadie. Si solo quieres que la tienda vuelva a su pie
-- de siempre, despublica el pie desde «Administrar tienda»; y para quitar una página de la tienda, despublícala o pausala (no hace falta ningún SQL).
-- No es una migración (vive fuera de supabase/migrations a propósito). Se ejecuta a mano, en una transacción.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_elementos integer := 0;
  v_historial integer := 0;
begin
  if to_regclass('public.dulabs_cms_entidades') is not null then
    select count(*) into v_elementos from public.dulabs_cms_entidades where tipo in ('pie', 'pagina');
  end if;
  if to_regclass('public.dulabs_cms_auditoria') is not null then
    select count(*) into v_historial from public.dulabs_cms_auditoria where entidad_tipo in ('pie', 'pagina');
  end if;
  if v_elementos > 0 or v_historial > 0 then
    raise exception 'ya existe un pie de página o una página (% elementos, % registros de historial): las versiones y la auditoría no se pueden borrar, así que no se puede volver atrás. Despublica desde el panel lo que no quieras que se vea en la tienda.', v_elementos, v_historial;
  end if;
end $$;

do $$
begin
  if to_regclass('public.dulabs_cms_entidades') is not null then
    alter table public.dulabs_cms_entidades drop constraint if exists dulabs_cms_entidades_pie_ck;
    alter table public.dulabs_cms_entidades drop constraint if exists dulabs_cms_entidades_tipo_ck;
    alter table public.dulabs_cms_entidades
      add constraint dulabs_cms_entidades_tipo_ck check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido'));
  end if;
  if to_regclass('public.dulabs_cms_auditoria') is not null then
    alter table public.dulabs_cms_auditoria drop constraint if exists dulabs_cms_auditoria_tipo_ck;
    alter table public.dulabs_cms_auditoria
      add constraint dulabs_cms_auditoria_tipo_ck check (entidad_tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'imagen'));
  end if;
end $$;

commit;
