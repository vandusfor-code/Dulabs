/**
 * POST /api/business-agent/preview — Bloque 12G (Authoring API, autorizado).
 *
 * Prueba UN turno de conversación contra el Business Agent compilado (Gate
 * PRE-LLM real + Flow Engine vía simulador, ver lib/agent-compiler/api/preview.ts)
 * SIN tocar WhatsApp/Claude/DB reales y sin persistir nada -- mismo patrón de
 * seguridad estructural que POST /api/flows/[id]/simulate (executors
 * SIEMPRE simulados). `flowVersionId` opcional: por defecto usa la versión
 * más reciente (draft o publicada) del tenant. `engineState` viaja completo
 * en cada respuesta -- el cliente lo reenvía en el siguiente turno, igual que
 * el simulador de Flow Studio.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { createSupabaseBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/registry-store-supabase";
import { listAgentVersions, isPlainObject } from "@/lib/agent-compiler/api/business-agent-api";
import { previewBusinessAgentTurn, type SimulationInputEvent } from "@/lib/agent-compiler/api/preview";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import type { FlowEngineState } from "@/lib/flow/engine-types";

export const runtime = "nodejs";

function parseEvent(raw: unknown): SimulationInputEvent | null {
  if (!isPlainObject(raw) || typeof raw.type !== "string") return null;
  if (raw.type === "start") return { type: "start" };
  if (raw.type === "text" && typeof raw.text === "string") return { type: "text", text: raw.text };
  if (raw.type === "button" && typeof raw.id === "string") return { type: "button", id: raw.id };
  return null;
}

function parseEngineState(raw: unknown): FlowEngineState | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) return "invalid";
  if (typeof raw.executionId !== "string" || typeof raw.status !== "string" || !isPlainObject(raw.variables) || !isPlainObject(raw.exports)) return "invalid";
  return raw as unknown as FlowEngineState;
}

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  // Rate limit por tenant: preview corre el LLM real -> operación costosa.
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_preview", tenantId: miembro.tenantId, categoria: "costosa" });
  if (limite) return limite;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
  }
  if (!isPlainObject(body)) return apiError("REQUEST_INVALID_BODY", "El cuerpo debe ser un objeto JSON.", 400);

  const event = parseEvent(body.event);
  if (!event) return apiError("REQUEST_INVALID_BODY", "Falta o es inválido 'event' -- debe ser {type:'start'} | {type:'text',text} | {type:'button',id}.", 400);
  const engineState = parseEngineState(body.engineState);
  if (engineState === "invalid") return apiError("REQUEST_INVALID_BODY", "'engineState' inválido -- debe ser el objeto devuelto por un turno anterior, o null/ausente para empezar.", 400);
  if (body.flowVersionId !== undefined && typeof body.flowVersionId !== "string") {
    return apiError("REQUEST_INVALID_BODY", "'flowVersionId' debe ser texto.", 400);
  }

  try {
    const deps = { store: createSupabaseBusinessAgentRegistryStore(supabase) };

    let targetVersionId: string | undefined = body.flowVersionId;
    if (!targetVersionId) {
      const versions = await listAgentVersions(deps, { tenantId: miembro.tenantId });
      targetVersionId = versions[0]?.flowVersionId;
    }
    if (!targetVersionId) return apiError("NO_VERSION", "Este Business Agent no tiene ninguna versión guardada todavía -- guarda un borrador antes de probar.", 400);

    const version = await deps.store.getVersion(miembro.tenantId, targetVersionId);
    if (!version) return apiError("VERSION_NOT_FOUND", "Versión no encontrada.", 404);

    const result = await previewBusinessAgentTurn({
      flow: version.flow,
      gateRules: version.gateRules,
      tenantId: miembro.tenantId,
      flowId: version.flowId,
      flowVersionId: version.flowVersionId,
      engineState,
      event,
    });

    return apiOk({ flowVersionId: version.flowVersionId, versionNumber: version.versionNumber, ...result });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo ejecutar el preview.", 500);
  }
}
