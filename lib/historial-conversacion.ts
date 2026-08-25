import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";

export type MensajeHistorialIA = {
  role: "user" | "assistant";
  content: string;
};

type FilaHistorial = {
  direccion: "entrante" | "saliente";
  contenido: string;
  origen: string;
  wamid: string | null;
};

const MAX_TURNOS = 20;
const MAX_CARACTERES = 12_000;
const VENTANA_MS = 24 * 60 * 60 * 1000;

// Convierte filas del log a turnos alternados user/assistant (formato Anthropic).
// Fusiona mensajes consecutivos del mismo rol — típico cuando alguien manda
// varios WhatsApp seguidos antes de que la IA responda.
export function filasAHistorialIA(filas: FilaHistorial[], opts?: { excluirWamid?: string }): MensajeHistorialIA[] {
  const mensajes: MensajeHistorialIA[] = [];

  for (const fila of filas) {
    if (opts?.excluirWamid && fila.wamid === opts.excluirWamid) continue;
    if (fila.origen === "campaña") continue;

    const content = fila.contenido.trim();
    if (!content) continue;

    const role: MensajeHistorialIA["role"] = fila.direccion === "entrante" ? "user" : "assistant";
    const ultimo = mensajes[mensajes.length - 1];
    if (ultimo?.role === role) {
      ultimo.content += `\n${content}`;
    } else {
      mensajes.push({ role, content });
    }
  }

  // Anthropic exige que la conversación empiece con user.
  while (mensajes.length > 0 && mensajes[0].role === "assistant") {
    mensajes.shift();
  }

  return recortarHistorial(mensajes);
}

// Arma el array final para la API: historial previo + mensaje nuevo del cliente.
export function construirMensajesConHistorial(
  historial: MensajeHistorialIA[],
  textoUsuario: string
): Anthropic.MessageParam[] {
  const turnos = [...historial];
  const ultimo = turnos[turnos.length - 1];
  if (ultimo?.role === "user") {
    ultimo.content += `\n${textoUsuario.trim()}`;
  } else {
    turnos.push({ role: "user", content: textoUsuario.trim() });
  }

  while (turnos.length > 0 && turnos[0].role === "assistant") {
    turnos.shift();
  }

  return turnos;
}

function recortarHistorial(mensajes: MensajeHistorialIA[]): MensajeHistorialIA[] {
  if (mensajes.length <= MAX_TURNOS) {
    return recortarPorCaracteres(mensajes);
  }
  return recortarPorCaracteres(mensajes.slice(-MAX_TURNOS));
}

function recortarPorCaracteres(mensajes: MensajeHistorialIA[]): MensajeHistorialIA[] {
  let total = 0;
  const resultado: MensajeHistorialIA[] = [];
  for (let i = mensajes.length - 1; i >= 0; i--) {
    total += mensajes[i].content.length;
    if (total > MAX_CARACTERES && resultado.length > 0) break;
    resultado.unshift(mensajes[i]);
  }
  while (resultado.length > 0 && resultado[0].role === "assistant") {
    resultado.shift();
  }
  return resultado;
}

export async function obtenerHistorialConversacion(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string,
  opts?: { excluirWamid?: string }
): Promise<MensajeHistorialIA[]> {
  const desde = new Date(Date.now() - VENTANA_MS).toISOString();
  const { data, error } = await supabase
    .from("dulabs_mensajes_log")
    .select("direccion, contenido, origen, wamid")
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .gte("created_at", desde)
    .neq("origen", "campaña")
    .order("created_at", { ascending: false })
    .limit(MAX_TURNOS + 5);

  if (error) {
    console.error("[historial-conversacion] error consultando historial:", error.message);
    return [];
  }

  return filasAHistorialIA([...(data ?? [])].reverse(), opts);
}

export function historialPlaygroundAHistorialIA(
  mensajes: { rol: "usuario" | "ia"; texto: string }[]
): MensajeHistorialIA[] {
  return filasAHistorialIA(
    mensajes.map((m) => ({
      direccion: m.rol === "usuario" ? "entrante" : "saliente",
      contenido: m.texto,
      origen: m.rol === "usuario" ? "entrante" : "ia",
      wamid: null,
    }))
  );
}
