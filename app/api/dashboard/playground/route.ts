import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generarRespuestaIA } from "@/lib/ia";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { resolverConfigAgente } from "@/lib/agentes";
import { historialPlaygroundAHistorialIA } from "@/lib/historial-conversacion";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MENSAJE = 2000;

// Chat de prueba: corre el mismo prompt + base de conocimiento reales del
// agente contra Claude, con historial de la sesión de prueba, sin enviar
// nada por WhatsApp ni tocar el contador de uso.
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
  if (!requireRol(miembro, ["admin", "agente"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  let body: {
    phone_number_id?: string;
    mensaje?: string;
    historial?: { rol: "usuario" | "ia"; texto: string }[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { phone_number_id } = body;
  const mensaje = body.mensaje?.trim();
  if (!phone_number_id || !mensaje) {
    return Response.json({ error: "Faltan 'phone_number_id' o 'mensaje'" }, { status: 400 });
  }
  if (mensaje.length > MAX_MENSAJE) {
    return Response.json({ error: `El mensaje no puede superar ${MAX_MENSAJE} caracteres` }, { status: 400 });
  }

  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("agente_id, prompt_sistema, base_conocimiento, nombre_negocio, api_key_ia, nombre_agente")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const configAgente = await resolverConfigAgente(supabase, cliente);
  const historial = historialPlaygroundAHistorialIA(body.historial ?? []);
  const respuesta = await generarRespuestaIA({ ...configAgente, nombre_negocio: cliente.nombre_negocio }, mensaje, {
    idTenant: miembro.tenantId,
    phoneNumberId: phone_number_id,
  }, historial);
  if (!respuesta) {
    // El fallo real ya quedó clasificado y registrado en dulabs_fallos_ia
    // (ver lib/alertas.ts) — lo leemos para decir la causa concreta en vez
    // de mandar al usuario a "configurar tu API key", una pantalla que no
    // existe en el dashboard.
    const { data: ultimoFallo } = await supabase
      .from("dulabs_fallos_ia")
      .select("tipo")
      .eq("id_tenant", miembro.tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const causas: Record<string, string> = {
      sin_saldo: "El servicio de IA se quedó sin saldo. Ya se notificó al equipo de Du Labs.",
      key_invalida: "La clave del servicio de IA es inválida. Ya se notificó al equipo de Du Labs.",
      sin_key: "Falta configurar el servicio de IA. Ya se notificó al equipo de Du Labs.",
      rate_limit: "El servicio de IA está saturado en este momento. Intenta de nuevo en unos minutos.",
      sobrecarga: "El servicio de IA está sobrecargado en este momento. Intenta de nuevo en unos minutos.",
    };
    const error =
      (ultimoFallo?.tipo && causas[ultimoFallo.tipo]) ??
      "La IA no pudo generar una respuesta. Ya se notificó al equipo de Du Labs.";
    return Response.json({ error }, { status: 500 });
  }

  return Response.json({ respuesta });
}
