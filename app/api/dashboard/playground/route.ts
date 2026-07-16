import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generarRespuestaIA } from "@/lib/ia";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MENSAJE = 2000;

// Chat de prueba: corre el mismo prompt + base de conocimiento reales del
// agente contra Claude, sin enviar nada por WhatsApp ni tocar el historial
// de conversaciones ni el contador de uso — es una prueba, no tráfico real.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }

  let body: { phone_number_id?: string; mensaje?: string };
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
    .select("prompt_sistema, base_conocimiento, nombre_negocio, api_key_ia")
    .eq("phone_number_id", phone_number_id)
    .eq("id_tenant", userData.user.id)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const respuesta = await generarRespuestaIA(cliente, mensaje);
  if (!respuesta) {
    return Response.json({ error: "La IA no pudo generar una respuesta. Revisa que tengas una API key configurada." }, { status: 500 });
  }

  return Response.json({ respuesta });
}
