/**
 * Business Agent 2.0 — FASE 9: diagnóstico de soporte del negocio.
 *
 *   GET /api/business-agent/diagnostics            incidentes recientes del agente (máx. 20)
 *   GET /api/business-agent/diagnostics?ref=XXXX   el incidente de esa referencia (la que vio el cliente: "Ref. XXXX")
 *
 * Auth + tenant de la SESIÓN (nunca del query): una referencia de otro negocio no devuelve nada. Cada incidente trae
 * qué pasó (mensaje humano), quién lo resuelve, código BA-*, versión, motor, dependencia, correlación y hora.
 * Nunca trazas de pila, secretos ni textos del cliente.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { createSupabaseIncidentStore } from "@/lib/agent-compiler/runtime/production/operations";
import { diagnoseIncident, normalizeSupportRef } from "@/lib/agent-compiler/runtime/production/diagnostics";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_diagnostics", tenantId: miembro.tenantId, categoria: "lectura" });
  if (limite) return limite;

  const rawRef = new URL(request.url).searchParams.get("ref");
  const ref = rawRef === null ? null : normalizeSupportRef(rawRef);
  if (rawRef !== null && !ref) return apiError("REQUEST_INVALID_BODY", "La referencia no es válida (6 a 12 letras o números).", 400);

  try {
    const incidents = await createSupabaseIncidentStore(supabase).find(miembro.tenantId, ref ? { ref } : { limit: 20 });
    if (ref && incidents.length === 0) return apiError("NOT_FOUND", "No hay ningún incidente con esa referencia en tu negocio.", 404);
    return apiOk({ incidents: incidents.map(diagnoseIncident) });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo consultar el diagnóstico.", 500);
  }
}
