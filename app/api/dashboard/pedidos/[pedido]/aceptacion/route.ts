/**
 * Fase 3B.5/3B.7 — un pedido pendiente de aceptación (negocio de la sesión; módulos "pedidos" y "pedidos_por_aceptar").
 *
 *   GET   detalle completo + historial (documento solo enmascarado). Un pedido que ya se procesó devuelve su estado
 *         actual (`procesado`), no un error.
 *   POST  { accion: "aceptar" | "rechazar" | "cancelar", motivo? } — SOLO una persona autenticada del negocio con
 *         permiso (la responsable y su respaldo; con "responsable_y_admins", también un admin). Aceptar usa
 *         acceptOrder (nunca confirmOrder): ahí empieza la venta. Rechazar/cancelar: sin venta ni reserva.
 *         Repetir la acción no la repite (`repetido: true`). El motivo es obligatorio para rechazar y cancelar.
 */
import type { NextRequest } from "next/server";
import { decidirPorAceptar, detallePorAceptar } from "@/lib/catalogo/pedidos/por-aceptar";
import { conPorAceptar } from "@/lib/catalogo/pedidos/por-aceptar-produccion";

export const runtime = "nodejs";

type Params = { params: Promise<{ pedido: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { pedido } = await params;
  return conPorAceptar(request, "pedidos_lectura", (ctx) => detallePorAceptar(ctx, pedido.toUpperCase()));
}

export async function POST(request: NextRequest, { params }: Params) {
  const { pedido } = await params;
  return conPorAceptar(request, "pedidos_escritura", async (ctx) => {
    const body = await request.json().catch(() => null);
    return decidirPorAceptar(ctx, pedido.toUpperCase(), body);
  });
}
