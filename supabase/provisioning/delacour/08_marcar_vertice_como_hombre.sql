-- DELACOUR · VÉRTICE — MARCAR COMO DE HOMBRE las 76 piezas de la colección (DL-000769 … DL-000844), cargadas el 12-nov-2026 con la Carga masiva del panel.
-- Corre en el SQL Editor de Supabase como UNA sola sentencia (un bloque DO, atómico): si cualquier guarda falla, no queda nada.
--
-- ORDEN: correr SOLO DESPUÉS de aplicar la migración 20261215000000_dulabs_catalogo_genero.sql (sin ella este script se niega). El código nuevo de la tienda (selector «Mujer | Hombre» y tema Vértice)
-- puede desplegarse antes o después: hasta que haya al menos una pieza de hombre activa la tienda se ve como siempre, y con estas 76 marcadas aparece el lado de hombre.
--
-- QUÉ HACE: pone genero = 'hombre' a EXACTAMENTE esas 76 piezas (las de la carga: referencia entre DL-000769 y DL-000844, material «Acero» y el nombre con «Santo · referencia del catálogo de la clienta»). Solo cambia ese
--   campo: no toca precios, stock, fotos, nombres, categorías ni estado.
-- GUARDAS: UNA sola tienda con slug «delacour»; la migración aplicada; y que las piezas que cumplen el patrón sean EXACTAMENTE 76 (si la clienta agregó o editó algo en ese rango, se niega y dice cuántas hay).
-- QUÉ NO HACE: no marca ninguna otra pieza. Las demás siguen siendo de mujer (lo predeterminado). Se puede repetir sin efectos nuevos.
-- AUDITORÍA: cada pieza queda en dulabs_catalogo_eventos con el cambio «genero: mujer → hombre» (sin actor: viene del SQL Editor, no del panel).
--
-- REVERSA: 08_marcar_vertice_como_hombre.reversa.sql (las vuelve a dejar como de mujer).

do $$
declare
  v_tienda integer;
  v_tenant uuid;
  v_candidatas integer;
  v_marcadas integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dulabs_inventario_productos' and column_name = 'genero'
  ) then
    raise exception 'Delacour: falta aplicar la migración 20261215000000_dulabs_catalogo_genero.sql antes de marcar las piezas de hombre';
  end if;

  select count(*) into v_tienda from public.dulabs_catalogo_publicacion where slug = 'delacour';
  if v_tienda <> 1 then
    raise exception 'Delacour: se esperaba exactamente UNA publicación con slug «delacour», hay %', v_tienda;
  end if;
  select id_tenant into v_tenant from public.dulabs_catalogo_publicacion where slug = 'delacour';

  -- Las candidatas: las 76 de la carga de Vértice (y ninguna otra pieza de Delacour).
  select count(*) into v_candidatas
  from public.dulabs_inventario_productos
  where id_tenant = v_tenant
    and referencia between 'DL-000769' and 'DL-000844'
    and material = 'Acero'
    and nombre like '% · %';
  if v_candidatas <> 76 then
    raise exception 'Delacour: se esperaban 76 piezas de la colección Vértice (DL-000769 a DL-000844, material Acero) y hay %; no se marca nada', v_candidatas;
  end if;

  update public.dulabs_inventario_productos
  set genero = 'hombre'
  where id_tenant = v_tenant
    and referencia between 'DL-000769' and 'DL-000844'
    and material = 'Acero'
    and nombre like '% · %'
    and genero <> 'hombre';
  get diagnostics v_marcadas = row_count;

  raise notice 'Delacour: % piezas marcadas como de hombre ahora (las demás de las 76 ya lo estaban)', v_marcadas;
end;
$$;

-- VERIFICAR (esperado: 76):
--   select count(*) from public.dulabs_inventario_productos
--    where genero = 'hombre' and id_tenant = (select id_tenant from public.dulabs_catalogo_publicacion where slug = 'delacour');
