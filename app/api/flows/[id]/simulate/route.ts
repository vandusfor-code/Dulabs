/**
 * POST /api/flows/[id]/simulate — Fase 1 (Flow Simulator, autorizado).
 *
 * Sigue EXACTAMENTE el mismo patrón de seguridad que el resto de
 * `app/api/flows/*` (ver lib/flow/api-auth.ts y app/api/flows/[id]/validate/route.ts,
 * app/api/flows/[id]/publish/route.ts): autentica con `requireFlowAccess`
 * (tenantId SIEMPRE derivado server-side del usuario autenticado, nunca
 * aceptado del body/query), resuelve el Flow con `getFlowById` filtrado por
 * `tenant_id`, y devuelve 404 genérico (nunca 403) si el Flow no existe o es
 * de otro tenant -- mismo criterio de no revelar existencia cross-tenant que
 * ya usan publish/validate/versions.
 *
 * Seguridad estructural (spec §6): este endpoint SIEMPRE arma el registry de
 * executors con `createSimulatedExecutorRegistry` (lib/flow/executors/simulated-executor-registry.ts)
 * -- nunca `createDefaultExecutorRegistry` (el registry REAL de producción,
 * lib/flow/executor-factory.ts). Este archivo no importa esa factory real ni
 * ningún executor real (ClaudeExecutor/GeminiExecutor/SendMessageExecutor/
 * InternalActionExecutor) -- es estructuralmente imposible que este endpoint
 * produzca una llamada real a Meta/WhatsApp/Claude/Gemini/webhook externo.
 *
 * No persiste nada: `runSimulationTurn` (lib/flow/simulate-flow.ts) no toca
 * `dulabs_flow_executions` ni ninguna tabla real -- el estado del motor viaja
 * completo en la respuesta y el cliente lo reenvía en el siguiente turno
 * (spec §26, preferencia explícita por "en memoria/dentro del ciclo de vida
 * del request HTTP").
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getFlowById, listFlowVersions } from "@/lib/flow/flow-store";
import { parseFlowDefinition } from "@/lib/flow/schemas";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { createSimulatedExecutorRegistry, type SimulationOverrides } from "@/lib/flow/executors/simulated-executor-registry";
import { runSimulationTurn, type RunSimulationTurnInput, type SimulationInputEvent } from "@/lib/flow/simulate-flow";
import type { FlowEngineState } from "@/lib/flow/engine-types";

export const runtime = "nodejs";

interface SimulateRequestBody {
  /** Opcional -- por defecto la versión más reciente guardada (draft o publicada), prioridad DRAFT (spec §8). */
  versionId?: unknown;
  event?: unknown;
  /** null/ausente para arrancar (o REINICIAR, spec §24) la simulación desde cero. */
  engineState?: unknown;
  /** Solo se aplican cuando engineState es null (spec §13). */
  initialVariables?: unknown;
  overrides?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  if (typeof raw.executionId !== "string" || typeof raw.status !== "string" || !isPlainObject(raw.variables) || !isPlainObject(raw.exports)) {
    return "invalid";
  }
  return raw as unknown as FlowEngineState;
}

function parseOverrides(raw: unknown): SimulationOverrides | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) return undefined;
  const ai = isPlainObject(raw.ai) ? (raw.ai as SimulationOverrides["ai"]) : undefined;
  const action = isPlainObject(raw.action) ? (raw.action as SimulationOverrides["action"]) : undefined;
  return { ai, action };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Mismos roles que POST /validate (admin + agente) -- simular no escribe
  // nada, así que no exige el rol estricto de admin que sí exige
  // guardar/publicar.
  const access = await requireFlowAccess(request, ["admin", "agente"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id: flowId } = await params;

  let body: SimulateRequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const event = parseEvent(body.event);
  if (!event) {
    return Response.json({ error: "Falta o es inválido 'event' -- debe ser {type:'start'} | {type:'text',text} | {type:'button',id}" }, { status: 400 });
  }
  const engineState = parseEngineState(body.engineState);
  if (engineState === "invalid") {
    return Response.json({ error: "'engineState' inválido -- debe ser el objeto devuelto por un turno anterior, o null para empezar" }, { status: 400 });
  }
  if (body.versionId !== undefined && typeof body.versionId !== "string") {
    return Response.json({ error: "'versionId' debe ser texto" }, { status: 400 });
  }
  const initialVariables = isPlainObject(body.initialVariables) ? body.initialVariables : undefined;
  const overrides = parseOverrides(body.overrides);

  try {
    // tenant_id SIEMPRE de miembro.tenantId (derivado del usuario
    // autenticado) -- nunca del body/query, mismo criterio que el resto de
    // /api/flows/*. getFlowById ya filtra por tenant_id -- un Flow de otro
    // tenant simplemente no existe para esta consulta.
    const flow = await getFlowById(supabase, miembro.tenantId, flowId);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    const versions = await listFlowVersions(supabase, { tenantId: miembro.tenantId, flowId, limit: 100 });
    if (versions.length === 0) {
      return Response.json({ error: "Este Flow no tiene ninguna versión guardada todavía -- guarda un borrador antes de probar." }, { status: 400 });
    }

    let version = versions[0]!; // más reciente por version_number (listFlowVersions ya ordena desc) -- prioridad DRAFT (spec §8)
    if (typeof body.versionId === "string") {
      const found = versions.find((v) => v.id === body.versionId);
      // No distinguir "no existe" de "es de otro flow/tenant" -- mismo
      // criterio de no revelar existencia cross-tenant del resto de la API.
      if (!found) return Response.json({ error: "Versión no encontrada" }, { status: 404 });
      version = found;
    }

    let definition;
    try {
      definition = parseFlowDefinition(version.definition_json);
    } catch {
      return Response.json({ error: "La definición guardada de esta versión no es válida" }, { status: 500 });
    }

    // Validación server-side OBLIGATORIA con el MISMO validador que ya usa
    // POST /validate (validateFlowForPublish, lib/flow/validate-publish.ts)
    // -- nunca se reimplementa esta regla. Nunca se ejecuta el motor sobre un
    // flow con errores bloqueantes, sin importar lo que haya validado el
    // frontend antes de llamar acá (spec §23, defensa en profundidad).
    const validation = validateFlowForPublish(version.definition_json);
    if (!validation.valid) {
      return Response.json(
        {
          error: "Este flow tiene errores que deben corregirse antes de simular.",
          validation,
          versionId: version.id,
          versionNumber: version.version_number,
        },
        { status: 422 },
      );
    }

    const registryInput: RunSimulationTurnInput = {
      flow: definition,
      engineState,
      event,
      registry: createSimulatedExecutorRegistry(overrides),
      tenantId: miembro.tenantId,
      initialVariables,
      flowId,
      flowVersionId: version.id,
    };

    const turn = await runSimulationTurn(registryInput);

    return Response.json({ versionId: version.id, versionNumber: version.version_number, turn });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
