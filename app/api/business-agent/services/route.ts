/**
 * /api/business-agent/services — autoría de servicios estructurados del Business
 * Agent (autoservicio). REUTILIZA la tabla EXISTENTE `dulabs_servicios` (la
 * misma que ya leen las acciones de catálogo del Runtime) -- no crea otra tabla.
 * Auth admin + tenant SIEMPRE de la sesión (nunca del body/query), igual que el
 * resto de /api/business-agent/*. Solo campos genéricos (nombre, categoría,
 * descripción, duración, precio COP, activo); nunca toca comisiones ni la
 * asociación N:N con especialistas (específicas de AMORE).
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { rowToService, validateServiceInput, type ServicioRow } from "@/lib/business-agent-services";

export const runtime = "nodejs";

const COLUMNS = "id, nombre, categoria, descripcion, duracion_min, precio, activo";

export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_services_get", tenantId: miembro.tenantId, categoria: "lectura" });
  if (limite) return limite;

  try {
    const { data, error } = await supabase
      .from("dulabs_servicios")
      .select(COLUMNS)
      .eq("id_tenant", miembro.tenantId)
      .order("categoria", { ascending: true, nullsFirst: true })
      .order("nombre", { ascending: true });
    if (error) throw error;
    return apiOk({ services: ((data ?? []) as ServicioRow[]).map(rowToService) });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudieron cargar los servicios.", 500);
  }
}

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_services_write", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
  }
  const validation = validateServiceInput(body);
  if (!validation.ok) return apiError("VALIDATION_ERROR", validation.error, 400);
  const v = validation.value;

  try {
    const { data, error } = await supabase
      .from("dulabs_servicios")
      .insert({
        id_tenant: miembro.tenantId,
        nombre: v.nombre,
        categoria: v.categoria,
        descripcion: v.descripcion,
        duracion_min: v.duracionMin,
        precio: v.precio,
        activo: v.activo,
      })
      .select(COLUMNS)
      .single();
    if (error || !data) throw error ?? new Error("insert vacío");
    return apiOk({ service: rowToService(data as ServicioRow) }, 201);
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo crear el servicio.", 500);
  }
}
