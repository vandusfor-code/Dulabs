import type { SupabaseClient } from "@supabase/supabase-js";

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
