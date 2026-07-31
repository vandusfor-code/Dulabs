import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { descifrarSecreto } from "@/lib/crypto";
import { extraerTexto, cargarLibroExcel, TAMANO_MAXIMO_BYTES } from "@/lib/archivo-texto";
import { extraerEncuestaDeTexto, parseEncuestaEstructurada } from "@/lib/survey-import";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sube un archivo con preguntas y/o contactos y devuelve una PROPUESTA de
// encuesta para que el usuario la revise y edite en el Builder antes de
// aplicarla — nunca guarda nada por sí sola.
//
// Dos caminos: si el .xlsx sigue el formato oficial (hojas "Preguntas"/
// "Contactos", ver lib/survey-import.ts y public/plantillas/encuesta-plantilla.xlsx)
// se lee por columnas fijas — determinista, sin IA, no necesita API key.
// Si no coincide (archivo libre/desordenado), se interpreta con IA.
//
// Todo el cuerpo va envuelto en un try/catch de nivel superior: cualquier
// excepción no prevista debe devolver JSON igual, nunca la página de error
// HTML de la plataforma (el navegador no puede parsear eso y el usuario solo
// ve "Unexpected token '<'... is not valid JSON" sin pista real del problema).
export async function POST(request: NextRequest) {
  try {
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

    const buffer = Buffer.from(await archivo.arrayBuffer());

    // 1. Formato oficial: hojas "Preguntas"/"Contactos" por columnas fijas.
    try {
      const libro = await cargarLibroExcel(archivo.name, buffer);
      if (libro) {
        const estructurado = parseEncuestaEstructurada(libro);
        if (estructurado) return Response.json(estructurado);
      }
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : "No se pudo leer el archivo" }, { status: 400 });
    }

    // 2. Archivo libre/desordenado: interpretación por IA.
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
    if (!apiKey) {
      return Response.json(
        { error: "El archivo no sigue el formato oficial (hojas 'Preguntas'/'Contactos') y no hay una API key de IA configurada para interpretarlo de otra forma." },
        { status: 400 }
      );
    }

    let texto: string;
    try {
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
  } catch (err) {
    console.error("[surveys/importar] error inesperado:", err instanceof Error ? err.stack ?? err.message : err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Error inesperado importando el archivo" },
      { status: 500 }
    );
  }
}
