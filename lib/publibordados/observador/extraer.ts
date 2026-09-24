/**
 * Publi Bordados — observador shadow: extracción PURA de observaciones a partir de un `change`
 * del webhook de Meta. Sin I/O, sin reloj propio (recibe `recibidoAt`), sin texto guardado.
 *
 * No asume la forma del eco: registra el arreglo real en el que llegó (`message_echoes`,
 * `smb_message_echoes` o `messages` con from = número del negocio) y cualquier otra cosa como
 * UNKNOWN_EVENT (nunca se descarta en silencio).
 */
import { createHash } from "node:crypto";
import { claveConversacion } from "./clave";

export type EventType =
  | "CLIENT_MESSAGE"
  | "HUMAN_MESSAGE_ECHO"
  | "AI_MESSAGE"
  | "PLATFORM_MESSAGE_ECHO"
  | "ECHO_UNCLASSIFIED"
  | "STATUS"
  | "UNKNOWN_EVENT";

export type Clasificacion = "AI" | "HUMAN" | "PLATFORM" | "UNKNOWN";
type Rol = "cliente" | "negocio" | "desconocido";

export interface Observacion {
  id_tenant: string;
  phone_number_id: string;
  clave: string;
  conversation_key: string | null;
  event_type: EventType;
  direction: "entrante" | "saliente" | "ninguna";
  classification: Clasificacion | null;
  evidencia: string | null;
  wamid: string | null;
  related_wamid: string | null;
  remitente: Rol;
  destinatario: Rol;
  source: string;
  array_key: string | null;
  event_timestamp: string | null;
  received_at: string;
  latencia_ms: number | null;
  metadata: Record<string, unknown>;
}

export interface ChangeCrudo {
  field?: unknown;
  value?: unknown;
}

export interface ContextoExtraccion {
  idTenant: string;
  phoneNumberId: string;
  recibidoAt: Date;
}

/** Claves del `value` que el observador sabe interpretar. Todo lo demás => UNKNOWN_EVENT. */
const CLAVES_CONOCIDAS = new Set(["messaging_product", "metadata", "contacts", "messages", "statuses", "message_echoes", "smb_message_echoes"]);
const ARREGLOS_ECO = ["message_echoes", "smb_message_echoes"] as const;

type Item = Record<string, unknown>;

const digitos = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\D/g, "") : "");
const texto = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null);
const esObjeto = (v: unknown): v is Item => typeof v === "object" && v !== null && !Array.isArray(v);
const arreglo = (v: unknown): Item[] => (Array.isArray(v) ? v.filter(esObjeto) : []);

/** Timestamp de Meta (segundos Unix, como string) → ISO; cualquier otra cosa → null. */
function tiempoMeta(v: unknown): Date | null {
  const s = typeof v === "string" || typeof v === "number" ? String(v) : "";
  if (!/^\d{9,11}$/.test(s)) return null;
  const d = new Date(Number(s) * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Solo forma, nunca contenido: tipo, largo del texto, tipo de interacción, si es respuesta/reenvío. */
function metadatosMensaje(m: Item): Record<string, unknown> {
  const meta: Record<string, unknown> = { tipo: texto(m.type, 40) ?? "desconocido" };
  const cuerpo = esObjeto(m.text) ? m.text.body : undefined;
  if (typeof cuerpo === "string") meta.longitud_texto = cuerpo.length;
  if (esObjeto(m.interactive)) meta.interactivo = texto(m.interactive.type, 40);
  if (esObjeto(m.context)) {
    meta.es_respuesta = typeof m.context.id === "string";
    if (m.context.forwarded || m.context.frequently_forwarded) meta.reenviado = true;
  }
  if (m.errors !== undefined) meta.con_errores = true;
  return meta;
}

function huella(field: string, value: unknown): string {
  // Solo para deduplicar un evento sin wamid: el hash no se puede revertir al contenido.
  return createHash("sha256").update(`${field}\n${JSON.stringify(value ?? null)}`, "utf8").digest("hex");
}

/**
 * Convierte un `change` en observaciones. Los ecos salen con `classification = null`:
 * los clasifica `clasificarEcos` (necesita consultar el registro de envíos).
 */
export function extraerObservaciones(change: ChangeCrudo, ctx: ContextoExtraccion): Observacion[] {
  const field = texto(change.field, 60) ?? "desconocido";
  const value = esObjeto(change.value) ? change.value : {};
  const display = digitos(esObjeto(value.metadata) ? value.metadata.display_phone_number : undefined);
  const recibido = ctx.recibidoAt;
  const clave = (waId: string | null) => (waId ? claveConversacion(ctx.idTenant, ctx.phoneNumberId, waId) : null);

  const base = (p: Omit<Observacion, "id_tenant" | "phone_number_id" | "received_at" | "latencia_ms" | "event_timestamp" | "source"> & { ts: Date | null }): Observacion => {
    const { ts, ...resto } = p;
    return {
      id_tenant: ctx.idTenant,
      phone_number_id: ctx.phoneNumberId,
      source: field,
      received_at: recibido.toISOString(),
      event_timestamp: ts ? ts.toISOString() : null,
      latencia_ms: ts ? recibido.getTime() - ts.getTime() : null,
      ...resto,
    };
  };

  const salida: Observacion[] = [];

  const eco = (m: Item, arrayKey: string) => {
    const wamid = texto(m.id);
    const waCliente = digitos(m.to) || null;
    salida.push(
      base({
        clave: wamid ? `echo:${wamid}` : `unk:${huella(field, m)}`,
        conversation_key: clave(waCliente),
        event_type: "ECHO_UNCLASSIFIED",
        direction: "saliente",
        classification: null,
        evidencia: null,
        wamid,
        related_wamid: esObjeto(m.context) ? texto(m.context.id) : null,
        remitente: "negocio",
        destinatario: waCliente ? "cliente" : "desconocido",
        array_key: arrayKey,
        ts: tiempoMeta(m.timestamp),
        metadata: { ...metadatosMensaje(m), ...(waCliente ? {} : { sin_destinatario: true }) },
      }),
    );
  };

  // 1) Mensajes: del cliente, o eco en `messages` (from = número del negocio).
  for (const m of arreglo(value.messages)) {
    const from = digitos(m.from);
    if (display && from === display) {
      eco(m, "messages");
      continue;
    }
    const contactos = arreglo(value.contacts);
    const waCliente = from || (contactos.length === 1 ? digitos(contactos[0].wa_id) : "") || null;
    const wamid = texto(m.id);
    salida.push(
      base({
        clave: wamid ? `msg:${wamid}` : `unk:${huella(field, m)}`,
        conversation_key: clave(waCliente),
        event_type: "CLIENT_MESSAGE",
        direction: "entrante",
        classification: null,
        evidencia: null,
        wamid,
        related_wamid: esObjeto(m.context) ? texto(m.context.id) : null,
        remitente: waCliente ? "cliente" : "desconocido",
        destinatario: "negocio",
        array_key: "messages",
        ts: tiempoMeta(m.timestamp),
        metadata: metadatosMensaje(m),
      }),
    );
  }

  // 2) Ecos en sus arreglos propios (se registra cuál llegó de verdad).
  for (const k of ARREGLOS_ECO) for (const m of arreglo(value[k])) eco(m, k);

  // 3) Estados de entrega (de mensajes que envió alguien desde el número).
  for (const s of arreglo(value.statuses)) {
    const wamid = texto(s.id);
    const estado = texto(s.status, 20) ?? "desconocido";
    const waCliente = digitos(s.recipient_id) || null;
    const errores = arreglo(s.errors);
    salida.push(
      base({
        clave: wamid ? `status:${wamid}:${estado}` : `unk:${huella(field, s)}`,
        conversation_key: clave(waCliente),
        event_type: "STATUS",
        direction: "saliente",
        classification: null,
        evidencia: null,
        wamid,
        related_wamid: null,
        remitente: "negocio",
        destinatario: waCliente ? "cliente" : "desconocido",
        array_key: "statuses",
        ts: tiempoMeta(s.timestamp),
        metadata: { estado, ...(errores.length > 0 ? { error_codigo: errores[0].code ?? null } : {}) },
      }),
    );
  }

  // 4) Todo lo que no se reconoce: nunca se descarta en silencio.
  const desconocidas = Object.keys(value).filter((k) => !CLAVES_CONOCIDAS.has(k));
  const campoConocido = field === "messages" || field === "smb_message_echoes";
  if (!campoConocido || desconocidas.length > 0 || salida.length === 0) {
    salida.push(
      base({
        clave: `unk:${huella(field, value)}`,
        conversation_key: null,
        event_type: "UNKNOWN_EVENT",
        direction: "ninguna",
        classification: null,
        evidencia: null,
        wamid: null,
        related_wamid: null,
        remitente: "desconocido",
        destinatario: "desconocido",
        array_key: null,
        ts: null,
        metadata: { claves_value: Object.keys(value).slice(0, 30), claves_desconocidas: desconocidas.slice(0, 30) },
      }),
    );
  }

  return salida;
}

/** Origen conocido de un wamid saliente: enviado por el agente de PB, o registrado por otra vía de DuLabs. */
export interface OrigenesWamid {
  pb: Set<string>;
  /** wamid → origen en dulabs_mensajes_log (ia, agente, campaña, manual, …). */
  plataforma: Map<string, string>;
}

/**
 * Clasifica ecos por EVIDENCIA ESTRUCTURAL (el wamid), nunca por texto:
 *   wamid registrado por PB                       → AI_MESSAGE        (AI)
 *   wamid enviado por DuLabs por la API (no PB)   → PLATFORM_MESSAGE_ECHO (PLATFORM)
 *   wamid sin registro de envío                   → HUMAN_MESSAGE_ECHO (HUMAN, candidato)
 *   no se pudo consultar el registro              → ECHO_UNCLASSIFIED  (UNKNOWN)
 * Es una observación, no una decisión: la Fase 2A no cambia ningún estado con esto.
 */
export function clasificarEcos(obs: Observacion[], origenes: OrigenesWamid | null): Observacion[] {
  return obs.map((o) => {
    if (o.event_type === "STATUS") {
      if (!origenes || !o.wamid) return { ...o, metadata: { ...o.metadata, origen_envio: origenes ? "sin_wamid" : "no_consultado" } };
      const origen = origenes.pb.has(o.wamid) ? "pb" : origenes.plataforma.has(o.wamid) ? `dulabs:${origenes.plataforma.get(o.wamid)}` : "no_registrado";
      return { ...o, metadata: { ...o.metadata, origen_envio: origen } };
    }
    if (o.event_type !== "ECHO_UNCLASSIFIED") return o;
    if (!origenes) return { ...o, classification: "UNKNOWN", evidencia: "registro_no_consultado" };
    if (!o.wamid) return { ...o, classification: "UNKNOWN", evidencia: "eco_sin_wamid" };
    if (origenes.pb.has(o.wamid)) return { ...o, event_type: "AI_MESSAGE", classification: "AI", evidencia: "wamid_en_pb_enviados" };
    const plataforma = origenes.plataforma.get(o.wamid);
    if (plataforma !== undefined && plataforma !== "manual") {
      return { ...o, event_type: "PLATFORM_MESSAGE_ECHO", classification: "PLATFORM", evidencia: `wamid_en_mensajes_log:${plataforma}`.slice(0, 80) };
    }
    return { ...o, event_type: "HUMAN_MESSAGE_ECHO", classification: "HUMAN", evidencia: "wamid_no_registrado" };
  });
}
