/**
 * Frontera webhook -> agente conversacional (Fase 8).
 *
 * Se invoca desde app/webhook-dulabs/route.ts (atenderMensaje) DESPUÉS de las
 * guardas existentes (lista negra, ia_pausada, ia_restringida_a, pausa humana,
 * cupo, freno de ráfaga, candado del chat) y ANTES de Business Agent / Flow /
 * IA legacy.
 *
 *   sin fila de agente para el número  -> handled:false (todo sigue como antes)
 *   fila apagada                        -> handled:true, silencio (NO cae a otro bot)
 *   fila inválida / sin credencial      -> handled:true, silencio + error registrado
 *                                          (fail-closed: nunca cae a la IA legacy
 *                                          ni cambia de proveedor)
 *   fila válida                         -> el agente atiende el turno
 *
 * Así, un número configurado con Gemini jamás termina respondido por Claude.
 */
import { createSupabaseClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "@/lib/supabase";
import { chatEnPausaHumana } from "@/lib/pausas-chat";
import { recordarNombreCliente } from "@/lib/clientes-conocidos";
import { MetaGraphApiError, enviarMedia, enviarTexto } from "@/lib/whatsapp";
import { enviarBotones, enviarLista, incrementarUsoMensajes, registrarMensaje, resolverTokenMetaAgente } from "@/lib/whatsapp-outbound";
import { contactRef } from "@/lib/catalogo/pedidos/log";
import { productionAgentToolDeps } from "@/lib/catalogo/pedidos/produccion";
import { createGeminiProvider } from "@/lib/ia-proveedores/gemini";
import { validateAIProviderConfig, type AIProviderFactories } from "@/lib/ia-proveedores/registro";
import { crearLectorDeReferencias } from "@/lib/agente/lectura-referencias";
import { crearTranscriptorDeAudio, type ResultadoTranscripcion, type TranscriptorDeAudio } from "@/lib/agente/transcripcion-audio";
import { createSupabaseAgentConfigStore, loadAgentConfig, providerForConfig, type AgentConfigStore, type AgentRuntimeConfig } from "@/lib/agente/config";
import { createSupabaseHistoryStore } from "@/lib/agente/contexto";
import { createSupabaseConversationStateStore } from "@/lib/agente/estado";
import { createSupabaseProductMediaLedger } from "@/lib/agente/medios";
import { batchInput, createSupabaseMailboxStore, drain, enqueueAndDrain, type DrainOptions, type MailboxMessage, type MailboxStore } from "@/lib/agente/buzon";
import { FOTO_SIN_REFERENCIA, PREFIJO_FOTO, inboxLabel, type NonTextKind } from "@/lib/agente/entrada";
import { boundaryRecord, createSupabaseTraceSink, turnRecord } from "@/lib/agente/trazas";
import { createSupabaseUsageReader, decideLimits } from "@/lib/agente/limites";
import { createSupabaseCustomerChannelStore } from "@/lib/agente/clasificacion";
import type { AgentToolsDeps } from "@/lib/agente/herramientas";
import { classifyCustomerMedia, runAgentTurn, type AgentRuntimeDeps, type AgentSender, type AgentTurnTrace } from "@/lib/agente/runtime";
import { cifrarSecreto } from "@/lib/crypto";

export interface AgentBoundaryInput {
  cliente: Pick<ClienteConfig, "id_tenant" | "phone_number_id">;
  /** wa_id del remitente (identidad del contacto). */
  waId: string;
  /** Número al que se responde (puede diferir del wa_id en casos de Meta). */
  destino: string;
  wamid: string;
  text: string;
  /** context de Meta: mensaje citado (swipe-to-reply a una foto) o reenviado. */
  replyTo?: { wamid?: string | null; forwarded?: boolean } | null;
  /** Mensaje sin texto (Bloque 23): `text` vacío y la política determinista de entrada.ts. */
  nonText?: { kind: NonTextKind; caption?: string | null; mediaId?: string | null; audioNoEntendido?: boolean } | null;
  /** Bloque 30: mensaje superado por uno más nuevo (freno de ráfaga): una foto de producto (o una nota de voz transcrita) solo se encola en el buzón. */
  soloEncolar?: boolean;
  /** Bloque 26: id del botón tocado (interactive.button_reply.id). Solo el turno directo lo usa; el buzón guarda el texto. */
  buttonId?: string | null;
}

/**
 * `context` del mensaje de Meta -> a qué respondió el cliente (Bloque 22). Única lectura, para el
 * turno directo y para el buzón:
 *   - deslizar para responder a una foto: { from, id } -> id = wamid de ESA foto (el registro de
 *     fotos enviadas dice qué producto es; nunca se adivina);
 *   - reenviado: { forwarded: true } (o frequently_forwarded) -> no hay foto citada.
 * Sin context => null. Un id vacío o inválido no se usa (el agente pide aclaración).
 */
export function replyToDeMeta(context: { id?: string | null; forwarded?: boolean; frequently_forwarded?: boolean } | null | undefined): AgentBoundaryInput["replyTo"] {
  if (!context) return null;
  const forwarded = !!(context.forwarded || context.frequently_forwarded);
  const id = typeof context.id === "string" && context.id.trim() !== "" ? context.id.trim().slice(0, 200) : null;
  return { wamid: forwarded ? null : id, forwarded };
}

export type AgentBoundaryResult =
  | { handled: false; reason: "no_agent" }
  | { handled: true; outcome: "disabled" | "invalid_config" | "unavailable" | "queued" | AgentTurnTrace["outcome"]; reason?: string; turns?: number };

/** Bloque 29: lector de referencias en fotos del cliente, con la MISMA credencial y modelo del agente. */
export type ImageReaderFactory = (gemini: { apiKey: string; model: string }) => (mediaId: string) => Promise<string[]>;

/** FASE 2: transcriptor de notas de voz, con la MISMA credencial y modelo del agente (y la credencial de Meta del negocio). */
export type AudioTranscriberFactory = (gemini: { apiKey: string; model: string }) => TranscriptorDeAudio;

/** FASE 2: lo que queda de una transcripción (sin el texto: solo tamaños, tokens y resultado). */
export interface TranscriptionTrace {
  wamid: string;
  contact_ref: string;
  outcome: "transcrito" | Extract<ResultadoTranscripcion, { ok: false }>["motivo"] | "tope";
  bytes: number | null;
  chars: number | null;
  ms: number;
  usage: { input: number; output: number } | null;
}

export interface AgentBoundaryDeps {
  configStore: AgentConfigStore;
  /**
   * Construye el resto de dependencias solo si hay un agente válido (evita trabajo para los demás números).
   * Con `mailbox`, los mensajes pasan por el buzón y hay UN turno a la vez por conversación (Bloque 11).
   */
  build(input: AgentBoundaryInput, config: AgentRuntimeConfig):
    | (Omit<AgentRuntimeDeps, "config" | "provider" | "model"> & {
        mailbox?: MailboxStore;
        drain?: DrainOptions;
        imageReader?: ImageReaderFactory;
        /** FASE 2: transcriptor de notas de voz (solo se usa si el número tiene la transcripción encendida). */
        audioTranscriber?: AudioTranscriberFactory;
        /** FASE 2: la transcripción queda en el Inbox junto a "[nota de voz]" (y en el historial de los turnos siguientes). */
        noteTranscription?: (wamid: string, texto: string) => Promise<void>;
        /** FASE 2: traza de la transcripción (tokens cuentan para el tope diario del negocio). */
        logTranscription?: (t: TranscriptionTrace) => void;
      })
    | null;
  /**
   * ¿El número tiene con qué enviar por WhatsApp SIN usar la credencial de otro? (su token, o el de la
   * plataforma solo si su fila lo autoriza). false => el agente no corre: error controlado, sin fallback.
   */
  hasMetaCredential?(config: AgentRuntimeConfig): boolean;
  env?: Record<string, string | undefined>;
  factories?: Partial<AIProviderFactories>;
  logError?: (entry: Record<string, unknown>) => void;
  /** Espera lo que quedó pendiente de guardar (trazas) antes de que termine la función. */
  flush?: () => Promise<void>;
}

const defaultLogError = (entry: Record<string, unknown>) => console.error(JSON.stringify({ log: "agent_boundary", ...entry }));

export async function atenderConAgenteSiAplica(input: AgentBoundaryInput, deps: AgentBoundaryDeps): Promise<AgentBoundaryResult> {
  try {
    return await atender(input, deps);
  } finally {
    await deps.flush?.().catch(() => {});
  }
}

async function atender(input: AgentBoundaryInput, deps: AgentBoundaryDeps): Promise<AgentBoundaryResult> {
  const logError = deps.logError ?? defaultLogError;
  const base = { business_id: input.cliente.id_tenant, contact_ref: contactRef(input.waId) };
  const expected = { tenantId: input.cliente.id_tenant, phoneNumberId: input.cliente.phone_number_id };
  let cfg;
  try {
    cfg = await loadAgentConfig(deps.configStore, expected).catch(() => loadAgentConfig(deps.configStore, expected));
  } catch {
    // Ni con un reintento se pudo saber si hay agente: fail-closed (no se arriesga a que responda otro bot).
    logError({ ...base, result: "config_unreadable" });
    return { handled: true, outcome: "unavailable", reason: "config_unreadable" };
  }
  if (cfg.kind === "none") return { handled: false, reason: "no_agent" };
  if (cfg.kind === "disabled") return { handled: true, outcome: "disabled" };
  if (cfg.kind === "invalid") {
    logError({ ...base, result: "invalid_config", reason: cfg.reason });
    return { handled: true, outcome: "invalid_config", reason: cfg.reason };
  }
  const provider = providerForConfig(cfg.config, { env: deps.env, factories: deps.factories });
  if (!provider.ok) {
    logError({ ...base, result: "invalid_config", reason: provider.reason, provider: cfg.config.provider });
    return { handled: true, outcome: "invalid_config", reason: provider.reason };
  }
  // Sin credencial de Meta PROPIA del negocio (ni autorización explícita para la de la plataforma):
  // no se gasta un turno que no podría responder ni se envía con la credencial de otro.
  if (deps.hasMetaCredential && !deps.hasMetaCredential(cfg.config)) {
    logError({ ...base, result: "invalid_config", reason: "meta_credential_missing" });
    return { handled: true, outcome: "invalid_config", reason: "meta_credential_missing" };
  }
  // Fila leída sin las columnas del perfil (migración pendiente): se atiende como antes, y queda a la vista.
  if (cfg.config.legacyProfile) console.warn(JSON.stringify({ log: "agent_boundary", result: "legacy_profile", business_id: input.cliente.id_tenant }));
  const rest = deps.build(input, cfg.config);
  if (!rest) {
    logError({ ...base, result: "unavailable", reason: "runtime_deps_unavailable" });
    return { handled: true, outcome: "unavailable", reason: "runtime_deps_unavailable" };
  }
  const { mailbox, drain: drainOptions, imageReader, audioTranscriber, noteTranscription, logTranscription, ...runtimeDeps } = rest;
  const deps2: AgentRuntimeDeps = { ...runtimeDeps, config: cfg.config, provider: provider.provider, model: provider.model };
  // Bloque 29 (solo con el checkout conversacional): leer la referencia escrita en una foto del cliente.
  if (cfg.config.checkoutEnabled && imageReader && input.nonText?.kind === "image" && input.nonText.mediaId) {
    const valid = validateAIProviderConfig({ provider: cfg.config.provider, model: cfg.config.model, credentialRef: cfg.config.credentialRef });
    const apiKey = valid.ok ? (deps.env ?? process.env)[valid.envVar]?.trim() : undefined;
    if (valid.ok && apiKey) deps2.readImageReferences = imageReader({ apiKey, model: valid.model });
  }
  const key = { tenantId: input.cliente.id_tenant, phoneNumberId: input.cliente.phone_number_id, waId: input.waId };
  // FASE 2 — NOTA DE VOZ (solo con la transcripción encendida para el número): se descarga de Meta con la
  // credencial del negocio, se transcribe con SU proveedor y la transcripción entra como TEXTO del cliente,
  // con la misma autoridad que un mensaje escrito (buzón, intérprete y guardas; nunca un botón). Si no se
  // puede (o el negocio/cliente está en su tope de costo), la política de siempre: se pide escrita.
  if (input.nonText?.kind === "audio" && cfg.config.audioTranscription && audioTranscriber) {
    const inicio = Date.now();
    const valid = validateAIProviderConfig({ provider: cfg.config.provider, model: cfg.config.model, credentialRef: cfg.config.credentialRef });
    const apiKey = valid.ok ? (deps.env ?? process.env)[valid.envVar]?.trim() : undefined;
    const uso = deps2.usage ? await deps2.usage.read({ tenantId: key.tenantId, phoneNumberId: key.phoneNumberId, contactRef: base.contact_ref }).catch(() => null) : null;
    const mediaId = input.nonText.mediaId;
    let r: ResultadoTranscripcion | { ok: false; motivo: "tope" };
    if (decideLimits(uso, cfg.config.limits).action !== "allow") r = { ok: false, motivo: "tope" };
    else if (!valid.ok || !apiKey || !mediaId) r = { ok: false, motivo: "error" };
    else r = await (async () => audioTranscriber({ apiKey, model: valid.model })(mediaId))().catch(() => ({ ok: false as const, motivo: "error" as const }));
    logTranscription?.(
      r.ok
        ? { wamid: input.wamid, contact_ref: base.contact_ref, outcome: "transcrito", bytes: r.bytes, chars: r.texto.length, ms: Date.now() - inicio, usage: r.usage }
        : { wamid: input.wamid, contact_ref: base.contact_ref, outcome: r.motivo, bytes: ("bytes" in r && r.bytes) || null, chars: null, ms: Date.now() - inicio, usage: ("usage" in r && r.usage) || null },
    );
    if (r.ok) {
      await noteTranscription?.(input.wamid, r.texto).catch(() => undefined);
      input = { ...input, text: r.texto, nonText: null };
      if (input.soloEncolar && mailbox) {
        // Nota de voz superada por un mensaje más nuevo (freno de ráfaga): solo se encola; el turno del más nuevo la atiende.
        const q = await mailbox
          .enqueue(key, { wamid: input.wamid, text: r.texto, replyTo: input.replyTo ? { wamid: input.replyTo.wamid ?? null, forwarded: !!input.replyTo.forwarded } : null })
          .catch(() => "unavailable" as const);
        if (q !== "unavailable") return { handled: true, outcome: "queued" };
      }
    } else {
      input = { ...input, nonText: { ...input.nonText, audioNoEntendido: true } };
    }
  }
  const single = () =>
    runAgentTurn(deps2, { ...key, wamid: input.wamid, text: input.text, replyTo: input.replyTo ?? null, nonText: input.nonText ?? null, buttonId: input.buttonId ?? null }).then((r) => ({ handled: true as const, outcome: r.outcome }));
  let last: AgentTurnTrace["outcome"] | null = null;
  const runBatch = async (batch: MailboxMessage[]) => {
    const b = batchInput(batch);
    const r = await runAgentTurn(deps2, { ...key, wamid: b.wamid, wamids: b.wamids, text: b.text, replyTo: b.replyTo });
    last = r.outcome;
    return r.trace.turn;
  };
  // Bloque 30 (solo con el checkout conversacional): una FOTO de producto entra al buzón como texto,
  // así una ráfaga de 3 o 10 fotos (cada una llega en su propio webhook) recibe UNA sola respuesta.
  // Comprobante, posventa, registro del pedido o sin pedido consultable => la política de siempre (abajo).
  let fotoEnBuzon: string | null = null;
  if (input.nonText?.kind === "image" && cfg.config.checkoutEnabled && mailbox) {
    fotoEnBuzon = await fotoParaBuzon(deps2, mailbox, key, input).catch(() => null);
    if (fotoEnBuzon !== null && input.soloEncolar) {
      // Foto superada por otra más nueva (freno de ráfaga): solo se encola; el turno del más nuevo la atiende.
      const q = await mailbox.enqueue(key, { wamid: input.wamid, text: fotoEnBuzon, replyTo: null }).catch(() => "unavailable" as const);
      if (q !== "unavailable") return { handled: true, outcome: "queued" };
      fotoEnBuzon = null;
    }
  }
  if (input.nonText && fotoEnBuzon === null) {
    // Sin texto (Bloque 23): no entra al buzón (no hay texto que sumar a la ráfaga). Primero se
    // atienden, en orden, los mensajes de texto que llegaron antes y quedaron en el buzón (el freno
    // de ráfaga los dejó ahí al llegar este); luego la política fija de este mensaje, sin modelo.
    if (mailbox) {
      await drain(mailbox, key, input.wamid, runBatch, drainOptions).catch((err) => {
        logError({ ...base, result: "mailbox_error", reason: err instanceof Error ? err.message.slice(0, 120) : "unknown" });
      });
    }
    return single();
  }
  if (!mailbox) return single();

  // Buzón: si otro proceso tiene el turno de esta conversación, él atiende este mensaje (nunca dos turnos en paralelo).
  const drained = await enqueueAndDrain(
    mailbox,
    key,
    { wamid: input.wamid, text: fotoEnBuzon ?? input.text, replyTo: input.replyTo ? { wamid: input.replyTo.wamid ?? null, forwarded: !!input.replyTo.forwarded } : null },
    runBatch,
    drainOptions,
  ).catch((err) => {
    logError({ ...base, result: "mailbox_error", reason: err instanceof Error ? err.message.slice(0, 120) : "unknown" });
    return { status: "unavailable" as const };
  });
  // Sin la migración del buzón (o si falló al encolar): un turno directo, como antes.
  if (drained.status === "unavailable") return fotoEnBuzon !== null ? runAgentTurn(deps2, { ...key, wamid: input.wamid, text: fotoEnBuzon, replyTo: input.replyTo ?? null }).then((r) => ({ handled: true as const, outcome: r.outcome })) : single();
  if (drained.status === "queued") return { handled: true, outcome: "queued" };
  if (drained.leftPending) logError({ ...base, result: "mailbox_left_pending", turns: drained.turns });
  return { handled: true, outcome: last ?? "queued", turns: drained.turns };
}

/**
 * Bloque 30: espera del freno de ráfaga del webhook (ms). Un BOTÓN de un número con agente no
 * espera: es una acción completa (Detal/Mayor, entrega, pago, confirmar), no el inicio de una
 * ráfaga, y sus pasos del checkout no usan el modelo. Todo lo demás, igual que siempre (2,5 s).
 */
export const ESPERA_RAFAGA_MS = 2_500;
export function esperaDeRafagaMs(input: { agenteListo: boolean; esBoton: boolean }): number {
  return input.agenteListo && input.esBoton ? 0 : ESPERA_RAFAGA_MS;
}

/**
 * ¿El número tiene una fila de agente (aunque esté apagada o sea inválida)? Decide si un mensaje
 * SIN texto se registra en el Inbox y llega al agente (Bloque 23). Si no se puede leer: false,
 * es decir, el comportamiento de siempre para ese mensaje (se descarta); el texto no depende de esto.
 */
/** Máximo de fotos de una ráfaga que se leen (costo): de ahí en adelante se piden escritas. */
export const MAX_FOTOS_LEIDAS_POR_RAFAGA = 10;

/**
 * Bloque 30: texto con el que una foto de producto entra al buzón, o null si no va al buzón
 * (comprobante, posventa, registro del pedido en curso o pedido no consultable).
 */
export async function fotoParaBuzon(
  deps: AgentRuntimeDeps,
  mailbox: MailboxStore,
  key: { tenantId: string; phoneNumberId: string; waId: string },
  input: Pick<AgentBoundaryInput, "nonText">,
): Promise<string | null> {
  const loaded = await deps.state.load(key);
  const ckStep = loaded.state.checkout?.step ?? null;
  if (ckStep) return null;
  const enCola = await mailbox.pending(key, MAX_FOTOS_LEIDAS_POR_RAFAGA + 1).catch(() => [] as MailboxMessage[]);
  const leer = enCola.filter((m) => m.text.startsWith(PREFIJO_FOTO) || m.text === FOTO_SIN_REFERENCIA).length < MAX_FOTOS_LEIDAS_POR_RAFAGA;
  const d = await classifyCustomerMedia(
    leer ? deps : { tools: deps.tools },
    { tenantId: key.tenantId, contact: { phoneNumberId: key.phoneNumberId, waId: key.waId } },
    { kind: "image", caption: input.nonText?.caption ?? null, mediaId: input.nonText?.mediaId ?? null, ckStep: null },
  );
  if (d?.tipo === "leyenda") return `${PREFIJO_FOTO} ${d.texto}`;
  if (d?.tipo === "pedir") return FOTO_SIN_REFERENCIA;
  return null;
}

export async function numeroConAgente(store: AgentConfigStore, phoneNumberId: string): Promise<boolean> {
  try {
    return (await store.getByPhoneNumber(phoneNumberId)) !== null;
  } catch {
    return false;
  }
}

/**
 * Mensaje que el freno de ráfaga del webhook deja pasar en silencio (llegó uno más nuevo):
 * si el número tiene un agente válido, entra al buzón para que el turno del mensaje más
 * nuevo atienda la ráfaga COMPLETA (con la foto citada, si la hubo). Nunca lanza.
 */
export async function encolarEnBuzonSiAplica(input: AgentBoundaryInput, deps: { configStore: AgentConfigStore; mailbox: MailboxStore }): Promise<boolean> {
  try {
    const cfg = await loadAgentConfig(deps.configStore, { tenantId: input.cliente.id_tenant, phoneNumberId: input.cliente.phone_number_id });
    if (cfg.kind !== "ok") return false;
    const r = await deps.mailbox.enqueue(
      { tenantId: input.cliente.id_tenant, phoneNumberId: input.cliente.phone_number_id, waId: input.waId },
      { wamid: input.wamid, text: input.text, replyTo: input.replyTo ? { wamid: input.replyTo.wamid ?? null, forwarded: !!input.replyTo.forwarded } : null },
    );
    return r === "queued";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Producción
// ---------------------------------------------------------------------------

/**
 * Envío real por WhatsApp Cloud API; registra en el historial (origen "ia") y cuenta el uso, igual que enviarWhatsApp.
 * Credencial: la del negocio; la de la plataforma solo si su fila lo autoriza (`permitePlataforma`).
 */
function whatsappSender(supabase: SupabaseClient, cliente: ClienteConfig, input: AgentBoundaryInput, permitePlataforma: boolean): AgentSender {
  const simulated = process.env.NODE_ENV !== "production" && process.env.DULABS_AGENTE_ENVIO_SIMULADO === "1";
  const resolverTokenMeta = (c: ClienteConfig) => resolverTokenMetaAgente(c, permitePlataforma);
  // Diagnóstico de envío SIN datos sensibles: solo el estado HTTP y el código de Meta (nunca el token, el texto ni el teléfono).
  // Devuelve el motivo resumido para la traza del turno (p. ej. "meta_rejected 400/131053").
  const sendError = (kind: "text" | "image", reason: string, err?: unknown): string => {
    const meta = err instanceof MetaGraphApiError ? { http_status: err.httpStatus, meta_code: err.metaErrorCode ?? null } : null;
    console.error(JSON.stringify({ log: "agent_send_error", business_id: cliente.id_tenant, contact_ref: contactRef(input.waId), kind, reason, ...(meta ?? {}) }));
    return meta ? `${reason} ${meta.http_status ?? "?"}/${meta.meta_code ?? "?"}` : reason;
  };
  // Envío simulado (solo fuera de producción): un wamid ficticio para poder probar "responder a la foto" de punta a punta.
  const simulatedWamid = () => `wamid.sim.${randomUUID()}`;
  return {
    async sendText(text) {
      let wamid: string | null = simulated ? simulatedWamid() : null;
      if (!simulated) {
        const token = resolverTokenMeta(cliente);
        if (!token) {
          return { sent: false, wamid: null, error: sendError("text", "no_meta_token") };
        }
        try {
          ({ wamid } = await enviarTexto({ phoneNumberId: cliente.phone_number_id, token, para: input.destino, texto: text }));
        } catch (err) {
          return { sent: false, wamid: null, error: sendError("text", err instanceof MetaGraphApiError ? "meta_rejected" : "send_failed", err) };
        }
        await incrementarUsoMensajes(supabase, cliente);
      }
      await registrarMensaje(supabase, cliente.phone_number_id, input.waId, "saliente", text, "ia", wamid ?? undefined);
      return { sent: true, wamid };
    },
    async sendImage(image) {
      let wamid: string | null = simulated ? simulatedWamid() : null;
      if (!simulated) {
        const token = resolverTokenMeta(cliente);
        if (!token) {
          return { sent: false, wamid: null, error: sendError("image", "no_meta_token") };
        }
        try {
          ({ wamid } = await enviarMedia({ phoneNumberId: cliente.phone_number_id, token, para: input.destino, tipo: "image", link: image.url, caption: image.caption }));
        } catch (err) {
          return { sent: false, wamid: null, error: sendError("image", err instanceof MetaGraphApiError ? "meta_rejected" : "send_failed", err) };
        }
        await incrementarUsoMensajes(supabase, cliente);
      }
      await registrarMensaje(supabase, cliente.phone_number_id, input.waId, "saliente", `[imagen] ${image.caption}`, "ia", wamid ?? undefined);
      return { sent: true, wamid };
    },
    async sendButtons(body, buttons) {
      let wamid: string | null = simulated ? simulatedWamid() : null;
      if (!simulated) {
        const token = resolverTokenMeta(cliente);
        if (!token) {
          return { sent: false, wamid: null, error: sendError("text", "no_meta_token") };
        }
        try {
          ({ wamid } = await enviarBotones({ phoneNumberId: cliente.phone_number_id, token, para: input.destino, cuerpo: body, botones: buttons.map((b) => ({ id: b.id, titulo: b.title })) }));
        } catch (err) {
          return { sent: false, wamid: null, error: sendError("text", err instanceof MetaGraphApiError ? "meta_rejected" : "send_failed", err) };
        }
        await incrementarUsoMensajes(supabase, cliente);
      }
      // En el Inbox se ve la pregunta con sus opciones (el cliente responde con el título del botón).
      await registrarMensaje(supabase, cliente.phone_number_id, input.waId, "saliente", `${body}\n[${buttons.map((b) => b.title).join("] [")}]`, "ia", wamid ?? undefined);
      return { sent: true, wamid };
    },
    async sendList(body, buttonLabel, rows) {
      let wamid: string | null = simulated ? simulatedWamid() : null;
      if (!simulated) {
        const token = resolverTokenMeta(cliente);
        if (!token) {
          return { sent: false, wamid: null, error: sendError("text", "no_meta_token") };
        }
        try {
          ({ wamid } = await enviarLista({ phoneNumberId: cliente.phone_number_id, token, para: input.destino, cuerpo: body, boton: buttonLabel, filas: rows.map((r) => ({ id: r.id, titulo: r.title })) }));
        } catch (err) {
          return { sent: false, wamid: null, error: sendError("text", err instanceof MetaGraphApiError ? "meta_rejected" : "send_failed", err) };
        }
        await incrementarUsoMensajes(supabase, cliente);
      }
      // Igual que los botones: en el Inbox se ven las opciones (el cliente responde con el título de la fila).
      await registrarMensaje(supabase, cliente.phone_number_id, input.waId, "saliente", `${body}\n[${rows.map((r) => r.title).join("] [")}]`, "ia", wamid ?? undefined);
      return { sent: true, wamid };
    },
    humanTookOver: () => chatEnPausaHumana(supabase, cliente.phone_number_id, input.waId),
  };
}

async function nombreConocido(supabase: SupabaseClient, key: { phoneNumberId: string; waId: string }): Promise<string | null> {
  const { data } = await supabase.from("dulabs_clientes_conocidos").select("nombre").eq("phone_number_id", key.phoneNumberId).eq("telefono_cliente", key.waId).maybeSingle();
  const nombre = (data as { nombre?: string } | null)?.nombre?.trim();
  return nombre ? nombre.slice(0, 60) : null;
}

export function productionAgentBoundaryDeps(supabase: SupabaseClient, cliente: ClienteConfig): AgentBoundaryDeps {
  // Solo fuera de producción: E2E local contra un Gemini simulado por HTTP. En producción siempre la URL oficial.
  const baseUrl = process.env.NODE_ENV !== "production" ? process.env.DULABS_GEMINI_BASE_URL : undefined;
  const traces = createSupabaseTraceSink(supabase);
  // Guardados de trazas en curso: la frontera los espera al terminar (en serverless, lo no esperado se pierde).
  const pending = new Set<Promise<void>>();
  const persist = (p: Promise<void>) => {
    pending.add(p);
    void p.finally(() => pending.delete(p));
  };
  return {
    flush: async () => {
      await Promise.allSettled([...pending]);
    },
    configStore: createSupabaseAgentConfigStore(supabase),
    // Errores de la frontera (config inválida, sin credencial, buzón…): log + traza persistente.
    logError: (entry) => {
      defaultLogError(entry);
      const ref = typeof entry.contact_ref === "string" ? entry.contact_ref : null;
      if (ref) persist(traces.record(boundaryRecord(entry, { tenantId: cliente.id_tenant, phoneNumberId: cliente.phone_number_id, contactRef: ref, wamid: null })));
    },
    factories: baseUrl ? { gemini: (apiKey) => createGeminiProvider({ apiKey, baseUrl }) } : undefined,
    // Fuera de producción con envío simulado no se envía nada a Meta: no hace falta credencial.
    hasMetaCredential: (config) => {
      if (process.env.NODE_ENV !== "production" && process.env.DULABS_AGENTE_ENVIO_SIMULADO === "1") return true;
      try {
        return resolverTokenMetaAgente(cliente, config.metaPlatformToken) !== null;
      } catch {
        return false;
      }
    },
    build(input, config) {
      const catalogDeps = productionAgentToolDeps(supabase);
      if (!catalogDeps) return null;
      const tools: AgentToolsDeps = {
        ...catalogDeps,
        customerName: (k) => nombreConocido(supabase, k),
        // Bloque 34: cliente antiguo marcado por el equipo (Dashboard → Clientes).
        customerIsExisting: (k) => createSupabaseClientesRepo(supabase).yaCompro(k.tenantId, k.phoneNumberId, k.waId),
        // Bloque 27: el nombre que el cliente dio en el checkout (mismo registro que el resto de DuLabs).
        rememberCustomerName: (k, nombre) => recordarNombreCliente(supabase, { idTenant: k.tenantId, phoneNumberId: k.phoneNumberId, telefonoCliente: k.waId, nombre }),
        // Fase 3B.4: el documento de identidad se cifra al recibirlo (AES-256-GCM, TOKEN_ENCRYPTION_KEY).
        documentCipher: { encrypt: cifrarSecreto },
      };
      return {
        tools,
        state: createSupabaseConversationStateStore(supabase),
        history: createSupabaseHistoryStore(supabase),
        sender: whatsappSender(supabase, cliente, input, config.metaPlatformToken),
        media: createSupabaseProductMediaLedger(supabase),
        mailbox: createSupabaseMailboxStore(supabase),
        usage: createSupabaseUsageReader(supabase),
        classification: createSupabaseCustomerChannelStore(supabase),
        imageReader: ({ apiKey, model }) => crearLectorDeReferencias({ token: resolverTokenMetaAgente(cliente, config.metaPlatformToken), apiKey, model, baseUrl }),
        audioTranscriber: ({ apiKey, model }) => crearTranscriptorDeAudio({ token: resolverTokenMetaAgente(cliente, config.metaPlatformToken), apiKey, model, baseUrl }),
        noteTranscription: async (wamid, texto) => {
          // Solo la fila de ESTA nota de voz (entrante, de este contacto y número): la asesora y los turnos siguientes ven lo que dijo.
          await supabase
            .from("dulabs_mensajes_log")
            .update({ contenido: `${inboxLabel("audio")} ${texto}`.slice(0, 4_000) })
            .eq("phone_number_id", cliente.phone_number_id)
            .eq("telefono_cliente", input.waId)
            .eq("direccion", "entrante")
            .eq("wamid", wamid);
        },
        logTranscription: (t) => {
          // Sin el texto: solo resultado, tamaños y tokens (los tokens cuentan para el tope diario del negocio).
          console.info(JSON.stringify({ log: "agent_audio", business_id: cliente.id_tenant, ...t }));
          persist(
            traces.record({
              tenantId: cliente.id_tenant,
              phoneNumberId: cliente.phone_number_id,
              contactRef: t.contact_ref,
              kind: "turn",
              wamid: t.wamid,
              result: t.outcome === "transcrito" ? "audio_transcrito" : "audio_no_transcrito",
              trace: { rounds: 0, usage: { input: t.usage?.input ?? 0, output: t.usage?.output ?? 0, thinking: 0, cached: 0 }, audio: { outcome: t.outcome, bytes: t.bytes, chars: t.chars, ms: t.ms } },
            }),
          );
        },
        log: (trace) => {
          console.info(JSON.stringify(trace));
          persist(traces.record(turnRecord(trace, cliente.phone_number_id)));
        },
      };
    },
  };
}
