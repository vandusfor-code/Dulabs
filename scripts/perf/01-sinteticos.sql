-- Rendimiento (Bloque 20) — datos SINTÉTICOS deterministas (ningún dato real de Delacour).
--
-- ⚠️  SOLO en una BD LOCAL EFÍMERA con las migraciones del catálogo aplicadas (ver README.md).
-- Uso: psql -v n_negocio=2000 -v n_ruido=20000 -f scripts/perf/01-sinteticos.sql
--   Negocio P (el medido): n_negocio productos, 12 categorías, nombres/colores/materiales/
--   descripciones con la estructura real de una joyería, stock variable (incluye agotados y
--   sin control de inventario), ~8 % inactivos, precio detal y mayorista, foto principal
--   simulada (ruta de Storage ficticia) en ~90 %.
--   Negocio R (ruido): n_ruido productos de OTRO negocio en la misma tabla (multi-tenant).
--   Negocio Q (opcional, n_segundo, por defecto 0): OTRO negocio CON Catálogo publicado
--   (slug joyeria-sintetica-dos), mismas referencias DL-… que P y nombres con sufijo « Q» para
--   detectar cualquier fuga entre negocios en las pruebas concurrentes.
--   Para agregarlo a una BD ya sembrada: -v n_negocio=0 -v n_ruido=0 -v n_segundo=2000.
-- Repetible: mismo resultado en cada corrida (setseed).

\set ON_ERROR_STOP 1
\if :{?n_negocio} \else \set n_negocio 2000 \endif
\if :{?n_ruido} \else \set n_ruido 20000 \endif
\if :{?n_segundo} \else \set n_segundo 0 \endif

select setseed(0.2026);

create or replace function pg_temp.sembrar(p_tenant uuid, p_n integer, p_con_media boolean) returns void language plpgsql as $$
declare
  tipos text[] := array['Anillo','Aretes','Collar','Pulsera','Dije','Cadena','Tobillera','Broche','Topos','Argollas','Set','Piercing'];
  cats text[] := array['Anillos','Aretes','Collares','Pulseras','Dijes','Cadenas','Tobilleras','Broches','Topos','Argollas','Sets','Piercings'];
  estilos text[] := array['Luna','Sol','Corazón','Estrella','Infinito','Trébol','Mariposa','Gota','Flor','Serpiente','Perla','Nudo','Solitario','Eternidad','Riviera','Lágrima','Ancla','Pluma','Hoja','Ola','Cruz','Ojo turco','Colibrí','Libélula','Nube','Rayo','Espiral','Aro','Cubana','Veneciana'];
  materiales text[] := array['Oro 18k','Oro laminado','Plata 925','Acero quirúrgico','Rodio','Oro rosa','Baño de oro'];
  colores text[] := array['dorado','plateado','rosa','negro','blanco','verde esmeralda','azul zafiro','rojo rubí','champaña'];
  piedras text[] := array['circón','perla de río','cuarzo','esmeralda sintética','zafiro sintético','sin piedra'];
  v_cat uuid[];
  i integer;
  t integer;
  v_id uuid;
begin
  for t in 1..array_length(cats, 1) loop
    insert into public.dulabs_catalogo_categorias (id_tenant, nombre) values (p_tenant, cats[t]) on conflict do nothing;
  end loop;
  select array_agg(id order by nombre) into v_cat from public.dulabs_catalogo_categorias where id_tenant = p_tenant;
  for i in 1..p_n loop
    t := 1 + floor(random() * array_length(tipos, 1))::int;
    insert into public.dulabs_inventario_productos
      (id_tenant, nombre, descripcion, precio, precio_mayor, stock, controla_stock, activo, categoria, categoria_id, material, color)
    values (
      p_tenant,
      tipos[t] || ' ' || estilos[1 + floor(random() * array_length(estilos, 1))::int],
      'Pieza ' || lower(tipos[t]) || ' con ' || piedras[1 + floor(random() * array_length(piedras, 1))::int]
        || ', acabado pulido y cierre de seguridad. Ideal para regalo. Garantía de 6 meses.',
      (39900 + floor(random() * 90) * 5000)::bigint,
      case when random() < 0.85 then (19900 + floor(random() * 50) * 3000)::bigint end,
      case when random() < 0.07 then 0 else floor(random() * 25)::int end,
      random() > 0.05,
      random() > 0.08,
      cats[t],
      (select c.id from public.dulabs_catalogo_categorias c where c.id_tenant = p_tenant and c.nombre = cats[t]),
      materiales[1 + floor(random() * array_length(materiales, 1))::int],
      colores[1 + floor(random() * array_length(colores, 1))::int]
    ) returning id into v_id;
    if p_con_media and random() < 0.9 then
      insert into public.dulabs_catalogo_media (id_tenant, producto_id, storage_path, thumb_path, es_principal, mime_type, bytes, ancho, alto)
      values (p_tenant, v_id, p_tenant || '/' || v_id || '/principal.webp', p_tenant || '/' || v_id || '/principal.thumb.webp', true, 'image/webp', 120000, 1200, 1200);
    end if;
  end loop;
end $$;

-- Negocio P (medido) y su publicación / módulo / número.
insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'catalogo', true) on conflict do nothing;
insert into public.dulabs_catalogo_publicacion (id_tenant, slug, nombre_publico, publicado) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'joyeria-sintetica', 'Joyería Sintética', true) on conflict do nothing;
insert into public.dulabs_clientes_config (id_tenant, nombre_negocio, phone_number_id, telefono_negocio) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'Joyería Sintética', 'PN-PERF', '573000000000') on conflict do nothing;
select pg_temp.sembrar('aaaaaaaa-0000-4000-8000-0000000000a1', :n_negocio, true);
-- Negocio R (ruido multi-tenant, sin fotos).
select pg_temp.sembrar('bbbbbbbb-0000-4000-8000-0000000000b2', :n_ruido, false);
-- Negocio Q (segundo negocio con Catálogo, opcional).
insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado)
  select 'cccccccc-0000-4000-8000-0000000000c3', 'catalogo', true where :n_segundo > 0 on conflict do nothing;
insert into public.dulabs_catalogo_publicacion (id_tenant, slug, nombre_publico, publicado)
  select 'cccccccc-0000-4000-8000-0000000000c3', 'joyeria-sintetica-dos', 'Joyería Sintética Dos', true where :n_segundo > 0 on conflict do nothing;
insert into public.dulabs_clientes_config (id_tenant, nombre_negocio, phone_number_id, telefono_negocio)
  select 'cccccccc-0000-4000-8000-0000000000c3', 'Joyería Sintética Dos', 'PN-PERF-2', '573000000002' where :n_segundo > 0 on conflict do nothing;
select pg_temp.sembrar('cccccccc-0000-4000-8000-0000000000c3', :n_segundo, true);
update public.dulabs_inventario_productos set nombre = nombre || ' Q'
 where id_tenant = 'cccccccc-0000-4000-8000-0000000000c3' and nombre not like '% Q';
analyze public.dulabs_inventario_productos;
analyze public.dulabs_catalogo_media;
analyze public.dulabs_catalogo_categorias;
select id_tenant, count(*) as productos, count(*) filter (where activo) as activos from public.dulabs_inventario_productos group by 1 order by 1;
