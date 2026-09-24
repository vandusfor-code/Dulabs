import type { SupabaseClient } from "@supabase/supabase-js";

// --- Human takeover: fuente de verdad de "¿la IA puede responder?" ----------
//
// Una fila en dulabs_pausas_chat con pausado_hasta > ahora significa que un
// HUMANO tomó ESTA conversación (handoff explícito del Inbox, eco del dueño
// respondiendo desde su celular, o traspaso que el propio Flow decidió) y la
// IA NO debe responder por ninguna vía automática. Es EXACTAMENTE el mismo
// criterio que ya usaban, por separado, el gate de recepción del webhook
// (app/webhook-dulabs/route.ts) y readPausaUntil del executor-factory --
// centralizado acá para que TODAS las barreras (el gate de recepción y la
// última barrera justo antes de enviar) consulten la MISMA verdad y no puedan
// divergir en silencio. "Humano tiene prioridad absoluta sobre la IA."
export async function chatEnPausaHumana(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("dulabs_pausas_chat")
    .select("pausado_hasta")
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .maybeSingle();
  if (error) {
    // Fail-open DELIBERADO ante un error de lectura: mismo comportamiento que
    // ya tenía el gate de recepción (loguea y sigue), para no introducir una
    // regresión nueva donde un error transitorio de DB silencie a la IA. La
    // carrera real que este guard cierra es una LECTURA EXITOSA que devuelve
    // la fila de pausa recién escrita por el takeover -- no un error de red.
    console.error("[pausas-chat] error consultando pausa (chatEnPausaHumana):", error.message);
    return false;
  }
  return !!data && new Date(data.pausado_hasta as string).getTime() > Date.now();
}

// Observabilidad: se registra cuando una respuesta automática de la IA se
// cancela porque un humano tomó la conversación. Sin prompts, sin secretos,
// sin tokens, sin contenido del mensaje -- solo lo mínimo para diagnosticar
// (tenant, conversación, etapa donde se bloqueó, referencia del mensaje/nodo).
export function logIaBloqueadaPorHumano(info: {
  etapa: string;
  phoneNumberId: string;
  telefonoCliente: string;
  tenantId?: string;
  referencia?: string;
}): void {
  console.log(
    `[pausas-chat] AI_RESPONSE_BLOCKED_HUMAN_TAKEOVER etapa=${info.etapa} tenant=${info.tenantId ?? "?"} phone=${info.phoneNumberId} chat=${info.telefonoCliente}${info.referencia ? ` ref=${info.referencia}` : ""} at=${new Date().toISOString()}`,
  );
}

export type ActivarPausaChatResult =
  | { ok: true; pausadoHasta: string }
  | { ok: false; error: string };

// Pausa la IA para UN chat puntual (no todo el número) hasta la hora que se
// le indique -- usado tanto cuando el dueño responde manualmente desde su
// celular (eco de coexistencia, ver app/webhook-dulabs/route.ts) como cuando
// la propia IA decide traspasar la conversación a un humano (ver
// lib/especialista-solicitud-ia.ts, traspaso por interés en un producto, y
// Fase 7, lib/asistente-daniela-ia.ts).
//
// Fase 7 -- también refresca pausado_desde/seguimiento_enviado
// (20260904060000_pausas_chat_seguimiento.sql) en CADA llamada, sin importar
// quién la dispare: así, si Daniela responde manualmente (lo que también
// pasa por esta función), el seguimiento de "no ha respondido" de una pausa
// anterior de la IA queda reiniciado/cancelado solo -- ver
// app/api/cron/seguimiento-traspaso/route.ts. Aditivo: los callers que ya
// existían antes de la Fase 7 no cambian su comportamiento observable.
export async function activarPausaChat(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string,
  duracionMs: number,
): Promise<ActivarPausaChatResult> {
  const ahora = new Date().toISOString();
  const pausadoHasta = new Date(Date.now() + duracionMs).toISOString();
  const { error } = await supabase.from("dulabs_pausas_chat").upsert(
    {
      phone_number_id: phoneNumberId,
      telefono_cliente: telefonoCliente,
      pausado_hasta: pausadoHasta,
      pausado_desde: ahora,
      seguimiento_enviado: false,
    },
    { onConflict: "phone_number_id,telefono_cliente" },
  );
  if (error) {
    console.error("[pausas-chat] error activando pausa:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, pausadoHasta };
}

/**
 * Bloque 17 — pausa que NUNCA acorta otra más larga (traspaso del agente del catálogo).
 *
 * activarPausaChat reemplaza la pausa sin mirar la que había: si una asesora acaba de TOMAR el
 * chat (30 días) y en el mismo instante el agente lo pasa a una asesora (24 h), la pausa quedaría
 * en 24 h y la IA volvería a hablar en un chat que atiende una persona. Aquí, dos sentencias
 * atómicas: crear si no existe (sin pisar) y, si existe, extender solo si la nueva vence después.
 *   "creada" | "extendida" => esta llamada dejó la pausa;
 *   "ya_mas_larga"          => ya había una pausa igual o más larga (una persona la tiene).
 */
export async function extenderPausaChat(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string,
  duracionMs: number,
): Promise<{ ok: true; efecto: "creada" | "extendida" | "ya_mas_larga"; pausadoHasta: string } | { ok: false; error: string }> {
  const ahora = new Date().toISOString();
  const pausadoHasta = new Date(Date.now() + duracionMs).toISOString();
  const fila = { pausado_hasta: pausadoHasta, pausado_desde: ahora, seguimiento_enviado: false };
  for (let intento = 0; intento < 2; intento++) {
    const creada = await supabase
      .from("dulabs_pausas_chat")
      .upsert({ phone_number_id: phoneNumberId, telefono_cliente: telefonoCliente, ...fila }, { onConflict: "phone_number_id,telefono_cliente", ignoreDuplicates: true })
      .select("pausado_hasta");
    if (creada.error) return { ok: false, error: creada.error.message };
    if ((creada.data ?? []).length > 0) return { ok: true, efecto: "creada", pausadoHasta };
    const extendida = await supabase
      .from("dulabs_pausas_chat")
      .update(fila)
      .eq("phone_number_id", phoneNumberId)
      .eq("telefono_cliente", telefonoCliente)
      .lt("pausado_hasta", pausadoHasta)
      .select("pausado_hasta");
    if (extendida.error) return { ok: false, error: extendida.error.message };
    if ((extendida.data ?? []).length > 0) return { ok: true, efecto: "extendida", pausadoHasta };
    const vigente = await supabase
      .from("dulabs_pausas_chat")
      .select("pausado_hasta")
      .eq("phone_number_id", phoneNumberId)
      .eq("telefono_cliente", telefonoCliente)
      .maybeSingle();
    if (vigente.error) return { ok: false, error: vigente.error.message };
    // Alguien la liberó entre las dos sentencias: se vuelve a intentar crearla.
    if (vigente.data) return { ok: true, efecto: "ya_mas_larga", pausadoHasta: String(vigente.data.pausado_hasta) };
  }
  return { ok: false, error: "pausa inestable" };
}

// Fase 9 (Human Inbox, autorizado) — "Devolver a IA": libera la pausa de
// ESTE chat puntual antes de que expire sola. Simplemente borra la fila
// (sin fila = sin pausa = la IA vuelve a responder en el próximo mensaje,
// mismo criterio que ya usa atenderMensaje al consultar esta tabla) -- no
// toca flow_activo/flow_id/trigger_routing_activo/contactos/tags/custom
// fields/historial, nada de eso vive en dulabs_pausas_chat.
export async function liberarPausaChat(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("dulabs_pausas_chat")
    .delete()
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente);
  if (error) {
    console.error("[pausas-chat] error liberando pausa:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
