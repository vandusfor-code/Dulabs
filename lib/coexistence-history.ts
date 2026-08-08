import { supabaseAdmin } from "@/lib/supabase";
import { reenviarWebhookADumo } from "@/lib/dumo";

type HistoryMessage = {
  from?: string;
  to?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  errors?: { code?: number; title?: string }[];
};

type HistoryChunk = {
  metadata?: { phase?: number; chunk_order?: number; progress?: number };
  threads?: { id?: string; messages?: HistoryMessage[] }[];
  errors?: { code?: number; title?: string }[];
};

export type HistoryChangeValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  history?: HistoryChunk[];
};

function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

function inicioDeHoyBogotaUnix(): number {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = partes.find((p) => p.type === "year")?.value ?? "1970";
  const m = partes.find((p) => p.type === "month")?.value ?? "01";
  const d = partes.find((p) => p.type === "day")?.value ?? "01";
  return Math.floor(new Date(`${y}-${m}-${d}T00:00:00-05:00`).getTime() / 1000);
}

function textoDelMensaje(msg: HistoryMessage): string | null {
  if (msg.type === "text" && msg.text?.body) return msg.text.body;
  if (msg.type === "button" && msg.button?.text) return msg.button.text;
  if (msg.type && msg.type !== "media_placeholder") return `[${msg.type}]`;
  return null;
}

/** Convierte chunks history → mensajes normales (solo entrantes del cliente, opcionalmente filtrados por fecha). */
export function extraerMensajesEntrantesDeHistory(
  value: HistoryChangeValue,
  opts?: { soloDesdeUnix?: number },
): {
  phoneNumberId: string;
  displayPhone: string;
  messages: { from: string; id: string; type: string; text: { body: string }; timestamp: string }[];
  contacts: { wa_id: string }[];
  progress?: number;
  declined?: boolean;
} | null {
  const phoneNumberId = value.metadata?.phone_number_id;
  const displayPhone = value.metadata?.display_phone_number ?? "";
  if (!phoneNumberId) return null;

  const businessDigits = soloDigitos(displayPhone);
  const soloDesde = opts?.soloDesdeUnix ?? inicioDeHoyBogotaUnix();
  const messages: { from: string; id: string; type: string; text: { body: string }; timestamp: string }[] = [];
  const contactIds = new Set<string>();
  let progress: number | undefined;
  let declined = false;

  for (const chunk of value.history ?? []) {
    if (chunk.errors?.length) {
      declined = true;
      console.warn("[coexistence-history] chunk con error:", chunk.errors[0]?.title ?? chunk.errors[0]?.code);
    }
    if (chunk.metadata?.progress !== undefined) progress = chunk.metadata.progress;

    for (const thread of chunk.threads ?? []) {
      for (const msg of thread.messages ?? []) {
        if (!msg.id || !msg.from || !msg.timestamp) continue;
        const ts = Number.parseInt(msg.timestamp, 10);
        if (!Number.isFinite(ts) || ts < soloDesde) continue;

        const fromDigits = soloDigitos(msg.from);
        // Solo entrantes: el cliente escribió al negocio (from ≠ línea del negocio).
        if (businessDigits && fromDigits === businessDigits) continue;

        const body = textoDelMensaje(msg);
        if (!body) continue;

        contactIds.add(fromDigits);
        messages.push({
          from: fromDigits,
          id: msg.id,
          type: "text",
          text: { body },
          timestamp: msg.timestamp,
        });
      }
    }
  }

  return {
    phoneNumberId,
    displayPhone,
    messages,
    contacts: [...contactIds].map((wa_id) => ({ wa_id })),
    progress,
    declined,
  };
}

async function registrarEntranteHistorial(
  phoneNumberId: string,
  telefonoCliente: string,
  contenido: string,
  wamid: string,
): Promise<boolean> {
  const { error } = await supabaseAdmin().from("dulabs_mensajes_log").insert({
    phone_number_id: phoneNumberId,
    telefono_cliente: telefonoCliente,
    direccion: "entrante",
    contenido,
    origen: "entrante",
    wamid,
  });
  if (!error) return true;
  if (error.code === "23505") return true; // ya existía
  console.error("[coexistence-history] error registrando mensaje:", error.message);
  return false;
}

/** Procesa webhook `history`: guarda entrantes de hoy en dulabs y los reenvía a DuMo como `messages`. */
export async function procesarHistorialCoexistencia(change: {
  field: string;
  value: HistoryChangeValue;
}): Promise<{ importados: number; reenviados: boolean }> {
  const parsed = extraerMensajesEntrantesDeHistory(change.value);
  if (!parsed) return { importados: 0, reenviados: false };

  const { phoneNumberId, displayPhone, messages, contacts, progress, declined } = parsed;

  console.log(
    `[coexistence-history] phoneId=${phoneNumberId} chunks entrantes hoy=${messages.length} progress=${progress ?? "?"} declined=${declined}`,
  );

  if (messages.length === 0) {
    return { importados: 0, reenviados: false };
  }

  let importados = 0;
  for (const msg of messages) {
    const ok = await registrarEntranteHistorial(phoneNumberId, soloDigitos(msg.from), msg.text.body, msg.id);
    if (ok) importados++;
  }

  const reenviados = await reenviarWebhookADumo({
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: {
        display_phone_number: displayPhone,
        phone_number_id: phoneNumberId,
      },
      contacts: contacts.map((c) => ({ wa_id: c.wa_id, profile: { name: undefined } })),
      messages,
    },
  });

  if (reenviados) {
    console.log(`[coexistence-history] reenviados ${messages.length} mensajes de hoy a DuMo (phoneId=${phoneNumberId})`);
  }

  return { importados, reenviados };
}
