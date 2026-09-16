/**
 * AMORE (autorizado, módulo Inventario) — "Registrar venta de producto".
 * Único punto real de acceso a `dulabs_inventario_ventas` y a la función
 * atómica `dulabs_registrar_venta_producto` (ver la migración
 * 20261007000000_amore_inventario_ventas.sql para la garantía real de
 * atomicidad/concurrencia/idempotencia -- este archivo solo llama esa
 * función y traduce sus errores tipados, nunca reimplementa la lógica de
 * negocio en TypeScript).
 *
 * Reutilizado por app/api/agenda/[token]/inventario/ventas/route.ts (mobile
 * y web comparten el MISMO endpoint) y por lib/contabilidad/consultas.ts
 * (lectura de ventas para el reporte de ingresos).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface VentaProducto {
  id: string;
  idTenant: string;
  productoId: string;
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  total: number;
  createdAt: string;
}

/** Entero >= 1, o null si no es válido. Acepta number o string numérica (mismo criterio que validarStockProducto/validarPrecioProducto en lib/amore-inventario.ts). */
export function validarCantidadVenta(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero < 1) return null;
  return numero;
}

export type MotivoVentaRechazada = "cantidad_invalida" | "producto_no_encontrado" | "producto_inactivo" | "stock_insuficiente";

export type ResultadoRegistrarVenta =
  | { ok: true; venta: VentaProducto; stockRestante: number; yaExistia: boolean }
  | { ok: false; motivo: MotivoVentaRechazada };

const CODIGO_A_MOTIVO: Record<string, MotivoVentaRechazada> = {
  AM001: "cantidad_invalida",
  AM002: "producto_no_encontrado",
  AM003: "producto_inactivo",
  AM004: "stock_insuficiente",
};

// Corrección real (autorizada) -- los nombres vienen prefijados con
// "venta_" a propósito (ver la migración SQL): las primeras columnas de
// salida de dulabs_registrar_venta_producto colisionaban EXACTAMENTE con
// nombres de columna reales de dulabs_inventario_ventas, lo que Postgres
// rechazaba con "column reference is ambiguous" (42702) en cuanto la
// función intentaba insertar/actualizar de verdad.
interface FilaRpc {
  venta_id: string;
  venta_producto_id: string;
  venta_producto_nombre: string;
  venta_cantidad: number;
  venta_precio_unitario: number;
  venta_total: number;
  stock_restante: number;
  ya_existia: boolean;
}

/**
 * Registra una venta de forma atómica (ver el comentario de la función SQL
 * para la garantía real): valida cantidad/existencia/estado activo/stock,
 * descuenta el stock y crea la venta en UNA transacción -- nunca dos pasos
 * separados desde la aplicación. `idempotencyKey` la genera el LLAMADOR
 * (un UUID nuevo por cada apertura del formulario, ver
 * components/spa-panel/modals/VentaModal.tsx) -- un reintento/doble clic
 * con la misma clave nunca descuenta el stock una segunda vez.
 *
 * NUNCA confía en un precio/total enviado por el cliente: el precio real
 * vigente y el total se calculan DENTRO de la función SQL a partir del
 * producto real, nunca de lo que mande el frontend.
 */
export async function registrarVentaProducto(
  supabase: SupabaseClient,
  idTenant: string,
  params: { productoId: string; cantidad: number; idempotencyKey: string },
): Promise<ResultadoRegistrarVenta> {
  const { data, error } = await supabase.rpc("dulabs_registrar_venta_producto", {
    p_tenant: idTenant,
    p_producto_id: params.productoId,
    p_cantidad: params.cantidad,
    p_idempotency_key: params.idempotencyKey,
  });

  if (error) {
    const motivo = CODIGO_A_MOTIVO[error.code ?? ""];
    if (motivo) return { ok: false, motivo };
    throw error;
  }

  const fila = (Array.isArray(data) ? data[0] : data) as FilaRpc | undefined;
  if (!fila) throw new Error("dulabs_registrar_venta_producto no devolvió ninguna fila");

  return {
    ok: true,
    venta: {
      id: fila.venta_id,
      idTenant,
      productoId: fila.venta_producto_id,
      productoNombre: fila.venta_producto_nombre,
      cantidad: fila.venta_cantidad,
      precioUnitario: fila.venta_precio_unitario,
      total: fila.venta_total,
      createdAt: new Date().toISOString(),
    },
    stockRestante: fila.stock_restante,
    yaExistia: fila.ya_existia,
  };
}

export interface RangoFechasVentas {
  desde: Date;
  hasta: Date;
}

/** Ventas reales del tenant en el rango dado, más recientes primero -- usado tanto por Contabilidad (lib/contabilidad/consultas.ts) como por el historial de ventas del panel. */
export async function listarVentasProductos(
  supabase: SupabaseClient,
  params: { idTenant: string; rango?: RangoFechasVentas; limite?: number },
): Promise<VentaProducto[]> {
  let consulta = supabase
    .from("dulabs_inventario_ventas")
    .select("id, id_tenant, producto_id, producto_nombre, cantidad, precio_unitario, total, created_at")
    .eq("id_tenant", params.idTenant)
    .order("created_at", { ascending: false });

  if (params.rango) {
    consulta = consulta.gte("created_at", params.rango.desde.toISOString()).lt("created_at", params.rango.hasta.toISOString());
  }
  if (params.limite) consulta = consulta.limit(params.limite);

  const { data, error } = await consulta;
  if (error) throw error;

  return ((data ?? []) as { id: string; id_tenant: string; producto_id: string; producto_nombre: string; cantidad: number; precio_unitario: number; total: number; created_at: string }[]).map(
    (f) => ({
      id: f.id,
      idTenant: f.id_tenant,
      productoId: f.producto_id,
      productoNombre: f.producto_nombre,
      cantidad: f.cantidad,
      precioUnitario: f.precio_unitario,
      total: f.total,
      createdAt: f.created_at,
    }),
  );
}
