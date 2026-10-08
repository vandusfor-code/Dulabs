-- CMS COMERCIAL (Bloque 29) — REVERSA de 04_migrar_textos_a_borradores.sql para Delacour.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico).
--
-- QUÉ HACE: ARCHIVA los borradores que creó la migración y que NADIE ha tocado (siguen en su primera revisión, sin publicar y sin usuario). El prompt de ARIA no se
--   modificó nunca, así que no hay nada más que deshacer. Archivar no borra: el historial queda y, desde «Administración de tienda», se puede desarchivar.
-- NO TOCA: lo que la administradora ya editó, publicó o pausó (se deja tal cual y se avisa), ni nada de otros negocios.
-- Se puede repetir sin efectos nuevos.

do $$
declare
  v_tenant uuid;
  v_e record;
  v_m record;
  v_r jsonb;
  v_archivados integer := 0;
  v_respetados text := '';
begin
  if to_regclass('public.dulabs_cms_entidades') is null then
    raise exception 'Delacour: el CMS comercial no está instalado; no hay nada que revertir';
  end if;
  select id_tenant into v_tenant from public.dulabs_catalogo_publicacion where slug = 'delacour';
  if v_tenant is null then
    raise exception 'Delacour: no existe una publicación con slug «delacour»';
  end if;

  for v_m in
    select * from (values
      ('Quiénes somos', 'quienes-somos'),
      ('Ubicación', 'ubicacion'),
      ('Horario', 'horario'),
      ('Líneas y materiales', 'lineas-y-materiales'),
      ('Dorado y plateado', 'dorado-y-plateado'),
      ('Colección Vida Eterna', 'coleccion-vida-eterna'),
      ('Servicios', 'servicios'),
      ('Catálogo', 'catalogo'),
      ('Precios y disponibilidad', 'precios-y-disponibilidad'),
      ('Regalos', 'regalos'),
      ('Hombre y mujer', 'hombre-y-mujer'),
      ('Venta al detal', 'venta-al-detal'),
      ('Venta al por mayor', 'venta-al-por-mayor'),
      ('Emprendimiento', 'emprendimiento'),
      ('Separar mercancía', 'separar-mercancia'),
      ('Envíos', 'envios'),
      ('Medios de pago', 'medios-de-pago'),
      ('Pago no identificado', 'pago-no-identificado'),
      ('Garantías', 'garantias'),
      ('Cambios y devoluciones', 'cambios-y-devoluciones'),
      ('Promociones', 'promociones'),
      ('Reclamos', 'reclamos')
    ) as m(legado, clave)
  loop
    select * into v_e from public.dulabs_cms_entidades where id_tenant = v_tenant and tipo = 'contenido' and clave = v_m.clave;
    if v_e.id is null or v_e.archivada_at is not null then continue; end if;
    if v_e.estado = 'borrador' and v_e.rev = 1 and v_e.created_by is null then
      v_r := public.dulabs_cms_archivar(v_tenant, v_e.id, null, 'Reversa de la migración del conocimiento de ARIA (DuLabs)');
      if v_r->>'resultado' is distinct from 'ok' then
        raise exception 'Delacour: no se pudo archivar «%» (%)', v_m.clave, v_r->>'resultado';
      end if;
      v_archivados := v_archivados + 1;
    else
      v_respetados := v_respetados || ' · ' || v_m.clave;
    end if;
  end loop;

  raise notice 'Delacour: % borradores archivados', v_archivados;
  if v_respetados <> '' then raise notice 'Delacour: no se tocan (ya los editó, publicó o pausó la administradora):%', v_respetados; end if;
end $$;
