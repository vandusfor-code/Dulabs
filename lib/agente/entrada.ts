/**
 * MENSAJES QUE NO SON TEXTO en un número con agente (Bloque 23) — política DETERMINISTA,
 * decidida por el backend ANTES del modelo (Gemini nunca los ve: no puede escuchar, ver ni
 * abrir archivos, y no se le pide que lo intente).
 *
 *   tipo de Meta                    acción     qué pasa
 *   ------------------------------  ---------  -------------------------------------------------
 *   audio (nota de voz)             ask_text   mensaje fijo: "no puedo escuchar audios, escríbeme".
 *                                              Si responde a una foto de ESTA conversación (registro
 *                                              de fotos), el mensaje nombra ese producto y queda
 *                                              señalado para el siguiente mensaje ("quiero ese").
 *   unsupported (Meta no lo pudo    ask_text   mensaje fijo: "no pude abrir ese mensaje, escríbeme".
 *     entregar: encuestas, "ver
 *     una vez", etc.)
 *   image / video / document        handoff    pasa a una asesora (mensaje fijo): puede ser un
 *   location / contacts                        comprobante de pago, una captura de un producto, una
 *                                              dirección; nadie en el sistema puede revisarlo y
 *                                              adivinar sería inventar.
 *   sticker / reaction / otro       ignore     ni respuesta ni registro: un 👍 o un sticker NUNCA
 *                                              cuentan como "sí" (la confirmación de un pedido exige
 *                                              texto explícito; ver etapa.ts).
 *
 * Los avisos "escríbeme" tienen enfriamiento por conversación (NON_TEXT_NOTICE_COOLDOWN_MS): diez
 * audios seguidos reciben UN aviso, no diez. El traspaso pausa el chat (la asesora lo tiene), así
 * que los siguientes mensajes ya no llegan al agente.
 */

export const NON_TEXT_KINDS = ["audio", "image", "video", "document", "location", "contacts", "unsupported", "sticker", "reaction", "other"] as const;
export type NonTextKind = (typeof NON_TEXT_KINDS)[number];
export type NonTextAction = "ignore" | "ask_text" | "handoff";

const ACTIONS: Readonly<Record<NonTextKind, NonTextAction>> = {
  audio: "ask_text",
  unsupported: "ask_text",
  image: "handoff",
  video: "handoff",
  document: "handoff",
  location: "handoff",
  contacts: "handoff",
  sticker: "ignore",
  reaction: "ignore",
  other: "ignore",
};

/** Tipos de mensaje que el agente trata como TEXTO (Meta: texto, botón de plantilla, botón interactivo). */
const TEXT_TYPES = new Set(["text", "button", "interactive"]);

/** null = es texto (lo atiende el turno normal). Cualquier tipo desconocido => "other" (se ignora). */
export function nonTextPolicy(metaType: string | null | undefined): { kind: NonTextKind; action: NonTextAction } | null {
  const t = typeof metaType === "string" ? metaType : "";
  if (TEXT_TYPES.has(t)) return null;
  const kind: NonTextKind = (NON_TEXT_KINDS as readonly string[]).includes(t) ? (t as NonTextKind) : "other";
  return { kind, action: ACTIONS[kind] };
}

/** ¿Este mensaje sin texto debe llegar al agente? (lo que se ignora ni se registra ni se atiende) */
export function nonTextReachesAgent(metaType: string | null | undefined): boolean {
  const p = nonTextPolicy(metaType);
  return p !== null && p.action !== "ignore";
}

const ETIQUETA: Readonly<Record<NonTextKind, string>> = {
  audio: "[nota de voz]",
  image: "[imagen]",
  video: "[video]",
  document: "[documento]",
  location: "[ubicación]",
  contacts: "[contacto]",
  unsupported: "[mensaje no soportado]",
  sticker: "[sticker]",
  reaction: "[reacción]",
  other: "[mensaje]",
};

/**
 * Lo que ve la asesora en el Inbox. El tipo SIEMPRE va (una leyenda sola no dice que había una
 * imagen); de la ubicación y del contacto compartido NO se guarda el contenido (coordenadas,
 * teléfonos de terceros): la asesora lo ve en WhatsApp.
 */
/** Solo estos tipos traen leyenda escrita por el cliente (Meta: image, video, document). */
const CON_LEYENDA: ReadonlySet<NonTextKind> = new Set(["image", "video", "document"]);

export function inboxLabel(kind: NonTextKind, extra: { caption?: string | null; filename?: string | null } = {}): string {
  const caption = CON_LEYENDA.has(kind) && typeof extra.caption === "string" ? extra.caption.trim().slice(0, 1_000) : "";
  const filename = kind === "document" && typeof extra.filename === "string" ? extra.filename.trim().slice(0, 120) : "";
  return [ETIQUETA[kind], filename, caption].filter(Boolean).join(" ");
}

export const NON_TEXT_NOTICE_COOLDOWN_MS = 10 * 60_000;

const QUE_RECIBI: Readonly<Partial<Record<NonTextKind, string>>> = {
  image: "tu imagen",
  video: "tu video",
  document: "tu archivo",
  location: "tu ubicación",
  contacts: "el contacto que compartiste",
};

/** Mensajes FIJOS (sin IA). Solo nombran un producto con datos que el backend acaba de verificar. */
export const NON_TEXT_MESSAGES = {
  audio: "Por ahora no puedo escuchar notas de voz. ¿Me escribes lo que necesitas, por favor?",
  unsupported: "No pude abrir ese mensaje. ¿Me lo escribes, por favor?",
  audioAboutProduct: (p: { reference: string; name: string; available: boolean }) =>
    p.available
      ? `Vi que respondiste a la foto de ${p.name} (ref. ${p.reference}). Por ahora no puedo escuchar notas de voz: ¿me escribes qué quieres saber de esta pieza?`
      : `Vi que respondiste a la foto de la ref. ${p.reference}, que ya no está disponible. Por ahora no puedo escuchar notas de voz: ¿me escribes qué necesitas?`,
  handoff: (kind: NonTextKind) => `Recibí ${QUE_RECIBI[kind] ?? "tu mensaje"}. Te comunico con una asesora para revisarlo; en breve te escribe.`,
  /** El traspaso no se pudo registrar: se dice la verdad (no se promete una asesora que no viene). */
  handoffFailed: (kind: NonTextKind) => `Recibí ${QUE_RECIBI[kind] ?? "tu mensaje"}, pero por ahora no puedo revisarlo por aquí. ¿Me escribes lo que necesitas, por favor?`,
} as const;

/**
 * Bloque 29 (solo con el checkout conversacional): foto, video o archivo del cliente.
 *
 *   situación                                           qué pasa
 *   --------------------------------------------------  ------------------------------------------------
 *   pedido con transferencia PENDIENTE (foto/archivo)   asesora: puede ser el comprobante (el bot nunca
 *                                                       marca un pago como recibido)
 *   pedido enviado, entregado o completado              asesora: puede ser un reclamo
 *   con leyenda ("¿lo tienen en plateado?")             la leyenda se atiende como un mensaje de texto
 *   en medio del registro del pedido                    se pide el dato que falta, escrito
 *   sin texto                                           se pide la referencia (o varias) o una asesora;
 *                                                       un "sí" justo después pasa a una asesora
 *
 * Si el pedido no se pudo consultar, se conserva lo de antes (asesora): nunca se pierde un comprobante.
 */
export const MEDIA_DEL_CLIENTE: ReadonlySet<NonTextKind> = new Set(["image", "video", "document"]);

/**
 * ¿El texto que acompaña la foto habla de un PAGO? ("ya pagué", "comprobante", "te transferí", "listo").
 * Solo entonces una foto con texto, con una transferencia pendiente, se trata como comprobante; un
 * texto de producto ("me gustó esta", "¿lo tienen en plateado?") se atiende como mensaje.
 */
export function hablaDePago(texto: string): boolean {
  const t = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(pago|pague|pagado|pagada|pagar|comprobante|transferencia|transferi|transfiero|consigne|consignacion|consignado|nequi|daviplata|bancolombia|recibo|soporte|deposito|deposite|abono|abone|voucher)\b/.test(t)) return true;
  // Confirmaciones cortas junto a una foto ("listo", "ya", "ahí está"): con una transferencia pendiente, es el comprobante.
  return t.split(" ").length <= 3 && /^(listo|ya|hecho|ahi esta|ahi va|ahi te va|ya quedo|ya esta|enviado|envie|ok|dale|si)\b/.test(t);
}

const LO_QUE_ENVIO: Readonly<Partial<Record<NonTextKind, string>>> = { image: "la foto", video: "el video", document: "el archivo" };

export const MEDIA_MESSAGES = {
  pideReferencia: (kind: NonTextKind) =>
    `¡Gracias por ${LO_QUE_ENVIO[kind] ?? "tu mensaje"}! 😊 Por aquí no puedo ver imágenes ni archivos. ¿Me escribes la referencia del producto (aparece en la foto o en el catálogo)? Si son varios, escríbeme todas las referencias. Si prefieres, te comunico con una asesora.`,
  comprobante: (kind: NonTextKind) => `Recibí ${QUE_RECIBI[kind] ?? "tu mensaje"} 🙌 Si es el comprobante de pago, una asesora lo revisa y te confirma en breve.`,
  enCheckout: (hint: string) => `Por ahora no puedo ver imágenes ni archivos 🙏 ${hint}`,
} as const;
