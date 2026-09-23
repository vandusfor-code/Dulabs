/**
 * Pipeline ÚNICO de un mensaje entrante de WhatsApp-QR (worker -> Next.js). Antes vivía inline en
 * app/api/whatsapp-qr-bot/route.ts: ningún test podía ejercitar la conversación completa en el MISMO orden que
 * producción, y una prueba que reimplementara ese orden podía divergir sin que nadie lo notara. Ahora la ruta y los
 * tests de conversación llaman a esta misma función; el orden y el comportamiento son idénticos a los de antes.
 *
 * Orden (el primero que maneja el mensaje corta):
 *   1. atención humana (AMORE)   -- silencio total mientras una persona atiende / solicitud explícita de humano
 *   2. registro de cliente (AMORE) -- un registro en curso nunca se puede saltar
 *   3. compra de producto (AMORE)  -- intención inequívoca de compra
 *   4. Agenda V2                   -- dueña absoluta de la conversación mientras haya una sesión activa
 *   5. entrada AMORE (Gemini)      -- bienvenida, consultas con datos reales, puente a Agenda V2
 *   6. Flow Engine                 -- resto de tenants
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ejecutarBotWhatsAppQR } from "@/lib/whatsapp-qr-bot";
import { procesarMensajeConAgendaV2, type AgendaV2RouterDeps } from "@/lib/agenda-v2/router";
import {
  procesarEntradaAmore,
  interceptarAtencionHumanaAmore,
  interceptarRegistroClienteAmore,
  interceptarCompraProductoAmore,
  type AmoreEntradaDeps,
  type InterceptarAtencionHumanaDeps,
  type InterceptarRegistroClienteDeps,
  type InterceptarCompraProductoDeps,
} from "@/lib/amore-entrada-router";

export type CapaPipeline = "atencion_humana" | "registro_cliente" | "compra_producto" | "agenda_v2" | "entrada_amore" | "flow_engine";

export type ResultadoPipelineWhatsAppQR = { ok: true; manejadoPor: CapaPipeline } | { ok: false; motivo: string };

/** Inyectables SOLO para tests -- en producción cada capa usa sus dependencias reales. */
export interface DepsPipelineWhatsAppQR {
  atencionHumana?: InterceptarAtencionHumanaDeps;
  registroCliente?: InterceptarRegistroClienteDeps;
  compraProducto?: InterceptarCompraProductoDeps;
  agendaV2?: AgendaV2RouterDeps;
  entradaAmore?: AmoreEntradaDeps;
  ejecutarBot?: typeof ejecutarBotWhatsAppQR;
}

export async function atenderMensajeWhatsAppQR(
  params: { supabase: SupabaseClient; idTenant: string; telefono: string; texto: string; wamid: string },
  deps: DepsPipelineWhatsAppQR = {},
): Promise<ResultadoPipelineWhatsAppQR> {
  if ((await interceptarAtencionHumanaAmore(params, deps.atencionHumana)).manejado) return { ok: true, manejadoPor: "atencion_humana" };
  if ((await interceptarRegistroClienteAmore(params, deps.registroCliente)).manejado) return { ok: true, manejadoPor: "registro_cliente" };
  if ((await interceptarCompraProductoAmore(params, deps.compraProducto)).manejado) return { ok: true, manejadoPor: "compra_producto" };
  if ((await procesarMensajeConAgendaV2(params, deps.agendaV2)).manejado) return { ok: true, manejadoPor: "agenda_v2" };
  if ((await procesarEntradaAmore(params, deps.entradaAmore)).manejado) return { ok: true, manejadoPor: "entrada_amore" };

  const resultado = await (deps.ejecutarBot ?? ejecutarBotWhatsAppQR)(params);
  return resultado.ok ? { ok: true, manejadoPor: "flow_engine" } : { ok: false, motivo: resultado.motivo };
}
