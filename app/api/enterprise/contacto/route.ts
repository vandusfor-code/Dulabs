import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { guardarLeadEnterprise, notificarLeadEnterprise, type LeadEnterprise } from "@/lib/enterprise-leads";

export const runtime = "nodejs";

// Formulario de contacto Enterprise de la landing -- público, sin sesión
// (es un visitante nuevo pidiendo que lo contactemos). Nunca falla "raro"
// hacia el visitante: valida lo mínimo y siempre responde algo claro.
export async function POST(request: NextRequest) {
  let body: Partial<LeadEnterprise>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const nombre = String(body.nombre ?? "").trim();
  const empresa = String(body.empresa ?? "").trim();
  const correo = String(body.correo ?? "").trim();
  const telefono = String(body.telefono ?? "").trim();
  const necesidad = String(body.necesidad ?? "").trim();
  const detalle = String(body.detalle ?? "").trim();

  if (!nombre || !empresa || !correo || !necesidad) {
    return Response.json({ error: "Faltan datos: nombre, empresa, correo y qué necesitas son obligatorios." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return Response.json({ error: "El correo no parece válido." }, { status: 400 });
  }

  const lead: LeadEnterprise = { nombre, empresa, correo, telefono, necesidad, detalle };

  const supabase = supabaseAdmin();
  await guardarLeadEnterprise(supabase, lead);
  await notificarLeadEnterprise(lead);

  return Response.json({ success: true });
}
