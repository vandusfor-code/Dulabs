import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { configBotPorToken, guardarRespuestasConfigBot } from "@/lib/config-bot";

export const runtime = "nodejs";

// Sin login, igual que /agenda/[token]: el link ES la autenticación.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const config = await configBotPorToken(supabase, token);
  if (!config) return Response.json({ error: "Link inválido" }, { status: 404 });
  return Response.json({ respuestas: config.respuestas, actualizado_en: config.updated_at });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const existente = await configBotPorToken(supabase, token);
  if (!existente) return Response.json({ error: "Link inválido" }, { status: 404 });

  let body: { respuestas?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.respuestas || typeof body.respuestas !== "object") {
    return Response.json({ error: "Falta 'respuestas'" }, { status: 400 });
  }

  const actualizado = await guardarRespuestasConfigBot(supabase, token, body.respuestas);
  if (!actualizado) return Response.json({ error: "No se pudo guardar" }, { status: 500 });
  return Response.json({ success: true, actualizado_en: actualizado.updated_at });
}
