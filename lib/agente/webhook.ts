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
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "@/lib/supabase";
import { chatEnPausaHumana } from "@/lib/pausas-chat";
import { recordarNombreCliente } from "@/lib/clientes-conocidos";
import { MetaGraphApiError, enviarMedia, enviarTexto } from "@/lib/whatsapp";
import { enviarBotones, incrementarUsoMensajes, registrarMensaje, resolverTokenMeta } from "@/lib/whatsapp-outbound";
import { contactRef } from "@/lib/catalogo/pedidos/log";
import { productionAgentToolDeps } from "@/lib/catalogo/pedidos/produccion";
import { createGeminiProvider } from "@/lib/ia-proveedores/gemini";
import { validateAIProviderConfig, type AIProviderFactories } from "@/lib/ia-proveedores/registro";
import { crearLectorDeReferencias } from "@/lib/agente/lectura-referencias";
import { createSupabaseAgentConfigStore, loadAgentConfig, providerForConfig, type AgentConfigStore } from "@/lib/agente/config";
import { createSupabaseHistoryStore } from "@/lib/agente/contexto";
import { createSupabaseConversationStateStore } from "@/lib/agente/estado";
import { createSupabaseProductMediaLedger } from "@/lib/agente/medios";
import { batchInput, createSupabaseMailboxStore, drain, enqueueAndDrain, type DrainOptions, type MailboxMessage, type MailboxStore } from "@/lib/agente/buzon";
import type { NonTextKind } from "@/lib/agente/entrada";
import { boundaryRecord, createSupabaseTraceSink, turnRecord } from "@/lib/agente/trazas";
import { createSupabaseUsageReader } from "@/lib/agente/limites";
import { createSupabaseCustomerChannelStore } from "@/lib/agente/clasificacion";
import type { AgentToolsDeps } from "@/lib/agente/herramientas";
import { runAgentTurn, type AgentRuntimeDeps, type AgentSender, type AgentTurnTrace } from "@/lib/agente/runtime";

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
  nonText?: { kind: NonTextKind; caption?: string | null; mediaId?: string | null } | null;
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

export interface AgentBoundaryDeps {
  configStore: AgentConfigStore;
  /**
   * Construye el resto de dependencias solo si hay un agente válido (evita trabajo para los demás números).
   * Con `mailbox`, los mensajes pasan por el buzón y hay UN turno a la vez por conversación (Bloque 11).
   */
  build(input: AgentBoundaryInput): (Omit<AgentRuntimeDeps, "config" | "provider" | "model"> & { mailbox?: MailboxStore; drain?: DrainOptions; imageReader?: ImageReaderFactory }) | null;
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
  const rest = deps.build(input);
  if (!rest) {
    logError({ ...base, result: "unavailable", reason: "runtime_deps_unavailable" });
    return { handled: true, outcome: "unavailable", reason: "runtime_deps_unavailable" };
  }
  const { mailbox, drain: drainOptions, imageReader, ...runtimeDeps } = rest;
  const deps2: AgentRuntimeDeps = { ...runtimeDeps, config: cfg.config, provider: provider.provider, model: provider.model };
  // Bloque 29 (solo con el checkout conversacional): leer la referencia escrita en una foto del cliente.
  if (cfg.config.checkoutEnabled && imageReader && input.nonText?.kind === "image" && input.nonText.mediaId) {
    const valid = validateAIProviderConfig({ provider: cfg.config.provider, model: cfg.config.model, credentialRef: cfg.config.credentialRef });
    const apiKey = valid.ok ? (deps.env ?? process.env)[valid.envVar]?.trim() : undefined;
    if (valid.ok && apiKey) deps2.readImageReferences = imageReader({ apiKey, model: valid.model });
  }
  const key = { tenantId: input.cliente.id_tenant, phoneNumberId: input.cliente.phone_number_id, waId: input.waId };
  const single = () =>
    runAgentTurn(deps2, { ...key, wamid: input.wamid, text: input.text, replyTo: input.replyTo ?? null, nonText: input.nonText ?? null, buttonId: input.buttonId ?? null }).then((r) => ({ handled: true as const, outcome: r.outcome }));
  let last: AgentTurnTrace["outcome"] | null = null;
  const runBatch = async (batch: MailboxMessage[]) => {
    const b = batchInput(batch);
    const r = await runAgentTurn(deps2, { ...key, wamid: b.wamid, wamids: b.wamids, text: b.text, replyTo: b.replyTo });
    last = r.outcome;
    return r.trace.turn;
  };
  if (input.nonText) {
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
    { wamid: input.wamid, text: input.text, replyTo: input.replyTo ? { wamid: input.replyTo.wamid ?? null, forwarded: !!input.replyTo.forwarded } : null },
    runBatch,
    drainOptions,
  ).catch((err) => {
    logError({ ...base, result: "mailbox_error", reason: err instanceof Error ? err.message.slice(0, 120) : "unknown" });
    return { status: "unavailable" as const };
  });
  // Sin la migración del buzón (o si falló al encolar): un turno directo, como antes.
  if (drained.status === "unavailable") return single();
  if (drained.status === "queued") return { handled: true, outcome: "queued" };
  if (drained.leftPending) logError({ ...base, result: "mailbox_left_pending", turns: drained.turns });
  return { handled: true, outcome: last ?? "queued", turns: drained.turns };
}

/**
 * ¿El número tiene una fila de agente (aunque esté apagada o sea inválida)? Decide si un mensaje
 * SIN texto se registra en el Inbox y llega al agente (Bloque 23). Si no se puede leer: false,
 * es decir, el comportamiento de siempre para ese mensaje (se descarta); el texto no depende de esto.
 */
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

/** Envío real por WhatsApp Cloud API; registra en el historial (origen "ia") y cuenta el uso, igual que enviarWhatsApp. */
function whatsappSender(supabase: SupabaseClient, cliente: ClienteConfig, input: AgentBoundaryInput): AgentSender {
  const simulated = process.env.NODE_ENV !== "production" && process.env.DULABS_AGENTE_ENVIO_SIMULADO === "1";
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
    build(input) {
      const catalogDeps = productionAgentToolDeps(supabase);
      if (!catalogDeps) return null;
      const tools: AgentToolsDeps = {
        ...catalogDeps,
        customerName: (k) => nombreConocido(supabase, k),
        // Bloque 27: el nombre que el cliente dio en el checkout (mismo registro que el resto de DuLabs).
        rememberCustomerName: (k, nombre) => recordarNombreCliente(supabase, { idTenant: k.tenantId, phoneNumberId: k.phoneNumberId, telefonoCliente: k.waId, nombre }),
      };
      return {
        tools,
        state: createSupabaseConversationStateStore(supabase),
        history: createSupabaseHistoryStore(supabase),
        sender: whatsappSender(supabase, cliente, input),
        media: createSupabaseProductMediaLedger(supabase),
        mailbox: createSupabaseMailboxStore(supabase),
        usage: createSupabaseUsageReader(supabase),
        classification: createSupabaseCustomerChannelStore(supabase),
        imageReader: ({ apiKey, model }) => crearLectorDeReferencias({ token: resolverTokenMeta(cliente), apiKey, model, baseUrl }),
        log: (trace) => {
          console.info(JSON.stringify(trace));
          persist(traces.record(turnRecord(trace, cliente.phone_number_id)));
        },
      };
    },
  };
}
