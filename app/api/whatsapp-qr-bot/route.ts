import { timingSafeEqual, createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ejecutarBotWhatsAppQR } from "@/lib/whatsapp-qr-bot";

export const runtime = "nodejs";

// Bot real para WhatsApp-QR (autorizado) — ÚNICA ruta que el worker llama
// hacia Next.js (dirección nueva; hasta esta fase Next.js solo llamaba AL
// worker). Autenticada con el MISMO secreto compartido de siempre
// (WHATSAPP_WORKER_SECRET), comparación en tiempo constante -- mismo
// patrón que worker/src/auth.ts y app/api/diagnostics/token-status.
function claveValida(recibida: string | null, esperada: string | undefined): boolean {
  if (!recibida || !esperada) return false;
  const a = createHash("sha256").update(recibida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

function extraerBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = /^Bearer (.+)$/.exec(authHeader);
  return match ? match[1] : null;
}

export async function POST(request: NextRequest) {
  const recibida = extraerBearer(request.headers.get("authorization"));
  if (!claveValida(recibida, process.env.WHATSAPP_WORKER_SECRET)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { idTenant?: string; telefono?: string; texto?: string; wamid?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.idTenant || !body.telefono || !body.texto || !body.wamid) {
    return Response.json({ error: "Faltan idTenant/telefono/texto/wamid" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const resultado = await ejecutarBotWhatsAppQR({
    supabase,
    idTenant: body.idTenant,
    telefono: body.telefono,
    texto: body.texto,
    wamid: body.wamid,
  });
  if (!resultado.ok) return Response.json({ error: resultado.motivo }, { status: 422 });
  return Response.json({ success: true });
}
