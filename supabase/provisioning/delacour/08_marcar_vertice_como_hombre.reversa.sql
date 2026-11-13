-- REVERSA de 08_marcar_vertice_como_hombre.sql: vuelve a dejar como de MUJER las piezas de la colección Vértice (DL-000769 … DL-000844, material «Acero»). Una sola sentencia (bloque DO): atómica.
-- Solo cambia el campo genero; no toca precios, stock, fotos ni nada más. Se puede repetir sin efectos nuevos.

do $$
declare
  v_tenant uuid;
  v_n integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dulabs_inventario_productos' and column_name = 'genero'
  ) then
    raise exception 'Delacour: la columna genero no existe (migración 20261215000000 sin aplicar): no hay nada que revertir';
  end if;
  select id_tenant into v_tenant from public.dulabs_catalogo_publicacion where slug = 'delacour';
  if v_tenant is null then
    raise exception 'Delacour: no se encontró la publicación con slug «delacour»';
  end if;
  update public.dulabs_inventario_productos
  set genero = 'mujer'
  where id_tenant = v_tenant
    and referencia between 'DL-000769' and 'DL-000844'
    and material = 'Acero'
    and nombre like '% · %'
    and genero <> 'mujer';
  get diagnostics v_n = row_count;
  raise notice 'Delacour: % piezas devueltas a mujer', v_n;
end;
$$;
