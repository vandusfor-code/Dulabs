/**
 * /api/business-agent/services/[id] — editar/eliminar un servicio del tenant.
 * Auth admin + tenant de la sesión. Toda query filtra por (id, id_tenant): un
 * admin nunca puede tocar el servicio de otro tenant (aislamiento). Reutiliza
 * dulabs_servicios (no crea tabla nueva).
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { rowToService, validateServiceInput, type ServicioRow } from "@/lib/business-agent-services";

export const runtime = "nodejs";

const COLUMNS = "id, nombre, categoria, descripcion, duracion_min, precio, activo";
/** Postgres: violación de foreign key (servicio referenciado por citas/asociaciones). */
const PG_FK_VIOLATION = "23503";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

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
      .update({
        nombre: v.nombre,
        categoria: v.categoria,
        descripcion: v.descripcion,
        duracion_min: v.duracionMin,
        precio: v.precio,
        activo: v.activo,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("id_tenant", miembro.tenantId)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return apiError("NOT_FOUND", "Servicio no encontrado.", 404);
    return apiOk({ service: rowToService(data as ServicioRow) });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo actualizar el servicio.", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_services_write", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;

  try {
    const { error } = await supabase.from("dulabs_servicios").delete().eq("id", id).eq("id_tenant", miembro.tenantId);
    if (error) {
      if ((error as { code?: string }).code === PG_FK_VIOLATION) {
        // Servicio referenciado (p. ej. por citas): no se borra; se sugiere desactivar.
        return apiError("SERVICE_IN_USE", "Este servicio está en uso y no se puede eliminar. Desactívalo en su lugar.", 409);
      }
      throw error;
    }
    return apiOk({ ok: true });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo eliminar el servicio.", 500);
  }
}
