-- DuLabs — «PARA QUIÉN» de cada pieza del Catálogo: Mujer u Hombre (Delacour · Vértice).
--
-- Qué resuelve: la clienta (Delacour) lanza una colección masculina, Vértice, y quiere que la tienda separe las joyas de hombre y las de mujer: un selector «Mujer | Hombre» y, al entrar al lado de
-- hombre, toda la tienda cambia sola a la paleta de Vértice (grafito y plata). Cada pieza necesita saber para quién es. Esta migración agrega ESE dato: la columna `genero` de
-- dulabs_inventario_productos ('mujer' | 'hombre'). Todo lo que ya existe queda como 'mujer' (la tienda de siempre es la de mujer); solo hay que marcar las de hombre (panel → Catálogo → «Para»).
--
-- ADITIVA: una columna con valor por defecto, un CHECK y un índice parcial. No cambia ni borra ningún dato, no toca ninguna función, y no cambia el significado de ninguna otra columna. El CÓDIGO
-- tampoco depende de ella para lo de siempre: ninguna lectura del catálogo la menciona salvo las de «Hombre/Mujer» (que se apagan solas si la columna no existe), así que desplegar el código ANTES
-- de aplicar esta migración no rompe nada: la tienda y el panel se ven exactamente como antes hasta que se aplique.
-- AUDITORÍA: el trigger dulabs_catalogo_auditar_producto (migración 20261105000000) ya registra cualquier columna que cambie, así que cada marca «Para» queda en dulabs_catalogo_eventos con quién y cuándo.
-- PERFORMANCE: añadir una columna con DEFAULT constante es instantáneo en Postgres 11+ (no reescribe la tabla). El índice parcial solo guarda las piezas de hombre (decenas o cientos), no todo el catálogo.
-- RECUPERACIÓN: supabase/rollbacks/20261215000000_dulabs_catalogo_genero.down.sql (se niega a correr si ya hay piezas marcadas como de hombre: borrar la columna perdería esa clasificación).
-- Idempotente: se puede ejecutar más de una vez. Se aplica a mano en el SQL Editor de Supabase.

begin;

do $$
begin
  if to_regclass('public.dulabs_inventario_productos') is null then
    raise exception 'falta la tabla dulabs_inventario_productos (migración 20260923000000_amore_inventario_productos.sql)';
  end if;
end;
$$;

-- ============================================================
-- 1. LA COLUMNA
-- ============================================================
alter table public.dulabs_inventario_productos
  add column if not exists genero text not null default 'mujer';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dulabs_inventario_productos_genero_check'
      and conrelid = 'public.dulabs_inventario_productos'::regclass
  ) then
    alter table public.dulabs_inventario_productos
      add constraint dulabs_inventario_productos_genero_check check (genero in ('mujer', 'hombre'));
  end if;
end;
$$;

comment on column public.dulabs_inventario_productos.genero is
  'Para quién es la pieza: mujer (por defecto: la tienda de siempre) u hombre. Solo cambia la separación de la tienda pública y el filtro «Para» del panel; no cambia precios, inventario, carrito ni pedidos. Lo escribe el Catálogo (panel); el SQL Editor también sirve (sin actor en la auditoría).';

-- ============================================================
-- 2. ÍNDICE PARCIAL (solo las piezas de hombre)
-- ============================================================
-- La tienda lee las referencias de hombre de un negocio en cada visita al listado: este índice lo hace una lectura de unas pocas filas.
create index if not exists dulabs_inventario_productos_hombre_idx
  on public.dulabs_inventario_productos (id_tenant, referencia)
  where genero = 'hombre';

-- PostgREST (la API de Supabase) vuelve a leer el esquema para ver la columna nueva sin reiniciar nada.
notify pgrst, 'reload schema';

commit;
