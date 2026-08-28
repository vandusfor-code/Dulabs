import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { enviarAlertaWhatsApp } from "@/lib/alertas";

export const runtime = "nodejs";
export const maxDuration = 60;

// Red de seguridad, capa 2 (la capa 1 es registrar el mensaje entrante de
// forma síncrona en el webhook -- ver registrarMensajesEntrantesSincrono en
// app/webhook-dulabs/route.ts). Aunque el mensaje ya quede siempre visible,
// puede pasar que igual nadie lo atienda de verdad (el trabajo diferido que
// genera la respuesta falla puntualmente, sin dejar ningún error). Esto
// barre cada pocos minutos (disparado por QStash, mismo mecanismo que
// /api/cron/recordatorios-citas) buscando mensajes entrantes que llevan
// varios minutos sin `procesado_at` -- es decir, nadie los tomó -- y avisa
// por WhatsApp al canal interno de alertas para que un humano los revise.
//
// Ventana 3-30 minutos: menos de 3 min es normal (el procesamiento diferido
// puede tardar unos segundos), más de 30 min ya no aporta avisar de nuevo
// (si nadie ha entrado a revisar en media hora, repetir la alerta cada
// pasada del cron sería puro ruido) -- por eso también se marca
// procesado_at al alertar, para no volver a alertar del mismo mensaje.
const VENTANA_MIN_MIN = 3;
const VENTANA_MAX_MIN = 30;

type MensajeSinResponder = {
  id: number;
  phone_number_id: string;
  telefono_cliente: string;
  contenido: string;
  created_at: string;
};

async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = supabaseAdmin();
  const ahora = Date.now();
  const desde = new Date(ahora - VENTANA_MAX_MIN * 60_000).toISOString();
  const hasta = new Date(ahora - VENTANA_MIN_MIN * 60_000).toISOString();

  const { data, error } = await supabase
    .from("dulabs_mensajes_log")
    .select("id, phone_number_id, telefono_cliente, contenido, created_at")
    .eq("direccion", "entrante")
    .is("procesado_at", null)
    .gte("created_at", desde)
    .lt("created_at", hasta)
    .order("created_at", { ascending: true });

  if (error) {
    // Migración de procesado_at todavía no aplicada: no-op seguro, mismo
    // criterio que recordatorios-citas con recordatorio_enviado.
    return Response.json({ alertados: 0, nota: "no se pudo consultar dulabs_mensajes_log (¿falta correr la migración de procesado_at?)" });
  }

  const pendientes = (data ?? []) as MensajeSinResponder[];
  let alertados = 0;
  const errores: string[] = [];

  // Trae el nombre del negocio de cada número involucrado en un solo viaje.
  const phoneIds = [...new Set(pendientes.map((m) => m.phone_number_id))];
  const nombresPorNumero = new Map<string, string>();
  if (phoneIds.length > 0) {
    const { data: negocios } = await supabase
      .from("dulabs_clientes_config")
      .select("phone_number_id, nombre_negocio")
      .in("phone_number_id", phoneIds);
    for (const n of negocios ?? []) nombresPorNumero.set(n.phone_number_id, n.nombre_negocio);
  }

  for (const mensaje of pendientes) {
    try {
      const negocio = nombresPorNumero.get(mensaje.phone_number_id) ?? mensaje.phone_number_id;
      const texto =
        `⚠️ Du Labs — mensaje sin responder\n\n` +
        `Negocio: ${negocio}\n` +
        `Cliente: ${mensaje.telefono_cliente}\n` +
        `Mensaje: "${mensaje.contenido.slice(0, 200)}"\n\n` +
        `Nadie (ni la IA ni un humano) lo atendió en ${VENTANA_MIN_MIN}+ minutos. Revísalo directamente por WhatsApp.`;
      const enviada = await enviarAlertaWhatsApp(texto);
      if (!enviada) {
        errores.push(`${mensaje.id}: no se pudo enviar la alerta`);
        continue;
      }
      // Marca procesado_at para no volver a alertar de este mismo mensaje --
      // ya quedó en manos de un humano, no es que la IA lo haya respondido.
      await supabase.from("dulabs_mensajes_log").update({ procesado_at: new Date().toISOString() }).eq("id", mensaje.id);
      alertados++;
    } catch (err) {
      errores.push(`${mensaje.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return Response.json({ alertados, errores });
}

export async function GET(request: NextRequest) {
  return manejar(request);
}

export async function POST(request: NextRequest) {
  return manejar(request);
}
