import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { deleteFlowTrigger, getFlowById, getFlowTrigger, updateFlowTrigger } from "@/lib/flow/flow-store";
import { buildTriggerConfig } from "@/lib/flow-triggers/types";

export const runtime = "nodejs";

// `type` es inmutable -- solo config/priority/enabled. Cambiar de tipo
// (ej. keyword -> event) dejaría `config` con forma inválida para el tipo
// nuevo; el flujo correcto es DELETE + POST de un trigger nuevo.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; triggerId: string }> }) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id, triggerId } = await params;

  let body: { config?: unknown; priority?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
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

    const existente = await getFlowTrigger(supabase, { tenantId: miembro.tenantId, flowId: id, triggerId });
    if (!existente) return Response.json({ error: "Trigger no encontrado" }, { status: 404 });

    let config;
    if (body.config !== undefined) {
      config = buildTriggerConfig(existente.type, body.config);
      if (!config) {
        return Response.json({ error: `'config' inválido para el tipo de trigger '${existente.type}'` }, { status: 400 });
      }
    }

    const trigger = await updateFlowTrigger(supabase, {
      tenantId: miembro.tenantId,
      flowId: id,
      triggerId,
      config,
      priority: body.priority as number | undefined,
      enabled: body.enabled as boolean | undefined,
    });
    if (!trigger) return Response.json({ error: "Trigger no encontrado" }, { status: 404 });
    return Response.json({ trigger });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; triggerId: string }> }) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id, triggerId } = await params;

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, id);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    const eliminado = await deleteFlowTrigger(supabase, { tenantId: miembro.tenantId, flowId: id, triggerId });
    if (!eliminado) return Response.json({ error: "Trigger no encontrado" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
