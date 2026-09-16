-- AMORE (autorizado, módulo Inventario) — "Registrar venta de producto".
-- Evolución explícitamente prevista por la migración original de
-- dulabs_inventario_productos (20260923000000_amore_inventario_productos.sql):
-- "Diseñada para poder evolucionar más adelante hacia pedidos/ventas/
-- movimientos de stock (FK futura hacia esta tabla por (id_tenant, id)) sin
-- necesitar rediseño" -- esta es esa evolución. Aditiva: no toca ninguna
-- tabla existente.
--
-- Esta MISMA tabla sirve a la vez como (1) el registro de la venta, (2) el
-- movimiento de inventario (nunca se descuenta stock sin dejar esta fila) y
-- (3) la fuente real del "ingreso" que Contabilidad (lib/contabilidad, ver
-- consultas.ts::buscarVentasProductos) suma junto a las citas de servicio --
-- Contabilidad NUNCA tuvo una tabla propia de "movimientos contables"
-- (siempre calculó todo en vivo desde dulabs_citas_especialista), así que
-- crear una tabla de asientos contables aparte hubiera sido la duplicación
-- que el pedido explícitamente prohíbe. producto_nombre/precio_unitario son
-- una FOTO del momento de la venta (nunca se recalculan si el producto se
-- renombra/reprecia después) -- mismo criterio contable de nunca reescribir
-- historia.
create table public.dulabs_inventario_ventas (
  id uuid not null default gen_random_uuid(),
  id_tenant uuid not null,
  producto_id uuid not null,
  producto_nombre text not null,
  cantidad integer not null check (cantidad > 0),
  precio_unitario integer not null check (precio_unitario >= 0),
  total integer not null check (total >= 0),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (id_tenant, id),
  foreign key (id_tenant, producto_id) references public.dulabs_inventario_productos (id_tenant, id)
);

create index dulabs_inventario_ventas_tenant_fecha_idx
  on public.dulabs_inventario_ventas (id_tenant, created_at desc);

-- Idempotencia (sección "CONFIRMAR VENTA" del pedido -- doble clic/reintento
-- de red NUNCA debe duplicar la venta): un segundo INSERT con la MISMA
-- clave para el mismo tenant choca acá, nunca a mano en aplicación. Ver
-- dulabs_registrar_venta_producto más abajo -- usa
-- "on conflict (id_tenant, idempotency_key) do nothing" ANTES de tocar el
-- stock, así una clave repetida nunca descuenta una segunda vez.
create unique index dulabs_inventario_ventas_tenant_idempotency_key
  on public.dulabs_inventario_ventas (id_tenant, idempotency_key);

comment on table public.dulabs_inventario_ventas is
  'AMORE (autorizado) -- venta real de un producto de dulabs_inventario_productos. Cada fila es simultáneamente el movimiento de stock y la fuente de ingreso que Contabilidad suma (ver lib/contabilidad/consultas.ts). Insertada EXCLUSIVAMENTE por dulabs_registrar_venta_producto (nunca por INSERT directo desde la aplicación) para garantizar que el descuento de stock y el registro de la venta queden en la misma transacción atómica.';
comment on column public.dulabs_inventario_ventas.producto_nombre is 'Foto del nombre al momento de la venta -- nunca se actualiza si el producto se renombra después (historial contable no se reescribe).';
comment on column public.dulabs_inventario_ventas.precio_unitario is 'Foto del precio real del producto al momento de la venta (nunca el precio enviado por el cliente/frontend).';
comment on column public.dulabs_inventario_ventas.idempotency_key is 'Generada por el cliente (un UUID nuevo por cada apertura del formulario de venta) -- un reintento/doble clic con la MISMA clave nunca crea una segunda fila.';

alter table public.dulabs_inventario_ventas enable row level security;

-- Registro atómico de una venta: descuenta stock y registra la venta en UNA
-- sola transacción (el cuerpo completo de una función plpgsql corre dentro
-- de la transacción de quien la invoca -- si cualquier `raise exception`
-- dispara, Postgres revierte TODO lo hecho hasta ahí, incluida cualquier
-- actualización previa dentro de esta misma llamada).
--
-- Concurrencia real (sección "MUY IMPORTANTE" del pedido -- nunca vender más
-- unidades de las que existen): "select ... for update" toma un lock de fila
-- real sobre el producto ANTES de leer su stock -- una segunda venta
-- concurrente del MISMO producto queda bloqueada hasta que la primera
-- confirme o revierta, y entonces lee el stock YA actualizado (nunca el
-- mismo "stock libre" que vio la primera). No hace falta un advisory lock
-- (a diferencia de dulabs_reservar_cita, que sí lo necesita por el
-- solapamiento de horarios arbitrario): acá basta el lock de fila normal de
-- Postgres sobre la fila exacta que se va a modificar.
--
-- Idempotencia real (doble clic/reintento) SIN duplicar el descuento de
-- stock: el INSERT con "on conflict (id_tenant, idempotency_key) do
-- nothing" ocurre ANTES del UPDATE de stock. Si la clave ya existe (esta
-- misma llamada reintentada, o una llamada concurrente con la MISMA clave
-- que ganó la carrera), el INSERT no inserta nada, `stock` nunca se toca en
-- ESTA invocación, y se devuelve la venta YA existente tal cual (con el
-- stock real actual) -- nunca se resta dos veces.
-- Corrección real (autorizada) -- la primera versión de esta función usaba
-- `returns table (id uuid, producto_id uuid, producto_nombre text, cantidad
-- int, precio_unitario int, total int, ...)`: esos nombres son EXACTAMENTE
-- los mismos nombres de columna reales de dulabs_inventario_ventas. Postgres
-- crea variables OUT implícitas con esos mismos nombres para toda la función
-- (no solo para RETURN QUERY) -- el resultado real observado fue
-- "column reference \"id\" is ambiguous" (42702) en cuanto la función
-- intentaba de verdad insertar/actualizar, aunque el código ya calificaba
-- cada referencia con un alias (p./vv./v_venta.). Se evita la clase
-- COMPLETA de ambigüedad renombrando las columnas de salida con el prefijo
-- `venta_` -- nunca coinciden con ninguna columna real de ninguna tabla que
-- toca esta función. `drop function if exists` primero porque
-- `create or replace function` no permite cambiar los nombres de las
-- columnas de un `returns table` (solo permite mismos nombres/tipos/orden).
drop function if exists public.dulabs_registrar_venta_producto(uuid, uuid, int, text);

create function public.dulabs_registrar_venta_producto(
  p_tenant uuid,
  p_producto_id uuid,
  p_cantidad int,
  p_idempotency_key text
) returns table (
  venta_id uuid,
  venta_producto_id uuid,
  venta_producto_nombre text,
  venta_cantidad int,
  venta_precio_unitario int,
  venta_total int,
  stock_restante int,
  ya_existia boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_producto record;
  v_venta record;
  v_total int;
begin
  if p_cantidad is null or p_cantidad < 1 then
    raise exception using errcode = 'AM001', message = 'cantidad_invalida';
  end if;

  select p.nombre, p.precio, p.stock, p.activo into v_producto
  from public.dulabs_inventario_productos p
  where p.id_tenant = p_tenant and p.id = p_producto_id
  for update;

  if not found then
    raise exception using errcode = 'AM002', message = 'producto_no_encontrado';
  end if;

  if not v_producto.activo then
    raise exception using errcode = 'AM003', message = 'producto_inactivo';
  end if;

  if v_producto.stock < p_cantidad then
    raise exception using errcode = 'AM004', message = 'stock_insuficiente';
  end if;

  v_total := v_producto.precio * p_cantidad;

  insert into public.dulabs_inventario_ventas as vv
    (id_tenant, producto_id, producto_nombre, cantidad, precio_unitario, total, idempotency_key)
  values
    (p_tenant, p_producto_id, v_producto.nombre, p_cantidad, v_producto.precio, v_total, p_idempotency_key)
  on conflict (id_tenant, idempotency_key) do nothing
  returning vv.id, vv.producto_id, vv.producto_nombre, vv.cantidad, vv.precio_unitario, vv.total
  into v_venta;

  if not found then
    -- Reintento idempotente: esta MISMA clave ya se procesó antes (por esta
    -- llamada repetida o por una concurrente que ganó la carrera). El stock
    -- de ESTA invocación nunca se toca -- se devuelve la venta ya creada,
    -- con el stock real actual del producto.
    select v.id, v.producto_id, v.producto_nombre, v.cantidad, v.precio_unitario, v.total
      into v_venta
    from public.dulabs_inventario_ventas v
    where v.id_tenant = p_tenant and v.idempotency_key = p_idempotency_key;

    return query select v_venta.id, v_venta.producto_id, v_venta.producto_nombre, v_venta.cantidad,
      v_venta.precio_unitario, v_venta.total, v_producto.stock, true;
    return;
  end if;

  update public.dulabs_inventario_productos
    set stock = stock - p_cantidad, updated_at = now()
    where id_tenant = p_tenant and id = p_producto_id;

  return query select v_venta.id, v_venta.producto_id, v_venta.producto_nombre, v_venta.cantidad,
    v_venta.precio_unitario, v_venta.total, (v_producto.stock - p_cantidad), false;
end;
$$;

revoke all on function public.dulabs_registrar_venta_producto(uuid, uuid, int, text) from public;
grant execute on function public.dulabs_registrar_venta_producto(uuid, uuid, int, text) to service_role;

comment on function public.dulabs_registrar_venta_producto is
  'Registra una venta de producto de forma atómica: valida cantidad/existencia/estado activo/stock, descuenta el stock y crea la venta en UNA transacción (rollback automático de todo si cualquier validación falla). Lock de fila real (FOR UPDATE) sobre el producto para que dos ventas concurrentes del mismo producto nunca vendan más stock del disponible. Idempotente por (id_tenant, idempotency_key): un reintento/doble clic con la misma clave nunca descuenta el stock una segunda vez, devuelve la venta ya creada con ya_existia=true. Columnas de salida prefijadas con venta_ (venta_id, venta_producto_id, ...) a propósito -- nunca deben coincidir con nombres de columna reales de ninguna tabla (ver el comentario arriba de la función, "column reference ambiguous" real evitado así). Errores tipados vía errcode AM001 (cantidad_invalida), AM002 (producto_no_encontrado), AM003 (producto_inactivo), AM004 (stock_insuficiente) -- ver lib/amore-inventario-ventas.ts::registrarVentaProducto para el mapeo real.';
