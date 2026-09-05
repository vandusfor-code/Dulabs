import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { clienteDeEspecialista } from "@/lib/especialistas-notificar";
import { enviarWhatsApp } from "@/lib/whatsapp-outbound";
import { MENSAJE_SEGUIMIENTO_SIN_RESPUESTA, DURACION_SEGUIMIENTO_MS } from "@/lib/asistente-daniela-ia";
import type { ClienteConfig } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

type PausaPendiente = { id: number; phone_number_id: string; telefono_cliente: string };

/**
 * Fase 7 (asistente conversacional de Daniela) — disparado periódicamente
 * por QStash (mismo mecanismo que /api/cron/recordatorios-citas -- ver
 * lib/cron-auth.ts). Pensado para correr cada ~2-3 minutos.
 *
 * Busca pausas de chat (dulabs_pausas_chat) activadas hace más de 5 minutos
 * que todavía siguen vigentes (pausado_hasta en el futuro) y a las que
 * todavía no se les envió el mensaje de seguimiento. Si Daniela respondió
 * manualmente mientras tanto, activarPausaChat() ya refrescó
 * pausado_desde/seguimiento_enviado para esa fila (ver lib/pausas-chat.ts),
 * así que esta consulta simplemente deja de encontrarla -- sin ninguna
 * lógica extra de "cancelar seguimiento".
 *
 * NO wired a ningún schedule de QStash todavía en esta fase (eso es un paso
 * de despliegue, fuera del alcance de "no deploy" de la Fase 7) -- el
 * endpoint queda listo para activarse cuando corresponda.
 *
 * `soloPhoneNumberId` (nuevo, tras el incidente real de pruebas de esta
 * fase): restringe el barrido a un único phone_number_id. La ruta HTTP real
 * NUNCA lo pasa (el cron de producción debe barrer TODA la tabla) -- existe
 * exclusivamente para que las pruebas puedan invocar esta MISMA función real
 * sin poder tocar jamás una fila de otro número, sin importar qué datos
 * reales existan en la tabla en ese momento. Ver route.test.ts.
 */
export async function ejecutarSeguimientoTraspaso(
  supabase: SupabaseClient,
  opts?: { soloPhoneNumberId?: string }
): Promise<{ enviados: number; errores: string[]; nota?: string }> {
  const ahora = new Date();
  const limite = new Date(ahora.getTime() - DURACION_SEGUIMIENTO_MS);

  let query = supabase
    .from("dulabs_pausas_chat")
    .select("id, phone_number_id, telefono_cliente")
    .eq("seguimiento_enviado", false)
    .lte("pausado_desde", limite.toISOString())
    .gt("pausado_hasta", ahora.toISOString());
  if (opts?.soloPhoneNumberId) query = query.eq("phone_number_id", opts.soloPhoneNumberId);

  const { data: pausas, error } = await query;

  if (error) {
    // Migración de pausado_desde/seguimiento_enviado todavía no aplicada:
    // no-op seguro, mismo criterio que recordatorios-citas.
    return { enviados: 0, errores: [], nota: "no se pudo consultar dulabs_pausas_chat (¿falta correr la migración de seguimiento?)" };
  }

  let enviados = 0;
  const errores: string[] = [];
  const clientesCache = new Map<string, ClienteConfig | null>();

  for (const pausa of (pausas ?? []) as PausaPendiente[]) {
    try {
      if (!clientesCache.has(pausa.phone_number_id)) {
        clientesCache.set(pausa.phone_number_id, await clienteDeEspecialista(supabase, pausa.phone_number_id));
      }
      const cliente = clientesCache.get(pausa.phone_number_id) ?? null;
      if (!cliente) {
        errores.push(`${pausa.id}: sin configuración de cliente para ${pausa.phone_number_id}`);
        continue;
      }

      await enviarWhatsApp(supabase, cliente, pausa.telefono_cliente, MENSAJE_SEGUIMIENTO_SIN_RESPUESTA);
      await supabase.from("dulabs_pausas_chat").update({ seguimiento_enviado: true }).eq("id", pausa.id);
      enviados++;
    } catch (err) {
      errores.push(`${pausa.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { enviados, errores };
}

async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const resultado = await ejecutarSeguimientoTraspaso(supabaseAdmin());
  return Response.json(resultado);
}

export async function GET(request: NextRequest) {
  return manejar(request);
}

export async function POST(request: NextRequest) {
  return manejar(request);
}
