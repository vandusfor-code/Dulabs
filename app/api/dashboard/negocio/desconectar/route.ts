import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { desconectarNumeroWhatsapp } from "@/lib/whatsapp-connection-lifecycle";

export const runtime = "nodejs";

/**
 * Fase 8.5 (Connection Lifecycle, autorizado) — disconnect REVERSIBLE,
 * distinto y separado de DELETE /api/dashboard/negocio (política de
 * eliminación de datos de Meta, irreversible a propósito: esa ruta NO se
 * tocó ni se reutilizó acá). Invalida solo la credencial de Meta y marca
 * estado_conexion='desconectado' -- Flow, historial, contactos, tags,
 * custom fields, agentes, integraciones y campañas quedan intactos (ver
 * lib/whatsapp-connection-lifecycle.ts). Reconectar es simplemente volver a
 * pasar por Embedded Signup (app/api/auth/meta-callback), que ya reconoce
 * este número como reconexión.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  let body: { phone_number_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id } = body;
  if (!phone_number_id) {
    return Response.json({ error: "Falta 'phone_number_id'" }, { status: 400 });
  }

  const resultado = await desconectarNumeroWhatsapp(supabase, { tenantId: miembro.tenantId, phoneNumberId: phone_number_id });

  if (!resultado.ok) {
    if (resultado.motivo === "no_encontrado") return Response.json({ error: "Número no encontrado" }, { status: 404 });
    // Nunca se expone el mensaje crudo de Postgres al cliente -- solo se
    // loguea server-side (sin secretos: el error de Postgres no contiene
    // ningún token, solo detalles de la query).
    console.error("[negocio/desconectar] error en la base de datos:", resultado.mensaje);
    return Response.json({ error: "No se pudo desconectar el número" }, { status: 500 });
  }

  if (resultado.migracionPendiente) {
    // Ver escribirToleranteAColumnaFaltante -- la credencial SÍ quedó
    // invalidada (comportamiento real de disconnect), pero el estado
    // explícito 'desconectado' todavía no puede persistirse porque falta
    // aplicar la migración 20260928000000. No es un error del usuario, así
    // que igual se responde success -- solo se loguea para operaciones.
    console.warn(
      "[negocio/desconectar] migración 20260928000000_dulabs_estado_conexion todavía no aplicada -- credencial invalidada, estado_conexion no persistido",
    );
  }

  return Response.json({ success: true, estado_conexion: "desconectado" });
}
