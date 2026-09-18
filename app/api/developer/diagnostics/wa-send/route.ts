import type { NextRequest } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { inspeccionarPlantillaDulabs, estructuraPlantillaDulabs, enviarTemplateDulabs } from "@/lib/developer/dulabs-whatsapp";

// Diagnóstico de envío de WhatsApp de DuLabs (autorizado -- cierre de la
// verificación E2E de bienvenida). Protegido por DIAGNOSTICS_SECRET (Bearer),
// comparación en tiempo constante. NUNCA expone el token de Meta.
//   GET  ?template=bienvenida_2         -> inspecciona (status/idioma/nº vars).
//   POST { to, template?, params? }     -> envía la plantilla al destino dado y
//                                          devuelve el resultado real de Meta
//                                          (motivo + detalle), para verificar con
//                                          un número receptor válido (≠ emisor).

export const runtime = "nodejs";

function claveValida(recibida: string | null, esperada: string | undefined): boolean {
  if (!recibida || !esperada) return false;
  const a = createHash("sha256").update(recibida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

function autorizado(request: NextRequest): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  return claveValida(bearer, process.env.DIAGNOSTICS_SECRET);
}

function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return new Response("Forbidden", { status: 403 });
  const template = request.nextUrl.searchParams.get("template") || "bienvenida_2";
  const sb = admin();
  const [insp, estructura] = await Promise.all([
    inspeccionarPlantillaDulabs(sb, template),
    estructuraPlantillaDulabs(sb, template),
  ]);
  return Response.json({ template, inspeccion: insp, estructura });
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) return new Response("Forbidden", { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { to?: string; template?: string; params?: string[] };
  if (!body.to) return Response.json({ ok: false, motivo: "falta_to" }, { status: 400 });
  const template = body.template || "bienvenida_2";
  const params = Array.isArray(body.params) ? body.params : ["cliente"];
  const r = await enviarTemplateDulabs(admin(), { nombrePlantilla: template, idioma: "es_CO", destinoE164: body.to, params });
  // enviarTemplateDulabs usa el idioma REAL de la plantilla; el resultado
  // incluye motivo + detalle (error exacto de Meta) sin exponer el token.
  return Response.json({ ok: r.enviado, resultado: r });
}
