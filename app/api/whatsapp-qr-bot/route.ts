import { timingSafeEqual, createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ejecutarBotWhatsAppQR } from "@/lib/whatsapp-qr-bot";
import { procesarMensajeConAgendaV2 } from "@/lib/agenda-v2/router";
import { procesarEntradaAmore, interceptarAtencionHumanaAmore, interceptarRegistroClienteAmore } from "@/lib/amore-entrada-router";

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

  // ATENCIÓN HUMANA (autorizado, Fase 1) -- gate global, EXCLUSIVO de AMORE,
  // evaluado ANTES que Agenda V2: es la única forma de que (a) una
  // conversación ya en atencion_humana quede en silencio total y (b) una
  // solicitud explícita de hablar con una persona le gane a una sesión
  // Agenda V2 ya activa, sin reordenar ni tocar lib/agenda-v2/router.ts.
  // Cualquier otro tenant, o cualquier mensaje que no aplique, devuelve
  // manejado:false de inmediato -- sigue exactamente el comportamiento de
  // siempre (Agenda V2 -> entrada AMORE -> Flow Engine).
  const resultadoAtencionHumana = await interceptarAtencionHumanaAmore({
    supabase,
    idTenant: body.idTenant,
    telefono: body.telefono,
    texto: body.texto,
    wamid: body.wamid,
  });
  if (resultadoAtencionHumana.manejado) {
    return Response.json({ success: true });
  }

  // REGISTRO DE CLIENTE NUEVO (autorizado, Fase 2) -- gate global, EXCLUSIVO
  // de AMORE, evaluado DESPUÉS de atención humana (que conserva prioridad
  // absoluta) y ANTES de Agenda V2: es la única forma de que un registro ya
  // en curso no pueda saltarse por ninguna de las 3 vías reales de inicio de
  // Agenda V2 (opción "1", TRIGGER_AGENDA de Gemini, o el trigger directo de
  // esInicioDeAgendaV2 dentro de procesarMensajeConAgendaV2). Cualquier otro
  // tenant, o cualquier conversación sin registro en curso, devuelve
  // manejado:false de inmediato -- sigue exactamente el comportamiento de
  // siempre.
  const resultadoRegistroCliente = await interceptarRegistroClienteAmore({
    supabase,
    idTenant: body.idTenant,
    telefono: body.telefono,
    texto: body.texto,
    wamid: body.wamid,
  });
  if (resultadoRegistroCliente.manejado) {
    return Response.json({ success: true });
  }

  // AGENDA V2 (autorizado) -- router de aislamiento: se evalúa ANTES de
  // ejecutarBotWhatsAppQR (Flow Engine). Mientras exista una sesión activa
  // (o este mensaje la inicie), Agenda V2 responde por su cuenta y ESTE
  // mensaje nunca llega al Flow Engine -- ver lib/agenda-v2/router.ts.
  // Cuando no aplica (comportamiento normal de AMORE), sigue exactamente
  // igual que siempre, sin ningún cambio.
  const resultadoAgendaV2 = await procesarMensajeConAgendaV2({
    supabase,
    idTenant: body.idTenant,
    telefono: body.telefono,
    texto: body.texto,
    wamid: body.wamid,
  });
  if (resultadoAgendaV2.manejado) {
    return Response.json({ success: true });
  }

  // AMORE (autorizado, Fase 9) -- puente bienvenida/Gemini -> Agenda V2:
  // se evalúa DESPUÉS de Agenda V2 (que sigue teniendo prioridad absoluta
  // mientras haya una sesión activa) y ANTES de ejecutarBotWhatsAppQR.
  // EXCLUSIVO de AMORE -- ver lib/amore-entrada-router.ts: cualquier otro
  // tenant devuelve manejado:false de inmediato, sin ningún cambio.
  const resultadoEntradaAmore = await procesarEntradaAmore({
    supabase,
    idTenant: body.idTenant,
    telefono: body.telefono,
    texto: body.texto,
    wamid: body.wamid,
  });
  if (resultadoEntradaAmore.manejado) {
    return Response.json({ success: true });
  }

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
