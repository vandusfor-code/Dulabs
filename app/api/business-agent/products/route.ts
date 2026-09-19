/**
 * /api/business-agent/products — autoría de productos estructurados del Business Agent
 * (autoservicio, R6). REUTILIZA la tabla EXISTENTE `dulabs_inventario_productos` (por tenant,
 * precio COP entero, stock, activo) que lee la cotización del Runtime -- no crea otra tabla.
 * Auth admin + tenant SIEMPRE de la sesión (nunca del body/query), igual que el resto de
 * /api/business-agent/*. La lógica de acceso a datos (con el filtro id_tenant) vive en
 * lib/business-agent-products-store.ts.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { validateProductInput } from "@/lib/business-agent-products";
import { createProduct, listProducts, MAX_PRODUCTS_PER_TENANT } from "@/lib/business-agent-products-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_products_get", tenantId: miembro.tenantId, categoria: "lectura" });
  if (limite) return limite;

  try {
    return apiOk({ products: await listProducts(supabase, miembro.tenantId) });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudieron cargar los productos.", 500);
  }
}

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

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
    const r = await createProduct(supabase, miembro.tenantId, validation.value);
    if (!r.ok) return apiError("LIMIT_REACHED", `Alcanzaste el máximo de ${MAX_PRODUCTS_PER_TENANT} productos.`, 409);
    return apiOk({ product: r.product }, 201);
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo crear el producto.", 500);
  }
}
