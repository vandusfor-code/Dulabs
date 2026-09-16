// DuLabs Developer V1 -- Fase 6 (autorizado, decisiones D1/D3). Capa PURA
// (sin DB, sin red) que clasifica un webhook de Meta y lo normaliza al
// contrato ESTABLE que recibe el webhook del Developer. Misma convención
// que el resto del core puro (outbound-state-machine.ts, meta-message-mapper.ts).
//
// Meta manda dos clases de webhook al mismo endpoint:
//   - entry[].changes[].value.messages[]  -> mensaje ENTRANTE ("message.received")
//   - entry[].changes[].value.statuses[]  -> cambio de estado de un mensaje
//                                            OUTBOUND ("message.status")
// El Developer debe poder distinguir ambos por `event_type` (D3).

export type ClaseWebhookMeta = "message" | "status" | "other";

export type StatusMeta = "sent" | "delivered" | "read" | "failed";

export type EventoInboundNormalizado = {
  event_id: string;
  event_type: "message.received" | "message.status";
  workspace_id: string;
  phone_number_id: string | null;
  whatsapp_number_id: string; // id interno de DuLabs (mismo identificador público que ya expone Fase 4)
  wamid: string | null; // messages[0].id o statuses[0].id
  from: string | null; // remitente (message) o recipient_id (status)
  timestamp: string | null; // unix seconds tal como los manda Meta
  message_type: string | null; // text/image/... (solo message.received)
  text: string | null; // cuerpo de texto cuando aplica
  status: StatusMeta | null; // solo message.status
  raw: unknown; // payload crudo de Meta (los datos del propio número del Developer; NUNCA se le agregan secretos de DuLabs)
};

function primerValue(payload: unknown): Record<string, unknown> | null {
  const entry = (payload as { entry?: Array<{ changes?: Array<{ value?: Record<string, unknown> }> }> })?.entry?.[0];
  return entry?.changes?.[0]?.value ?? null;
}

/** phone_number_id del webhook -- lo trae metadata, igual para message y status. */
export function extraerPhoneNumberIdMeta(payload: unknown): string | null {
  const value = primerValue(payload);
  const meta = value?.metadata as { phone_number_id?: string } | undefined;
  return typeof meta?.phone_number_id === "string" ? meta.phone_number_id : null;
}

/** Clasifica el webhook: statuses tiene prioridad porque un value con statuses es siempre un status. */
export function clasificarWebhookMeta(payload: unknown): ClaseWebhookMeta {
  const value = primerValue(payload);
  if (!value) return "other";
  if (Array.isArray(value.statuses) && value.statuses.length > 0) return "status";
  if (Array.isArray(value.messages) && value.messages.length > 0) return "message";
  return "other";
}

const STATUS_VALIDOS: ReadonlySet<string> = new Set(["sent", "delivered", "read", "failed"]);

/** Extrae el status de Meta (sent/delivered/read/failed) del primer statuses[]. `null` si no es un status válido conocido. */
export function extraerStatusMeta(payload: unknown): { status: StatusMeta; wamid: string | null; recipient: string | null; timestamp: string | null } | null {
  const value = primerValue(payload);
  const st = (value?.statuses as Array<Record<string, unknown>> | undefined)?.[0];
  if (!st) return null;
  const status = typeof st.status === "string" && STATUS_VALIDOS.has(st.status) ? (st.status as StatusMeta) : null;
  if (!status) return null;
  return {
    status,
    wamid: typeof st.id === "string" ? st.id : null,
    recipient: typeof st.recipient_id === "string" ? st.recipient_id : null,
    timestamp: typeof st.timestamp === "string" ? st.timestamp : null,
  };
}

/**
 * Normaliza un webhook de Meta al contrato estable del Developer. `ctx`
 * trae lo que solo se conoce tras resolver el número (workspace_id +
 * whatsapp_number_id interno) -- el mapper es puro, no consulta la DB.
 * Devuelve null si la clase es "other" (nada normalizable que entregar).
 */
export function normalizarEventoInbound(params: {
  payload: unknown;
  eventId: string;
  workspaceId: string;
  whatsappNumberId: string;
}): EventoInboundNormalizado | null {
  const { payload, eventId, workspaceId, whatsappNumberId } = params;
  const clase = clasificarWebhookMeta(payload);
  const value = primerValue(payload);
  const phone_number_id = extraerPhoneNumberIdMeta(payload);

  const base = {
    event_id: eventId,
    workspace_id: workspaceId,
    phone_number_id,
    whatsapp_number_id: whatsappNumberId,
    raw: payload,
  };

  if (clase === "message") {
    const msg = (value?.messages as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
    const text = (msg.text as { body?: unknown } | undefined)?.body;
    return {
      ...base,
      event_type: "message.received",
      wamid: typeof msg.id === "string" ? msg.id : null,
      from: typeof msg.from === "string" ? msg.from : null,
      timestamp: typeof msg.timestamp === "string" ? msg.timestamp : null,
      message_type: typeof msg.type === "string" ? msg.type : null,
      text: typeof text === "string" ? text : null,
      status: null,
    };
  }

  if (clase === "status") {
    const st = extraerStatusMeta(payload);
    return {
      ...base,
      event_type: "message.status",
      wamid: st?.wamid ?? null,
      from: st?.recipient ?? null,
      timestamp: st?.timestamp ?? null,
      message_type: null,
      text: null,
      status: st?.status ?? null,
    };
  }

  return null;
}

/** tipo de `dulabs_dev_events` que corresponde a un webhook, para persistir con el tipo correcto (Fase 6, D4). */
export function tipoEventoDeWebhook(payload: unknown): "received" | "sent" | "delivered" | "read" | "failed" {
  const clase = clasificarWebhookMeta(payload);
  if (clase === "status") {
    const st = extraerStatusMeta(payload);
    if (st) return st.status; // sent/delivered/read/failed (todos válidos en el enum extendido)
  }
  return "received";
}

/** Rango monotónico de un status (sent=1 < delivered=2 < read=3; failed=4 terminal). */
export function rankStatus(status: StatusMeta): number {
  switch (status) {
    case "sent": return 1;
    case "delivered": return 2;
    case "read": return 3;
    case "failed": return 4;
  }
}
