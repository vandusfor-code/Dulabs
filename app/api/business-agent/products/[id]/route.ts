/**
 * /api/business-agent/products/[id] — editar/eliminar un producto del tenant (R6).
 * Auth admin + tenant de la sesión. Toda query filtra por (id, id_tenant): un admin nunca puede
 * tocar el producto de otro tenant (aislamiento). Reutiliza dulabs_inventario_productos.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { validateProductInput } from "@/lib/business-agent-products";
import { deleteProduct, updateProduct } from "@/lib/business-agent-products-store";

export const runtime = "nodejs";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_products_write", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
  }
  const validation = validateProductInput(body);
  if (!validation.ok) return apiError("VALIDATION_ERROR", validation.error, 400);

  try {
    const product = await updateProduct(supabase, miembro.tenantId, id, validation.value);
    if (!product) return apiError("NOT_FOUND", "Producto no encontrado.", 404);
    return apiOk({ product });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo actualizar el producto.", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_products_write", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;

  try {
    await deleteProduct(supabase, miembro.tenantId, id);
    return apiOk({ ok: true });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo eliminar el producto.", 500);
  }
}
