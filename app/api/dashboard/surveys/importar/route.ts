import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { descifrarSecreto } from "@/lib/crypto";
import { extraerTexto, TAMANO_MAXIMO_BYTES } from "@/lib/archivo-texto";
import { extraerEncuestaDeTexto } from "@/lib/survey-import";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sube un Excel/CSV con preguntas y/o contactos y devuelve una PROPUESTA de
// encuesta (preguntas + destinatarios) interpretada por la IA — para que el
// usuario la revise y edite en el Builder antes de aplicarla. Nunca guarda
// nada por sí sola.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin"])) {
    return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
  }

  const form = await request.formData();
  const archivo = form.get("archivo");
  const phoneNumberId = form.get("phone_number_id");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return Response.json({ error: "Falta el archivo" }, { status: 400 });
  }
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    return Response.json({ error: "El archivo supera el límite de 4 MB" }, { status: 400 });
  }

  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (typeof phoneNumberId === "string" && phoneNumberId) {
    const { data: cliente } = await supabase
      .from("dulabs_clientes_config")
      .select("api_key_ia")
      .eq("phone_number_id", phoneNumberId)
      .eq("id_tenant", miembro.tenantId)
      .maybeSingle();
    if (cliente?.api_key_ia) apiKey = descifrarSecreto(cliente.api_key_ia);
  }
  if (!apiKey) return Response.json({ error: "Sin API key de IA configurada" }, { status: 500 });

  let texto: string;
  try {
    const buffer = Buffer.from(await archivo.arrayBuffer());
    texto = await extraerTexto(archivo, buffer);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "No se pudo leer el archivo" }, { status: 400 });
  }

  try {
    const resultado = await extraerEncuestaDeTexto(texto, apiKey);
    return Response.json(resultado);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "No se pudo interpretar el archivo con IA" },
      { status: 500 }
    );
  }
}
