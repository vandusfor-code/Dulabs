import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo } from "@/lib/team";
import { obtenerCreditosMasivos } from "@/lib/campanas-creditos";

export const runtime = "nodejs";

// Saldo de mensajes masivos de cortesía del tenant autenticado -- lo
// consume app/dashboard/campanas/page.tsx para mostrar el contador y
// bloquear el botón de enviar antes de siquiera llegar al backend de envío
// (que igual vuelve a validar todo, ver app/api/campanas/enviar/route.ts).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!miembro) return Response.json({ error: "No tienes acceso" }, { status: 403 });

  const creditos = await obtenerCreditosMasivos(supabase, miembro.tenantId);
  // null = el tenant nunca tuvo un paquete/cortesía asignado -- distinto de
  // "0 disponibles". El frontend decide cómo mostrarlo (ej. no bloquear si
  // este tenant no está sujeto a límite todavía).
  return Response.json({ creditos });
}
