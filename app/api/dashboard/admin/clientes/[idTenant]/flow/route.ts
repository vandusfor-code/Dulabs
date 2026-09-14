import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";
import { activarFlowParaNumero, desactivarFlowParaNumero, FlowActivationCheckViolationError } from "@/lib/flow/flow-activation";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- control operacional de Flow
// desde el Panel de Operaciones: consultar estado + activar/desactivar,
// reutilizando EXACTAMENTE las mismas funciones de dominio que ya usan
// app/api/flows/[id]/activate|deactivate/route.ts (lib/flow/flow-activation.ts)
// -- nunca se construye edición visual de Flow acá (eso sigue siendo del
// Builder, tal como pide la Fase 9 del pedido).
export async function GET(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  const { data: numeros, error } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, nombre_negocio, flow_activo, flow_id, ia_pausada")
    .eq("id_tenant", idTenant);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const flowIds = [...new Set((numeros ?? []).map((n) => n.flow_id).filter((id): id is string => Boolean(id)))];
  const flowsPorId = new Map<string, { name: string; status: string }>();
  if (flowIds.length > 0) {
    const { data: flows } = await supabase.from("dulabs_flows").select("id, name, status").in("id", flowIds);
    for (const f of flows ?? []) flowsPorId.set(f.id, { name: f.name, status: f.status });
  }

  // Última ejecución + si hubo fallos recientes, por número -- Fase 9
  // ("ver errores; ver últimas ejecuciones"). dulabs_flow_executions no
  // tiene columna de mensaje de error (ver auditoría de esta fase); status
  // 'failed' es la única señal real disponible.
  const phoneNumberIds = (numeros ?? []).map((n) => n.phone_number_id);
  const ultimaEjecucionPorNumero = new Map<string, { status: string; last_activity_at: string }>();
  if (phoneNumberIds.length > 0) {
    const { data: ejecuciones } = await supabase
      .from("dulabs_flow_executions")
      .select("phone_number_id, status, last_activity_at")
      .in("phone_number_id", phoneNumberIds)
      .order("last_activity_at", { ascending: false })
      .limit(500);
    for (const e of ejecuciones ?? []) {
      if (!ultimaEjecucionPorNumero.has(e.phone_number_id)) {
        ultimaEjecucionPorNumero.set(e.phone_number_id, { status: e.status, last_activity_at: e.last_activity_at });
      }
    }
  }

  return Response.json({
    numeros: (numeros ?? []).map((n) => ({
      phoneNumberId: n.phone_number_id,
      nombreNegocio: n.nombre_negocio,
      flowActivo: n.flow_activo,
      flowId: n.flow_id,
      iaPausada: n.ia_pausada,
      flow: n.flow_id ? flowsPorId.get(n.flow_id) ?? null : null,
      ultimaEjecucion: ultimaEjecucionPorNumero.get(n.phone_number_id) ?? null,
    })),
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  let body: { phone_number_id?: string; flow_id?: string; accion?: "activar" | "desactivar" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, flow_id, accion } = body;
  if (!phone_number_id || !flow_id || (accion !== "activar" && accion !== "desactivar")) {
    return Response.json({ error: "Faltan 'phone_number_id', 'flow_id' o 'accion' (activar|desactivar)" }, { status: 400 });
  }

  try {
    if (accion === "activar") {
      const { data: flow } = await supabase.from("dulabs_flows").select("id, status").eq("id", flow_id).eq("tenant_id", idTenant).maybeSingle();
      if (!flow) return Response.json({ error: "Flow no encontrado para este cliente" }, { status: 404 });
      if (flow.status !== "published") {
        return Response.json({ error: `El Flow debe estar publicado para activarse (estado actual: ${flow.status})` }, { status: 400 });
      }
      const r = await activarFlowParaNumero(supabase, { tenantId: idTenant, flowId: flow_id, phoneNumberId: phone_number_id });
      if (!r.ok) {
        await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, accion: "ACTIVATE_FLOW", idTenant, recurso: phone_number_id, resultado: "error", motivo: r.reason });
        return Response.json({ error: "Número no encontrado para este cliente" }, { status: 404 });
      }
      await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, accion: "ACTIVATE_FLOW", idTenant, recurso: phone_number_id, metadata: { flow_id } });
      return Response.json({ success: true });
    }

    const r = await desactivarFlowParaNumero(supabase, { tenantId: idTenant, flowId: flow_id, phoneNumberId: phone_number_id });
    if (!r.ok) {
      await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, accion: "DEACTIVATE_FLOW", idTenant, recurso: phone_number_id, resultado: "error", motivo: r.reason });
      return Response.json({ error: r.reason === "numero_no_encontrado" ? "Número no encontrado para este cliente" : "Ese Flow no está activo en este número" }, { status: r.reason === "numero_no_encontrado" ? 404 : 400 });
    }
    await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, accion: "DEACTIVATE_FLOW", idTenant, recurso: phone_number_id, metadata: { flow_id } });
    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof FlowActivationCheckViolationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    const mensaje = err instanceof Error ? err.message : String(err);
    await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, accion: accion === "activar" ? "ACTIVATE_FLOW" : "DEACTIVATE_FLOW", idTenant, recurso: phone_number_id, resultado: "error", motivo: mensaje });
    return Response.json({ error: mensaje }, { status: 500 });
  }
}
