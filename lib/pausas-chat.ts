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
