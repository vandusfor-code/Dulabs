import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- pausar/reactivar la IA de un
// número completo desde el Panel de Operaciones. Reutiliza EXACTAMENTE el
// mismo mecanismo que ya existe para el dueño del negocio
// (dulabs_clientes_config.ia_pausada, ver migración
// 20260716090000_pausar_ia_por_numero.sql y app/api/dashboard/negocio/route.ts)
// -- no se inventa un segundo mecanismo de pausa. Pausar/reactivar NUNCA
// toca flow_activo, flow_id, meta_permanent_token ni ninguna otra columna:
// solo ia_pausada, tal como pide la Fase 8 del pedido ("no borrar Flow, no
// borrar configuración, no desconectar WhatsApp").
export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  let body: { phone_number_id?: string; accion?: "pausar" | "reactivar" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id, accion } = body;
  if (!phone_number_id || (accion !== "pausar" && accion !== "reactivar")) {
    return Response.json({ error: "Faltan 'phone_number_id' o 'accion' (pausar|reactivar)" }, { status: 400 });
  }

  const iaPausada = accion === "pausar";
  const { data: actualizado, error } = await supabase
    .from("dulabs_clientes_config")
    .update({ ia_pausada: iaPausada })
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", idTenant)
    .select("phone_number_id, ia_pausada")
    .maybeSingle();

  if (error) {
    await registrarAuditoriaAdmin(supabase, {
      operador: acceso.miembro,
      operadorEmail: null,
      accion: iaPausada ? "PAUSE_BOT" : "RESUME_BOT",
      idTenant,
      recurso: phone_number_id,
      resultado: "error",
      motivo: error.message,
    });
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!actualizado) return Response.json({ error: "Número no encontrado para este cliente" }, { status: 404 });

  await registrarAuditoriaAdmin(supabase, {
    operador: acceso.miembro,
    accion: iaPausada ? "PAUSE_BOT" : "RESUME_BOT",
    idTenant,
    recurso: phone_number_id,
    resultado: "ok",
  });

  return Response.json({ success: true, phone_number_id: actualizado.phone_number_id, ia_pausada: actualizado.ia_pausada });
}
