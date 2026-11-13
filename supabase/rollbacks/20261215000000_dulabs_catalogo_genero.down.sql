-- REVERSA de 20261215000000_dulabs_catalogo_genero.sql: quita la columna `genero` (y su CHECK e índice) de dulabs_inventario_productos.
--
-- Se NIEGA a correr si ya hay piezas marcadas como de hombre: borrar la columna perdería esa clasificación y todas volverían a salir en la tienda de mujer. En ese caso primero hay que decidir qué
-- hacer con ellas (por ejemplo, anotar sus referencias: select referencia from public.dulabs_inventario_productos where genero = 'hombre';).
-- Después de la reversa el código sigue funcionando: la separación Mujer/Hombre se apaga sola y la tienda y el panel quedan como antes.

begin;

do $$
declare
  v_hombres bigint;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dulabs_inventario_productos' and column_name = 'genero'
  ) then
    execute 'select count(*) from public.dulabs_inventario_productos where genero = ''hombre''' into v_hombres;
    if v_hombres > 0 then
      raise exception 'hay % piezas marcadas como de hombre: no se borra la columna (se perdería esa clasificación)', v_hombres;
    end if;
  end if;
end;
$$;

drop index if exists public.dulabs_inventario_productos_hombre_idx;
alter table public.dulabs_inventario_productos drop constraint if exists dulabs_inventario_productos_genero_check;
alter table public.dulabs_inventario_productos drop column if exists genero;

notify pgrst, 'reload schema';

commit;
