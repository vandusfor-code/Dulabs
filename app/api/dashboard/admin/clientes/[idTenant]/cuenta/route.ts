import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- bloqueo/desbloqueo de CUENTA
// (Fase 13/14 del pedido), distinto de suscripción/bot/WhatsApp. No existe
// ningún mecanismo de "cuenta bloqueada" en la arquitectura (auditado esta
// fase: sin ban_duration usado, sin columna cuenta_bloqueada) -- inventar
// uno nuevo habría significado tocar resolverMiembroEquipo (lib/team.ts),
// el punto de resolución de sesión que usan TODAS las rutas autenticadas de
// la app, incluidas las de Daniel/AMORE/etc en cada request real -- un
// riesgo desproporcionado para una feature que hoy nadie usa.
//
// En vez de eso, "bloquear cuenta" reutiliza el mecanismo YA EXISTENTE y ya
// probado de suspensión de miembros (dulabs_miembros_equipo.estado, el
// mismo que ya usa /api/dashboard/equipo PATCH): bloquear = suspender a
// TODOS los miembros activos del tenant de una vez; una cuenta "bloqueada"
// se define, sin ninguna columna nueva, como "tiene miembros pero ninguno
// activo". Desbloquear reactiva a todos los que quedaron suspendidos.
// Límite honesto: si alguien ya estaba suspendido por otro motivo ANTES del
// bloqueo, un desbloqueo posterior también lo reactiva a él -- no se
// guarda un snapshot de "quién estaba activo antes" para no sobreconstruir
// (Fase 26). Documentado en el reporte de esta fase.
export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  let body: { accion?: "bloquear" | "desbloquear"; motivo?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (body.accion !== "bloquear" && body.accion !== "desbloquear") {
    return Response.json({ error: "'accion' debe ser 'bloquear' o 'desbloquear'" }, { status: 400 });
  }

  const estadoOrigen = body.accion === "bloquear" ? "activo" : "suspendido";
  const estadoDestino = body.accion === "bloquear" ? "suspendido" : "activo";

  const { data: afectados, error } = await supabase
    .from("dulabs_miembros_equipo")
    .update({ estado: estadoDestino })
    .eq("tenant_id", idTenant)
    .eq("estado", estadoOrigen)
    .select("id, email");

  await registrarAuditoriaAdmin(supabase, {
    operador: acceso.miembro,
    accion: body.accion === "bloquear" ? "BLOCK_ACCOUNT" : "UNBLOCK_ACCOUNT",
    idTenant,
    resultado: error ? "error" : "ok",
    motivo: error ? error.message : body.motivo ?? null,
    metadata: { miembros_afectados: (afectados ?? []).map((m) => m.id) },
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true, miembros_afectados: (afectados ?? []).length });
}
