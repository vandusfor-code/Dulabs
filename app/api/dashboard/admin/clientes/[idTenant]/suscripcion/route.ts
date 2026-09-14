import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";
import {
  cancelarSuscripcion,
  reactivarSuscripcion,
  cambiarPlanSuscripcion,
  activarSuscripcionManual,
} from "@/lib/suscripcion-domain";
import { PLANES } from "@/lib/planes";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- acciones de billing desde el
// Panel de Operaciones (Fases 11/12/13). Reutiliza EXACTAMENTE la misma
// lógica de dominio de F14/F14.2 (lib/suscripcion-domain.ts) -- ninguna
// regla de precio/familia/idempotencia/concurrencia se reimplementa acá
// (Fase 31 del pedido). El precio y el plan SIEMPRE se resuelven del lado
// del servidor; el body nunca puede fijar un monto.
export async function GET(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  const { data: suscripcion, error } = await supabase
    .from("dulabs_suscripciones")
    .select("*")
    .eq("id_tenant", idTenant)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: pagos } = await supabase
    .from("dulabs_pagos")
    .select("id, monto_cop, estado, tipo, plan, created_at")
    .eq("id_tenant", idTenant)
    .order("created_at", { ascending: false })
    .limit(20);
  const { data: historialPlanes } = await supabase
    .from("dulabs_historial_planes")
    .select("plan_anterior, plan_nuevo, precio_anterior_cop, precio_nuevo_cop, motivo, created_at")
    .eq("id_tenant", idTenant)
    .order("id", { ascending: false })
    .limit(20);

  return Response.json({ suscripcion, pagos: pagos ?? [], historialPlanes: historialPlanes ?? [] });
}

type Body = {
  accion?: "activar" | "cancelar" | "reactivar" | "cambiar_plan";
  plan?: string;
  precio_cop?: number;
  motivo?: string;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;
  const operadorEmail = (await supabase.auth.admin.getUserById(acceso.miembro.userId)).data.user?.email ?? null;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.accion === "cancelar") {
    const r = await cancelarSuscripcion(supabase, idTenant);
    await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, operadorEmail, accion: "CANCEL_SUBSCRIPTION", idTenant, resultado: r.ok ? "ok" : "error", motivo: r.ok ? body.motivo : r.error });
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json({ success: true, ...r.data });
  }

  if (body.accion === "reactivar") {
    const r = await reactivarSuscripcion(supabase, idTenant);
    await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, operadorEmail, accion: "ACTIVATE_SUBSCRIPTION", idTenant, resultado: r.ok ? "ok" : "error", motivo: r.ok ? body.motivo : r.error });
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json({ success: true, ...r.data });
  }

  if (body.accion === "cambiar_plan") {
    const r = await cambiarPlanSuscripcion(supabase, {
      idTenant,
      planDestino: body.plan ?? "",
      actorUserId: acceso.miembro.userId,
      motivo: body.motivo ?? "Cambio de plan (Panel de Operaciones)",
    });
    await registrarAuditoriaAdmin(supabase, {
      operador: acceso.miembro,
      operadorEmail,
      accion: "CHANGE_PLAN",
      idTenant,
      resultado: r.ok ? "ok" : "error",
      motivo: r.ok ? body.motivo ?? null : r.error,
      metadata: { plan_destino: body.plan },
    });
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json({ success: true, ...r.data });
  }

  if (body.accion === "activar") {
    if (!body.plan || !(body.plan in PLANES)) return Response.json({ error: "Plan inválido" }, { status: 400 });
    const { data: authUser } = await supabase.auth.admin.getUserById(idTenant);
    const correo = authUser?.user?.email;
    if (!correo) return Response.json({ error: "No se encontró el correo del cliente" }, { status: 404 });
    const precioCop = body.precio_cop ?? PLANES[body.plan as keyof typeof PLANES].precioCop ?? 0;
    const r = await activarSuscripcionManual(supabase, {
      idTenant,
      plan: body.plan,
      precioCop,
      correo,
      operador: operadorEmail,
      motivo: body.motivo ?? "Activación manual (Panel de Operaciones)",
    });
    await registrarAuditoriaAdmin(supabase, {
      operador: acceso.miembro,
      operadorEmail,
      accion: "ACTIVATE_SUBSCRIPTION",
      idTenant,
      resultado: r.ok ? "ok" : "error",
      motivo: r.ok ? body.motivo ?? null : r.error,
      metadata: { plan: body.plan, precio_cop: precioCop },
    });
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json({ success: true, suscripcion: r.data.suscripcion });
  }

  return Response.json({ error: "Acción inválida. Usa 'activar', 'cancelar', 'reactivar' o 'cambiar_plan'." }, { status: 400 });
}
