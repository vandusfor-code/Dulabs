import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { createFlowTrigger, getFlowById, listFlowTriggers } from "@/lib/flow/flow-store";
import { buildTriggerConfig, TRIGGER_TYPES } from "@/lib/flow-triggers/types";

export const runtime = "nodejs";

// Lista TODOS los triggers del Flow (incluye deshabilitados -- el Builder
// debe poder mostrarlos/editarlos). Mismo rol que GET /versions (admin+agente).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin", "agente"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, id);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    const triggers = await listFlowTriggers(supabase, { tenantId: miembro.tenantId, flowId: id });
    return Response.json({ triggers });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}

// Crea un trigger. `config` se valida con buildTriggerConfig -- la MISMA
// función pura que usa el Router para reconstruir un TriggerConfig desde una
// fila real (lib/flow-triggers/types.ts) -- nunca dos validaciones distintas
// para la misma forma de dato. Mismo rol que POST /versions (solo admin).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  let body: { type?: unknown; config?: unknown; priority?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (typeof body.type !== "string" || !TRIGGER_TYPES.includes(body.type as (typeof TRIGGER_TYPES)[number])) {
    return Response.json({ error: `'type' inválido -- valores permitidos: ${TRIGGER_TYPES.join(", ")}` }, { status: 400 });
  }
  const config = buildTriggerConfig(body.type, body.config);
  if (!config) {
    return Response.json({ error: `'config' inválido para el tipo de trigger '${body.type}'` }, { status: 400 });
  }
  if (body.priority !== undefined && typeof body.priority !== "number") {
    return Response.json({ error: "'priority' debe ser numérico" }, { status: 400 });
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return Response.json({ error: "'enabled' debe ser booleano" }, { status: 400 });
  }

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, id);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    const trigger = await createFlowTrigger(supabase, {
      tenantId: miembro.tenantId,
      flowId: id,
      config,
      priority: body.priority as number | undefined,
      enabled: body.enabled as boolean | undefined,
      createdBy: miembro.userId,
    });
    return Response.json({ trigger }, { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
