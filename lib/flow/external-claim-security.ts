/**
 * Seguridad estructural fail-closed: CLAIM + CAPABILITY + PROVENANCE (Fase 4.4.7).
 *
 * Clasificación por estructura semántica — NO listas cerradas de frases.
 * Pipeline:
 *   1. Features estructurales (tiempo verbal, modalidad, dominio, longitud)
 *   2. responseIntent: acknowledgement | future_action | external_claim | completion_signal | conversational
 *   3. Contexto transaccional (último mensaje + historial disponible)
 *   4. CAPABILITY + VERIFIED PROVENANCE
 */

import { resolveActionCapabilitySpec } from "@/lib/flow/action-capabilities";
import { VERIFIED_RESULTS_VARIABLE_KEY } from "@/lib/flow/ai-runtime/verified-results";
import type { VerifiedActionResult } from "@/lib/flow/claude/claude-types";
import type { ActionNodeConfig, AssertionCapability, FlowMessageContent } from "@/lib/flow/types";

/** @deprecated Use ResponseIntent — kept for backward compat in tests */
export type TextSemanticClass =
  | "conversational"
  | "external_claim"
  | "completion_signal"
  | "acknowledgement"
  | "future_action";

export type ResponseIntent =
  | "conversational"
  | "acknowledgement"
  | "future_action"
  | "external_claim"
  | "completion_signal";

/** Clasificación de seguridad estructural (Fase 4.4.21 — carga de prueba invertida). */
export type ResponseSafetyClass =
  | "clearly_safe"
  | "requires_evidence";

/** Clasificación contextual del turno usuario relevante para claim security. */
export type UserContextKind =
  | "none"
  | "information"
  | "follow_up"
  | "request_action"
  | "state_question"
  | "confirmation_request"
  | "phatic";

export interface UserContextAnalysis {
  kind: UserContextKind;
  /** Capabilities transaccionales acumuladas (historial + último mensaje). */
  transactionalCaps: AssertionCapability[];
  /** Capabilities implícitas en una pregunta sobre estado externo. */
  stateQuestionCaps: AssertionCapability[];
  isTransactional: boolean;
  /** Respuesta modal corta en contexto de confirmación/estado → riesgo elevado. */
  requiresEvidenceForModalAck: boolean;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ClaimSecurityContext {
  /** Último mensaje del usuario. */
  userMessage?: string;
  /** Historial conversacional si está disponible en runtime. */
  conversationHistory?: ConversationTurn[];
  source?: "ai_response" | "message_template" | "message_resolved";
}

export interface ClaimAnalysisResult {
  semanticClass: TextSemanticClass;
  responseIntent: ResponseIntent;
  requiredCapabilities: AssertionCapability[];
  completionScore: number;
  conversationalSafe: boolean;
  /** Present when transactional burden-of-proof applies (4.4.21). */
  responseSafety?: ResponseSafetyClass;
}

export const ALL_ASSERTION_CAPABILITIES: AssertionCapability[] = [
  "appointment.reserved",
  "appointment.available",
  "payment.completed",
  "lead.created",
  "support.transferred",
];

const VARIABLE_PLACEHOLDER = /\{\{[a-zA-Z0-9_.]+\}\}/g;

const SOURCE_TO_ACTION: Record<string, ActionNodeConfig> = {
  consultar_disponibilidad: {
    actionType: "webhook_http",
    url: "",
    semanticTag: "consultar_disponibilidad",
  },
  reservar_cita: { actionType: "webhook_http", url: "", semanticTag: "reservar_cita" },
  agendar_cita_marketplace: { actionType: "agendar_cita_marketplace", params: {} },
  crear_lead_enterprise: { actionType: "crear_lead_enterprise", params: {} },
  crear_lead_campana: { actionType: "crear_lead_campana", params: {} },
  transferir_soporte: { actionType: "transferir_soporte" },
  consultar_pago: { actionType: "webhook_http", url: "", semanticTag: "consultar_pago" },
};

const DOMAIN_CAPABILITY_RULES: Array<{ pattern: RegExp; capabilities: AssertionCapability[] }> = [
  {
    pattern: /\b(cita|citas|horario|turno|espacio)\b|reserv\w+|agend\w+|asegur\w+/i,
    capabilities: ["appointment.reserved"],
  },
  { pattern: /disponib\w+|cupos?\b/i, capabilities: ["appointment.available"] },
  { pattern: /\btransferencia\b|\b(pago|pagos|cobro)\b|pagad\w+/i, capabilities: ["payment.completed"] },
  { pattern: /\b(solicitud|lead)\b|registr\w+/i, capabilities: ["lead.created"] },
  {
    pattern: /transf(?:er|i[eé]r|ir)\w*.*\b(soporte|humano|agente|asesor|especialista)\b|comunicad\w+|\b(soporte|humano|agente|asesor)\b/i,
    capabilities: ["support.transferred"],
  },
  { pattern: /enviad\w+|\benvi\w*\b/i, capabilities: ["lead.created", "payment.completed"] },
];

const USER_CANCEL_INTENT = /\b(cancel\w*|anul\w*)\b/i;

const USER_CONSULT_ONLY_INTENT = [
  /^(?:¿)?cu[aá]nto cuesta/i,
  /^qu[eé] precio/i,
  /^c[oó]mo funciona/i,
  /^qu[eé] incluye/i,
  /^informaci[oó]n sobre/i,
  /^cu[aá]l es el precio/i,
  /^qu[eé] horarios/i,
  /^cu[aá]les son los horarios/i,
];

/** Pregunta sobre estado externo ya ocurrido. */
const STATE_QUESTION_PATTERN =
  /(?:^|\s)(?:¿)?\s*(?:y[aá]|est[aá]|qued[oó]|fue|se (?:hizo|realiz[oó]|proces[oó]|complet[oó]|registr[oó])|confirmad|registrad|agendad|reservad|transferid|pasaron|comunicaron|realizad)/i;

const CONFIRMATION_REQUEST_PATTERN =
  /\b(me lo confirmas|lo confirmas|confirmas|conf[ií]rmame|puedes confirmar|pod[eé]s confirmar|confirma(?:r|me)?|est[aá] confirmad)\b/i;

const FOLLOW_UP_INFORMATION_PATTERN =
  /^(?:¿)?(a qu[eé] hora|qu[eé] hora|qu[eé] d[ií]a|qu[eé] fecha|para cu[aá]ndo|a las \d|el \d|ma[nñ]ana|hoy|pasado ma[nñ]ana|\d+\s*(?:am|pm|hrs?)?)$/i;

const ASSISTANT_SCHEDULING_QUESTION =
  /^(?:¿)?(qu[eé] d[ií]a|qu[eé] hora|a qu[eé] hora|para cu[aá]ndo|cu[aá]l hora|cu[aá]l d[ií]a)/i;

const STATE_QUESTION_CAPABILITY_RULES: Array<{ pattern: RegExp; capabilities: AssertionCapability[] }> = [
  { pattern: /reserv\w+|agend\w+|cita|citas|horario|turno|confirmad/i, capabilities: ["appointment.reserved"] },
  {
    pattern: /\btransferencia\b|(?:se (?:hizo|realiz[oó])|fue realizad\w*).*\btransfer|\bpag\w*|\bcobr\w*/i,
    capabilities: ["payment.completed"],
  },
  { pattern: /pasaron|comunicaron|\b(soporte|humano|agente)\b|transfer\w+.*\b(soporte|humano|agente)\b/i, capabilities: ["support.transferred"] },
  { pattern: /registr\w+|lead|solicitud/i, capabilities: ["lead.created"] },
  { pattern: /disponib\w+|cupo/i, capabilities: ["appointment.available"] },
];

const USER_INTENT_RULES: Array<{ pattern: RegExp; capabilities: AssertionCapability[] }> = [
  { pattern: /\b(reserv\w*|agend\w*|cita|citas|horario|turno)\b/i, capabilities: ["appointment.reserved"] },
  { pattern: /disponib\w+|cupos?\b/i, capabilities: ["appointment.available"] },
  { pattern: /\b(pago|pagos|pagar|cobro|compr\w*)\b/i, capabilities: ["payment.completed"] },
  { pattern: /\b(solicitud|registr\w*|lead)\b/i, capabilities: ["lead.created"] },
  { pattern: /\b(transf(?:er|i[eé]r|ir)\w*|soporte|humano|asesor)\b|\bpas(?:ar|en|es|arme|arte)\s+con\b/i, capabilities: ["support.transferred"] },
  { pattern: /\bquiero (hacer|realizar|gestionar|solicitar)\b/i, capabilities: ["lead.created"] },
];

const CONVERSATIONAL_INTENT_PATTERNS: RegExp[] = [
  /^claro,?\s+puedo ayudarte/i,
  /^puedo ayudarte/i,
  /^puedo consultar/i,
  /^voy a revisar/i,
  /^voy a consultar/i,
  /^voy a verificar/i,
  /^d[eé]jame (consultar|revisar|verificar|ver)/i,
  /^para (reservar|agendar|continuar) necesito/i,
  /^para continuar necesito/i,
  /^te ayudo a/i,
  /^necesito tu/i,
  /^necesito (el|tu|su)\s+(nombre|correo|tel[eé]fono|fecha|hora)/i,
  /^¿/,
  /\?\s*$/,
];

const PHATIC_USER_PATTERNS: RegExp[] = [
  /^(gracias|muchas gracias|ok|vale|perfecto|hola|buenos d[ií]as|buenas tardes|chao|adi[oó]s|bye)\b/i,
];

const PHATIC_AI_RESPONSE_PATTERNS: RegExp[] = [
  /^(de nada|con gusto|a la orden|un placer|hasta luego|adi[oó]s|chao|ok|vale)\b/i,
];

/** Raíces modales de reconocimiento — clase morfológica, no frases exactas. */
const MODAL_ACK_PATTERN =
  /^(claro|s[ií]|si|ok|vale|entend\w*|de acuerdo|comprend\w*|exact\w*|precis\w*|por supuesto|naturalmente|afirm\w*|desde luego)(?:\s|$|[,.!])/i;

/**
 * Raíces de cierre/completación — adjetivos/participios de estado final (primer lexema).
 * "va" exige coincidencia exacta (no prefijo) para no capturar "vamos/vale/vaya/varios".
 */
const CLOSURE_LEXEME_ROOT =
  /^(?:list|perfect|correct|anotad|aprob|dich|confirm|atendid|gestion|hech|realiz|proces|registr|reserv|agend)|^va$/i;

/**
 * Raíces morfológicas de estado terminal operacional — stems por clase, no verbos exhaustivos.
 * Cubren familias (-ado/-ido/-to) vía prefijo: resuelt→resuelto, finaliz→finalizada, etc.
 */
const TERMINAL_STATE_LEXEME_ROOT =
  /^(?:list|orden|resuelt|finaliz|complet|prepar|gestion|atend|proces|realiz|hech|solucion|confirm|reserv|agend|organiz|tramit|ejecut|absuelt|cubiert|encarg|atend)/i;

/** Participio irregular en -to/-ta — terminación morfológica + raíz mínima (no lista de verbos). */
const IRREGULAR_PARTICIPLE_TO_ROOT =
  /(?:ech|uelt|uest|ert|impres|abiert|cubiert|escrit|muert|romp|absuelt|puest|vist|dich|rot|suprim)/;

const FUTURE_ACTION_PATTERN =
  /(voy a|vamos a|ir[eé] a|d[eé]jame|dejar[eé]|podemos (?:revisar|consultar|verificar|buscar)|puedo (consultar|revisar|verificar|ayudar|buscar)|te ayudo|necesito (tu|su|el|la)|para (reservar|agendar|continuar)|estoy (consultando|revisando|verificando)|(?:^|\s)(adelante|procedo|procedemos|procedamos)(?:\s|$)|procedamos a)/i;

/**
 * Prefijo de acción futura del agente — misma clase que reconoce isPrimaryAgentFutureAction.
 * Fuente única compartida con REPORTING_VERB_QUE_SPLIT para evitar divergencia entre ambos.
 */
const AGENT_FUTURE_ACTION_PREFIX =
  /^(?:voy a|vamos a|ir[eé] a|d[eé]jame|dejar[eé]|proceder[eé] a|procedamos a)/i;

/**
 * Verbo de comunicación (verba dicendi) en infinitivo + clítico opcional — clase morfológica
 * cerrada, no lista de frases. Cuando sigue a un prefijo de acción futura del agente y antecede
 * a "que", introduce una cláusula subordinada completiva con contenido proposicional propio
 * (p. ej. "voy a decirte QUE tu espacio te espera..."), que debe evaluarse de forma independiente
 * en vez de heredar la seguridad del verbo de apertura ("voy a/vamos a").
 */
const REPORTING_VERB_QUE_SPLIT = new RegExp(
  "^(" +
    AGENT_FUTURE_ACTION_PREFIX.source.replace(/^\^/, "") +
    "\\s+(?:decir|contar|comentar|avisar|informar|confirmar|mencionar|explicar|aclarar|indicar|se[ñn]alar|revelar|anunciar|declarar|asegurar|garantizar|prometer)(?:te|le|les|nos)?" +
    ")\\s+que\\s+(.+)$",
  "i",
);

// Límite de palabra necesario para no matchear "est[aá]" dentro de "cuesta" ni "fue" dentro de
// "fuego". Pero el \b de JS es ASCII: falla tras vocal acentuada ("está"/"quedó" no tienen \b
// después de á/ó porque á/ó no son \w ASCII). Se usan lookbehind/lookahead sobre el alfabeto
// español para un límite de palabra correcto con acentos: excluye "cuesta" (u antes de esta) e
// incluye "está"/"quedó" (rodeados de no-letras).
const PAST_COMPLETION_PATTERN =
  /(?<![a-záéíóúüñ])(?:qued[oó]|fue|est[aá]|hemos|fueron|realizamos|registramos|transferimos|procesamos|enviamos|dejamos|gestionamos|comunicamos|reservamos|agendamos|confirmamos|aseguramos)(?![a-záéíóúüñ])/i;

/** Compromiso de acción futura — no afirmación de hecho completado. */
const COMMITMENT_PATTERN =
  /(nos encargamos|me encargo|nos ocupamos|lo vemos|lo revisamos|queda(?:r[aá])?\s+atendido|puedes contar con ello|cuenta con ello)/i;

const PARTICIPLE_STATE_PATTERN =
  /(confirmad\w*|agendad\w*|reservad\w*|completad\w*|procesad\w*|realizad\w*|registrad\w*|enviad\w*|transferid\w*|hech\w*|pagad\w*|recibid\w*|asegurad\w*|atendid\w*|gestionad\w*|cread\w*|bloquead\w*|comunicad\w*)/i;

interface StructuralFeatures {
  tokenCount: number;
  completionScore: number;
  domainCaps: AssertionCapability[];
  hasPastCompletion: boolean;
  hasParticipleState: boolean;
  hasYaTemporal: boolean;
  hasFutureAction: boolean;
  hasModalAcknowledgement: boolean;
  hasStandaloneClosure: boolean;
  hasForwardContinuation: boolean;
  hasModalRoot: boolean;
  hasClosureSignal: boolean;
  hasDeferredFutureAction: boolean;
}

function normalizeText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/¡/g, " ")
    // La interrogación es información ESTRUCTURAL (pregunta ≠ afirmación) que debe sobrevivir a
    // la normalización: se conserva "¿" y "?" como tokens propios en vez de borrarlos. "?" además
    // marca límite de cláusula (§) para separar "¿qué día? tu cita quedó lista" en pregunta+claim.
    .replace(/¿/g, " ¿ ")
    .replace(/[,;—–]/g, " § ")
    // ":" es límite de cláusula salvo entre dígitos (hora, "6:30") para no romper horarios.
    .replace(/(?<!\d)\s*:\s*(?!\d)/g, " § ")
    .replace(/\?/g, " ? § ")
    .replace(/[!.…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿/? conservados como tokens de interrogación por normalizeText. */
function propositionIsInterrogative(s: string): boolean {
  return /(?:^|\s)¿(?:\s|$)/.test(s) || /(?:^|\s)\?(?:\s|$)/.test(s);
}

function tokenize(normalized: string): string[] {
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

function firstLexeme(normalized: string): string {
  // Salta tokens de solo-puntuación (¿, ?, §) para que la detección modal/cierre no se vea
  // afectada por los marcadores de interrogación conservados en normalizeText.
  for (const token of tokenize(normalized)) {
    const lex = token.toLowerCase().replace(/[^a-záéíóúüñ0-9]/gi, "");
    if (lex) return lex;
  }
  return "";
}

function matchesModalAcknowledgement(normalized: string, tokenCount: number): boolean {
  if (/^de acuerdo$/i.test(normalized)) return true;
  if (/^por supuesto$/i.test(normalized)) return true;
  if (/^desde luego$/i.test(normalized)) return true;
  if (MODAL_ACK_PATTERN.test(normalized)) return true;
  if (/\bclaro\s+que\b/i.test(normalized)) return true;
  const lex = firstLexeme(normalized);
  return /^(claro|s[ií]|si|ok|vale|entiend\w*|entend\w*|comprend\w*|exact\w*|precis\w*|afirm\w*|naturalmente|supuesto|acuerdo)/i.test(lex);
}

/** Raíz modal en cualquier posición del enunciado — feature estructural, no gate de longitud. */
function detectModalRoot(normalized: string): boolean {
  if (matchesModalAcknowledgement(normalized, tokenize(normalized).length)) return true;
  for (const token of tokenize(normalized)) {
    const lex = token.toLowerCase().replace(/[^a-záéíóúüñ]/gi, "");
    if (/^(claro|s[ií]|si|ok|vale|entiend\w*|entend\w*|comprend\w*|exact\w*|precis\w*|afirm\w*|naturalmente|supuesto|acuerdo|desde|luego|entonces)/i.test(lex)) {
      return true;
    }
  }
  return /\bclaro\s+que\b/i.test(normalized);
}

/** Señal de cierre/completitud en cualquier lexema — no limitada al primer token. */
function detectClosureSignal(
  normalized: string,
  opts: { hasPastCompletion: boolean; hasParticipleState: boolean; lexeme: string; hasFutureAction: boolean; hasForwardContinuation: boolean; hasDeferredFutureAction: boolean },
): boolean {
  const standaloneClosure =
    CLOSURE_LEXEME_ROOT.test(opts.lexeme) &&
    !opts.hasFutureAction &&
    !opts.hasForwardContinuation &&
    !opts.hasDeferredFutureAction;
  if (standaloneClosure || opts.hasPastCompletion || opts.hasParticipleState) return true;
  for (const token of tokenize(normalized)) {
    const lex = token.toLowerCase().replace(/[^a-záéíóúüñ0-9]/gi, "");
    if (CLOSURE_LEXEME_ROOT.test(lex)) return true;
  }
  return false;
}

function splitIntoClauses(normalized: string): string[] {
  return normalized
    .split(/\s*§\s*|\s+-\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Separa "[voy a/vamos a/déjame/...] decirte QUE [contenido]" en el marco (verbo de apertura)
 * y la cláusula completiva subordinada, para que esta última se evalúe como proposición propia
 * en vez de heredar la seguridad estructural del verbo de comunicación que la introduce.
 */
function splitReportingVerbComplement(segment: string): string[] {
  const match = segment.match(REPORTING_VERB_QUE_SPLIT);
  if (!match) return [segment];
  const wrapper = match[1]?.trim();
  const complement = match[2]?.trim();
  if (!wrapper || !complement) return [segment];
  return [wrapper, complement];
}

/** Proposiciones analizables: cláusulas + segmentos por separador § / conectores. */
function enumeratePropositions(normalized: string): string[] {
  const clauses = splitIntoClauses(normalized);
  const source = clauses.length > 0 ? clauses : [normalized];
  const raw: string[] = [];
  for (const clause of source) {
    // "y" simple normalmente continúa el sujeto/acción del agente ("revisar y luego confirmar")
    // y no debe fragmentar. Pero cuando introduce un posesivo del cliente (tu/su/mi/nuestro/a)
    // cambia de sujeto — es una proposición nueva sobre "lo del cliente", no una continuación de
    // la acción propia del agente. Conservador a propósito: no se listan más conectores, se
    // detecta el cambio de sujeto estructuralmente.
    const segments = clause.split(
      /\s*(?:§|\spero\s|\sy\sadem[aá]s\s|\sin embargo\s|\sadem[aá]s\s|\sy\s+(?=(?:tu|su|mi|nuestro|nuestra)\b))\s*/i,
    );
    for (const seg of segments) {
      const trimmed = seg.trim();
      if (!trimmed) continue;
      for (const sub of splitReportingVerbComplement(trimmed)) {
        const subTrimmed = sub.trim();
        if (subTrimmed) raw.push(subTrimmed);
      }
    }
  }
  return coalescePropositions(raw.length > 0 ? raw : [normalized]);
}

/**
 * Raíces cuyo estado terminal es la forma DESNUDA en -o/-a (adjetivo nativo o participio
 * irregular): "listo/lista", "resuelto/resuelta", "hecho/hecha", "absuelto/absuelta",
 * "cubierto/cubierta". El resto de TERMINAL_STATE_LEXEME_ROOT son verbos regulares en -ar/-er
 * cuyo participio exige el sufijo -ado/-ido (ya cubierto por el patrón genérico de abajo) — su
 * forma en -o/-a desnuda es presente conjugado ("confirmo", "organizo", "proceso") o infinitivo
 * ("confirmar", "organizar"), una acción pendiente/ambigua, NUNCA un estado terminal.
 */
const BARE_ADJECTIVE_ROOT = /^(?:list|resuelt|hech|absuelt|cubiert)/i;

/**
 * Participio regular (-ado/-ido), raíz terminal o frase estructural "en orden".
 * El match de raíz (TERMINAL_STATE_LEXEME_ROOT/CLOSURE_LEXEME_ROOT) es un prefijo — coincide
 * tanto con el participio ("confirmado") como con el infinitivo ("confirmar") y el presente
 * conjugado ("confirmo") de la MISMA raíz. Exige evidencia POSITIVA de participio/adjetivo
 * (terminación vacía, -ado/-ido, o -o/-a solo para las raíces nativamente adjetivas) en vez de
 * intentar excluir cada terminación verbal ambigua una por una.
 */
type TerminalTokenKind = "root" | "generic" | "irregular" | "none";

/**
 * Clasifica CÓMO un token alcanza estado terminal:
 *  - "root": raíz operacional curada (reserv/confirm/agend…) o adjetivo/participio desnudo.
 *  - "generic": solo por el sufijo genérico -ado/-ido (incluye sustantivos homógrafos: "estado",
 *    "pedido", "entrada", "cuidado") → ambiguo, requiere desambiguación por contexto.
 *  - "irregular": participio irregular en -to/-cho.
 */
function terminalTokenKind(token: string): TerminalTokenKind {
  const lex = token.toLowerCase().replace(/[^a-záéíóúüñ]/gi, "");
  if (lex.length < 4) return "none";

  const rootHit = TERMINAL_STATE_LEXEME_ROOT.exec(lex) ?? CLOSURE_LEXEME_ROOT.exec(lex);
  if (rootHit) {
    const remainder = lex.slice(rootHit[0].length);
    const isParticipleSuffix = /^(?:ad[oa]s?|id[oa]s?)$/.test(remainder);
    const isBareAdjectiveTail = BARE_ADJECTIVE_ROOT.test(rootHit[0]) && /^[oa]s?$/.test(remainder);
    if (remainder === "" || isParticipleSuffix || isBareAdjectiveTail) return "root";
    // Otra terminación (infinitivo, presente conjugado, clíticos) no es estado terminal.
  }

  if (/\w+(?:ad[oa]s?|id[oa]s?)$/.test(lex) && lex.length >= 6) return "generic";
  if (/\w+[aei]?t[oa]s?$/.test(lex) && lex.length >= 5 && IRREGULAR_PARTICIPLE_TO_ROOT.test(lex)) {
    return "irregular";
  }
  return "none";
}

function isTerminalStateMorphology(token: string): boolean {
  return terminalTokenKind(token) !== "none";
}

/** Determinante que marca al siguiente token como SUSTANTIVO (no participio predicativo). */
const NOUN_DETERMINER =
  /^(?:el|la|los|las|un|una|unos|unas|mi|mis|tu|tus|su|sus|nuestro|nuestra|nuestros|nuestras|este|esta|estos|estas|ese|esa|esos|esas|del|al)$/i;

function hasTerminalStateTokens(p: string): boolean {
  if (/\b(?:todo\s+)?(?:est[aá]|queda|qued[aá]|se encuentra)\s+en\s+orden\b/i.test(p)) return true;
  if (/\btodo\s+(?:est[aá]|queda|qued[aá])\s+en\s+orden\b/i.test(p)) return true;

  const tokens = tokenize(p);
  for (let i = 0; i < tokens.length; i += 1) {
    const kind = terminalTokenKind(tokens[i]!);
    if (kind === "none") continue;
    // Un match SOLO-genérico precedido por determinante es un sustantivo homógrafo ("el estado",
    // "tu pedido", "la entrada"), no una afirmación de estado terminal. Las raíces curadas y los
    // participios irregulares no sufren esta ambigüedad y no se filtran.
    if (kind === "generic" && i > 0) {
      const prev = tokens[i - 1]!.toLowerCase().replace(/[^a-záéíóúüñ]/gi, "");
      if (NOUN_DETERMINER.test(prev)) continue;
    }
    return true;
  }
  return false;
}

/**
 * Posibilidad/hipótesis — no afirmación de hecho completado.
 * Distingue "podemos revisar" (acción colaborativa) de "podemos tener todo listo" (posibilidad de estado).
 */
function isHypotheticalOrPossibilityFrame(p: string): boolean {
  const s = stripLeadingModalPrefix(p);
  if (!s) return false;

  if (/^podemos\s+(?:revisar|consultar|verificar|comprobar|buscar|ver|agendar|reservar|continuar)/i.test(s)) {
    return false;
  }

  // Todas las ramas de hipótesis/posibilidad comparten la misma guarda: el matiz epistémico
  // ("podría", "tal vez"...) o la capacidad ofrecida ("podemos dejar/tener...") deja de ser
  // segura si la MISMA proposición además afirma un estado terminal — un "tal vez" pegado a
  // "ya está confirmada" no es incertidumbre genuina, es una afirmación con cobertura verbal.
  // Excepción: si el estado es condicional/diferido a un paso pendiente ("si confirmas los
  // datos", "antes de confirmar") no se afirma, se supedita. hasTerminalStateTokens (no el
  // combinador completo) para evitar recursión — esta función es invocada por
  // isPropositionOperationalResolution.
  // "antes de + infinitivo" (antes de confirmar/cerrar/revisar) difiere el estado a un paso
  // pendiente. "antes de las 5" es solo un plazo sobre un estado YA afirmado — no exime nada,
  // por eso se exige que la palabra siguiente tenga morfología de infinitivo (termine en ar/er/ir).
  const isConditionalOrDeferred =
    /\bsi\s+\w/i.test(s) || /\bantes\s+de\s+\w*(?:ar|er|ir)\b/i.test(s);
  const isClearlySafeGivenState = () => isConditionalOrDeferred || !hasTerminalStateTokens(s);

  if (/^(?:podr[ií]a|podr[ií]an|puede|pueden|quiz[aá]s|tal vez|capaz|eventualmente|ser[ií]a|ser[aá])\b/i.test(s)) {
    return isClearlySafeGivenState();
  }
  // "podemos + dejar/tener/quedar/conseguir/hacer" con objeto explícito ("hacer algo") ofrece
  // una CAPACIDAD de lograr un estado. Un clítico pegado SIN objeto ni marcador de aplazamiento
  // ("Claro, podemos hacerlo.") es un acknowledgement vago, no una acción futura demostrable —
  // debe seguir exigiendo evidencia en contexto transaccional, así que solo se admite el clítico
  // cuando además hay un adverbio explícito de aplazamiento ("hacerlo después/luego/mañana").
  if (/^podemos\s+(?:tener|dejar|quedar|conseguir|hacer)\s+/i.test(s)) {
    return isClearlySafeGivenState();
  }
  if (
    /^podemos\s+(?:tener|dejar|quedar|conseguir|hacer)(?:lo|la|los|las|le|les)\s+(?:despu[eé]s|luego|m[aá]s\s+tarde|en\s+un\s+momento|pronto|ma[nñ]ana)\b/i.test(
      s,
    )
  ) {
    return isClearlySafeGivenState();
  }
  if (/\b(?:podr[ií]a|podr[ií]an|puede)\s+(?:tener|dejar|quedar|conseguir)(?:lo|la|los|las|le|les)?\b/i.test(s)) {
    return isClearlySafeGivenState();
  }

  return false;
}

/**
 * Resolución/completitud operacional por estructura:
 *   agente + posesión/copula/pasiva + (alcance?) + estado terminal morfológico.
 * No depende de enumerar verbos concretos (resuelto, solucionado, etc.).
 */
function isPropositionOperationalResolution(prop: string): boolean {
  const p = stripLeadingModalPrefix(prop);
  if (!p) return false;
  if (isPropositionDirectNegativeState(p)) return false;
  if (isHypotheticalOrPossibilityFrame(p)) return false;
  if (!hasTerminalStateTokens(p)) return false;

  if (isPrimaryAgentFutureAction(p)) {
    const withoutFutureLead = p
      .replace(/^(?:primero|antes(?:\s+de)?)\s+(?:voy a|vamos a|\w+ar[eé])\s+\S+/i, "")
      .replace(/\b(?:voy a|vamos a|ir[eé] a|d[eé]jame)\s+\S+/gi, "")
      .trim();
    if (!withoutFutureLead || !hasTerminalStateTokens(withoutFutureLead)) return false;
  }

  const hasAgentPossession =
    /\b(?:tenemos|contamos(?:\s+con)?|hemos(?:\s+dejado)?|de nuestra parte|de mi parte|nuestro equipo)\b/i.test(p);
  const hasOrganizationalFrame = /\bde nuestra parte\b|\bde mi parte\b|\bde nuestro lado\b/i.test(p);
  const hasScopeMarker =
    /\b(?:todo|todos|toda|todas|la gesti[oó]n|el proceso|la solicitud|la operaci[oó]n|lo necesario|el tr[aá]mite|el asunto|el pedido)\b/i.test(p);
  const hasCopulaResolution =
    /\b(?:est[aá]|est[aá]n|qued[oó]|qued[aá]n|fue|fueron|se encuentra|se encuentran|aparece|aparecen|se muestra|se muestran|se ha|se han|ha sido|han sido)\b/i.test(p);
  const hasAgentPastResolution =
    /\b(?:hemos|han|ha|he|dejamos|gestionamos|procesamos|completamos|finalizamos)\s+\w+/i.test(p);
  const hasPassiveResolution =
    /\bse\s+(?:complet[oó]|finaliz[oó]|proces[oó]|realiz[oó]|ha\s+\w+|encuentra)\b/i.test(p);

  if (hasOrganizationalFrame && (hasAgentPossession || hasTerminalStateTokens(p))) return true;
  if (hasAgentPossession && hasScopeMarker) return true;

  if (hasAgentPossession) {
    const tokens = tokenize(p);
    const possIdx = tokens.findIndex((t) =>
      /^(?:tenemos|contamos|hemos)$/i.test(t.toLowerCase().replace(/[^a-záéíóúüñ]/gi, "")),
    );
    const termIdx = tokens.findIndex((t) => isTerminalStateMorphology(t));
    if (possIdx >= 0 && termIdx > possIdx) return true;
  }

  if (hasCopulaResolution && hasTerminalStateTokens(p)) return true;
  if (hasAgentPastResolution) return true;
  if (hasPassiveResolution) return true;

  return false;
}

/** Alguna proposición comunica resolución/completitud operacional estructural. */
function hasOperationalResolutionAnywhere(normalized: string): boolean {
  for (const prop of enumeratePropositions(normalized)) {
    if (isPropositionOperationalResolution(prop)) return true;
  }
  return false;
}

/** Prefijo modal o de cierre breve (Perfecto, Listo, Claro…) — no afirmación operacional. */
function isModalOrClosurePrefix(segment: string): boolean {
  const p = stripLeadingModalPrefix(segment);
  if (!p) return true;
  if (tokenize(p).length > 3) return false;
  if (detectModalRoot(p)) return true;
  const lex = firstLexeme(p);
  return CLOSURE_LEXEME_ROOT.test(lex);
}

function isBareNegationPrefix(segment: string): boolean {
  return /^no$/i.test(stripLeadingModalPrefix(segment).trim());
}

/** Une prefijo modal con la proposición siguiente (p. ej. "sí § voy a consultar"). */
function coalescePropositions(segments: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const current = segments[i]!;
    const next = segments[i + 1];
    if (next && isBareNegationPrefix(current)) {
      out.push(`${current} ${next}`);
      i += 1;
      continue;
    }
    if (next) {
      const modalOnly =
        tokenize(current).length <= 3 &&
        isModalOrClosurePrefix(current) &&
        !isPropositionDirectNegativeState(current) &&
        !isPropositionPositiveCompletion(current) &&
        !isPropositionNegatingIncompleteState(current);
      if (modalOnly && isPrimaryAgentFutureAction(next)) {
        out.push(`${current} ${next}`);
        i += 1;
        continue;
      }
    }
    out.push(current);
  }
  return out;
}

/** Quita prefijo modal inicial para analizar la proposición principal. */
function stripLeadingModalPrefix(clause: string): string {
  let rest = clause;
  for (let i = 0; i < 4; i += 1) {
    const next = rest.replace(
      /^(?:no,?\s+)?(claro(?:\s+que\s+s[ií])?|s[ií]|si|ok|vale|por supuesto|de acuerdo|perfecto|entendido|tranquilo|exacto|naturalmente|desde luego|entonces|entiendo)[,\s]+/i,
      "",
    );
    if (next === rest) break;
    rest = next.trim();
  }
  return rest;
}

/** Negación de estado incompleto/pendiente → implica resolución (afirmación positiva estructural). */
function isPropositionNegatingIncompleteState(prop: string): boolean {
  const p = stripLeadingModalPrefix(prop);
  return (
    /\bno\s+qued[oó]\s+(?:pendiente|a medias|incomplet)/i.test(p) ||
    /\bno\s+est[aá]\s+(?:sin\s+\w+|incomplet|pendiente)/i.test(p)
  );
}

/** Negación directa de estado completado — "no está reservado", "todavía no…". */
function isPropositionDirectNegativeState(prop: string): boolean {
  const p = stripLeadingModalPrefix(prop);
  if (!p || isPropositionNegatingIncompleteState(p)) return false;

  if (/\b(?:no,? todav[ií]a|todav[ií]a no|a[uú]n no)\b/i.test(p)) return true;
  if (/\bno se ha\b/i.test(p)) return true;
  if (/\bno\s+est[aá]\s+listo/i.test(p)) return true;
  if (/\bno\s+qued[oó]\s+completad/i.test(p)) return true;
  if (/\bfalta verificar|\bfalta revisar/i.test(p)) return true;

  if (/\bno\s+(?:est[aá]|qued[oó]|fue|se ha)\s+/i.test(p)) {
    if (
      PARTICIPLE_STATE_PATTERN.test(p) ||
      /\b(?:reservad|confirmad|agendad|procesad|realizad|completad|listo|hech|realiz|procesad|transferid)\w*/i.test(p)
    ) {
      return true;
    }
  }

  return false;
}

/** Afirmación positiva de completitud en una proposición aislada. */
function isPropositionPositiveCompletion(prop: string): boolean {
  const p = stripLeadingModalPrefix(prop);
  if (!p) return false;
  if (isPropositionDirectNegativeState(p)) return false;
  if (isHypotheticalOrPossibilityFrame(p)) return false;
  // Inspección futura ("déjame ver quién está disponible"): el estado se examina dentro de una
  // pregunta indirecta, no se afirma → no cuenta como completitud de la respuesta.
  if (isFutureInspection(p)) return false;
  if (isPropositionNegatingIncompleteState(p)) return true;

  if (/\bya\s+no\s+necesit/i.test(p)) return true;
  if (scoreCompletionMorphology(p) >= 2) return true;

  if (/\bya\b/i.test(p) && (PARTICIPLE_STATE_PATTERN.test(p) || PAST_COMPLETION_PATTERN.test(p))) {
    return true;
  }

  if (
    /(?:qued[oó]|est[aá]|fue|se\s+(?:complet[oó]|proces[oó]|realiz[oó]|ha\s+realizad\w*))\s+/i.test(p) &&
    (PARTICIPLE_STATE_PATTERN.test(p) ||
      /\b(?:confirmad|reservad|agendad|procesad|realizad|completad|gestionad|transferid|hech)\w*/i.test(p))
  ) {
    return true;
  }

  if (/\b(?:se complet[oó]|fue procesad|fue realizad|ya gestionamos|ya transferimos)\b/i.test(p)) return true;

  if (isPropositionOperationalResolution(p)) return true;

  return false;
}

/**
 * Proposición que expresa estado negativo/incompleto sin afirmación positiva en la misma unidad.
 * La negación solo afecta su propio contexto — no silencia otras proposiciones.
 */
function isPropositionPureNegativeIncomplete(prop: string): boolean {
  return isPropositionDirectNegativeState(prop);
}

/** Alguna proposición afirma completitud/estado externo positivo. */
function hasPositiveCompletionAnywhere(normalized: string, _features: StructuralFeatures): boolean {
  for (const prop of enumeratePropositions(normalized)) {
    if (isPropositionPositiveCompletion(prop)) return true;
  }
  return false;
}

/**
 * Respuesta globalmente negativa/incompleta — solo si ninguna proposición afirma completitud.
 * NO usa coincidencia global de subcadenas "no quedó"/"no está" sobre todo el texto.
 */
function isNegativeIncompleteState(normalized: string, features: StructuralFeatures): boolean {
  if (hasPositiveCompletionAnywhere(normalized, features)) return false;

  for (const prop of enumeratePropositions(normalized)) {
    if (isPropositionPureNegativeIncomplete(prop)) return true;
  }
  return false;
}

/**
 * Completitud/estado externo en la cláusula principal.
 * Prioridad sobre future action incidental en cláusulas secundarias.
 */
function hasPrimaryCompletionSignal(normalized: string, features: StructuralFeatures): boolean {
  if (hasPositiveCompletionAnywhere(normalized, features)) return true;

  if (isNegativeIncompleteState(normalized, features)) return false;

  if (features.hasPastCompletion || features.hasParticipleState) {
    if (hasPositiveCompletionAnywhere(normalized, features)) return true;
  }
  if (features.completionScore >= 2 && hasPositiveCompletionAnywhere(normalized, features)) return true;

  const primary = splitIntoClauses(normalized)[0] ?? normalized;

  if (!isHypotheticalOrPossibilityFrame(primary)) {
    if (scoreCompletionMorphology(primary) >= 2 && hasPositiveCompletionAnywhere(normalized, features)) return true;
    if (scoreCompletionMorphology(primary) >= 2 && hasOperationalResolutionAnywhere(normalized)) return true;
    if (PAST_COMPLETION_PATTERN.test(primary) || PARTICIPLE_STATE_PATTERN.test(primary)) {
      if (hasPositiveCompletionAnywhere(normalized, features)) return true;
    }
  }

  if (/\bya\s+no\s+necesit/i.test(primary)) return true;
  if (/\bno\s+(?:hace falta|queda nada|necesitas hacer)/i.test(primary)) return true;

  if (/\bya\b/i.test(primary)) {
    if (scoreCompletionMorphology(primary) >= 1) return true;
    if (PAST_COMPLETION_PATTERN.test(primary) || PARTICIPLE_STATE_PATTERN.test(primary)) return true;
  }

  if (hasOperationalResolutionAnywhere(normalized)) return true;

  return false;
}

/**
 * Acción futura donde el agente de la respuesta (yo/nosotros) ejecutará la acción.
 * Excluye deferral al usuario (puedes/tu/cualquier… consultar después).
 */
function isPrimaryAgentFutureAction(clause: string): boolean {
  const c = stripLeadingModalPrefix(clause);
  if (!c) return false;

  if (/^(?:puedes|pod[eé]s|puede|si quieres|cualquier)\b/i.test(c)) return false;
  if (/\b(?:puedes|pod[eé]s)\s+\w*\s*(?:consultar|revisar|verificar|comprobar|buscar)\b/i.test(c) &&
    !/^(?:voy a|vamos a|ir[eé] a|d[eé]jame|proceder[eé]|procedamos|podemos)\b/i.test(c)) {
    return false;
  }

  return (
    /^(?:primero|antes(?:\s+de)?)\s+(?:voy a|vamos a|ir[eé]|consultar|revisar|verificar|comprobar|\w+ar[eé])/i.test(c) ||
    /^(?:voy a|vamos a|ir[eé] a|d[eé]jame|dejar[eé]|proceder[eé] a|procedamos a)\s/i.test(c) ||
    /^podemos\s+(?:revisar|consultar|verificar|buscar|comprobar)/i.test(c) ||
    /^(?:consultar[eé]|revisar[eé]|verificar[eé]|comprobar[eé]|buscar[eé])\b/i.test(c) ||
    /\b(?:voy a|vamos a|ir[eé] a|d[eé]jame|proceder[eé] a|procedamos a)\s+(?:consultar|revisar|verificar|comprobar|buscar|ver)/i.test(c) ||
    /\b(?:todav[ií]a\s+)?voy a\s+(?:consultar|revisar|verificar|comprobar|buscar)/i.test(c) ||
    /\b(?:primero|antes)\s+(?:voy a|vamos a|\w+ar[eé])/i.test(c)
  );
}

/**
 * Estado terminal/resolución/completitud en UNA proposición ya delimitada — combina las tres
 * señales independientes que el archivo usa para "esto ya ocurrió": token léxico terminal,
 * resolución operacional estructural (cópula/posesión de agente/pasiva) y completitud positiva
 * (participios rastreados, "ya" + marcador, morfología puntuada). Única función que debe
 * consultarse antes de conceder SAFE a una proposición por su verbo de apertura — evita que dos
 * categorías (future-action, hipotética, patrón conversacional...) usen guardas distintas.
 * NOTA: no debe llamarse desde isPropositionOperationalResolution/isPropositionPositiveCompletion
 * ni desde nada que ellas invoquen (isHypotheticalOrPossibilityFrame incluido) — crearía recursión.
 */
function propositionAssertsTerminalState(p: string): boolean {
  return (
    hasTerminalStateTokens(p) ||
    isPropositionOperationalResolution(p) ||
    isPropositionPositiveCompletion(p)
  );
}

/**
 * Misma propiedad que propositionAssertsTerminalState, pero evaluada sobre una respuesta
 * completa (posiblemente varias cláusulas fusionadas sin separador reconocido) en vez de una
 * única proposición ya delimitada — usa las variantes "Anywhere" para no perder señal cuando
 * enumeratePropositions no logró partir el texto (p. ej. conectores no cubiertos).
 */
function responseAssertsTerminalStateAnywhere(normalized: string, features: StructuralFeatures): boolean {
  return (
    hasTerminalStateTokens(normalized) ||
    hasOperationalResolutionAnywhere(normalized) ||
    hasPositiveCompletionAnywhere(normalized, features)
  );
}

/**
 * CONVERSATIONAL_INTENT_PATTERNS por sí solo NO es evidencia de seguridad: varias de sus
 * entradas ("^voy a revisar", "^voy a consultar", "^déjame consultar"...) son la MISMA clase de
 * "future action segura" que isClearlySafeFutureAction ya guarda, pero sin límite de fin de
 * cadena — matchean aunque el resto de la respuesta afirme un estado terminal a continuación
 * ("voy a consultar horarios y tu cita queda reservada"). Todo punto de uso debe pasar por aquí.
 */
function matchesSafeConversationalPattern(normalized: string, features: StructuralFeatures): boolean {
  if (!CONVERSATIONAL_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return !responseAssertsTerminalStateAnywhere(normalized, features);
}

/** Verbos de percepción/inspección — examinan un estado, no lo producen (≠ dejar/hacer/preparar). */
const PERCEPTION_VERB = /(?:ver|mirar|revisar|consultar|verificar|comprobar|buscar|checar|chequear|averiguar)/;

/**
 * Palabra de pregunta indirecta que introduce un complemento inspeccionado. Interrogativos
 * ACENTUADOS (qué/quién/cuál/…) + "si" (disyuntiva indirecta). Se exige la tilde para NO capturar
 * el complementizador átono "que" ("ver QUE tu cita quedó reservada" es una afirmación directa,
 * no una pregunta indirecta, y debe seguir bloqueada).
 */
const INDIRECT_QUESTION_WORD =
  /(?:qui[é]n(?:es)?|qu[é]|si|cu[á]ndo|c[ó]mo|d[ó]nde|cu[á]l(?:es)?|cu[á]nt[oa]s?)/;

/**
 * Inspección futura: "[voy a/déjame/…] + verbo de percepción + … + pregunta indirecta"
 * (p. ej. "déjame ver quién está disponible"). El estado ("está disponible") vive DENTRO de la
 * pregunta indirecta que se inspecciona — no es una afirmación de la respuesta. Se exige verbo de
 * percepción (no "dejar/hacer/preparar", que SÍ producen el estado → resultativos como "voy a
 * dejarte tu cita lista" quedan fuera y siguen bloqueados) e interrogativo ACENTUADO (no el "que"
 * completivo átono: "voy a ver que tu cita quedó reservada" no es inspección y sigue bloqueado).
 */
function isFutureInspection(clause: string): boolean {
  const c = stripLeadingModalPrefix(clause);
  const m = c.match(
    new RegExp(
      `^(?:voy a|vamos a|ir[eé] a|d[eé]jame|dejar[eé]|proceder[eé] a|procedamos a|puedo|podemos)\\s+${PERCEPTION_VERB.source}\\b(.*)$`,
      "i",
    ),
  );
  if (!m) return false;
  const rest = m[1] ?? "";
  return new RegExp(`(?:^|\\s)${INDIRECT_QUESTION_WORD.source}(?:\\s|$)`, "i").test(rest);
}

/**
 * Única definición de "acción futura del agente CLARAMENTE segura" — FUTURE ACTION + TERMINAL
 * STATE ≠ CLEARLY SAFE. Toda proposición futura que además afirme un estado terminal (objeto
 * "listo/preparado/organizado/solucionado/etc.") deja de ser evidencia de seguridad, sin
 * importar el verbo de apertura ("voy a", "vamos a", "déjame", "podemos"...). Cada punto del
 * archivo que trate una acción futura como evidencia de seguridad debe llamar a esta función
 * en vez de reimplementar la combinación — evita que dos capas diverjan en el mismo criterio.
 * Excepción: la inspección futura (verbo de percepción + pregunta indirecta) es segura aunque el
 * estado inspeccionado tenga morfología terminal — se examina, no se afirma.
 */
function isClearlySafeFutureAction(clause: string): boolean {
  if (!isPrimaryAgentFutureAction(clause)) return false;
  if (isFutureInspection(clause)) return true;
  return !propositionAssertsTerminalState(clause);
}

/**
 * Acción futura diferida — propósito principal de la respuesta, NO presencia léxica incidental.
 * COMPLETION/EXTERNAL CLAIM tiene prioridad; la negación en una proposición no silencia
 * acción futura en otra (p. ej. "No está reservado todavía, voy a verificar…").
 */
function detectDeferredFutureAction(normalized: string, features: StructuralFeatures): boolean {
  if (hasPrimaryCompletionSignal(normalized, features)) return false;

  for (const prop of enumeratePropositions(normalized)) {
    if (isPrimaryAgentFutureAction(prop)) return true;
  }

  return isPrimaryAgentFutureAction(normalized);
}

/**
 * Respuesta modal/cierre que puede interpretarse como confirmación o completitud.
 * NO usa tokenCount — la decisión de seguridad es contextual + semántica.
 */
function isAmbiguousAckOrClosureResponse(normalized: string, features: StructuralFeatures): boolean {
  if (hasPrimaryCompletionSignal(normalized, features)) return true;
  if (detectDeferredFutureAction(normalized, features)) return false;

  const props = enumeratePropositions(normalized);
  if (
    props.length > 0 &&
    props.every((prop) => {
      const p = stripLeadingModalPrefix(prop);
      return (
        isExplicitUncertaintyOrDeferral(prop) ||
        isPropositionDirectNegativeState(p) ||
        isClearlySafeFutureAction(p)
      );
    })
  ) {
    return false;
  }

  if (
    enumeratePropositions(normalized).some((p) => isHypotheticalOrPossibilityFrame(p)) &&
    !hasOperationalResolutionAnywhere(normalized) &&
    !hasPositiveCompletionAnywhere(normalized, features)
  ) {
    return false;
  }
  if (features.completionScore >= 2) return false;
  if (features.hasForwardContinuation && !features.hasDeferredFutureAction) return true;
  return features.hasModalRoot || features.hasClosureSignal || features.hasModalAcknowledgement;
}
function isConsultOnlyUserIntent(userMessage: string): boolean {
  return USER_CONSULT_ONLY_INTENT.some((p) => p.test(normalizeText(userMessage)));
}

function isCancelUserIntent(userMessage: string): boolean {
  const normalized = normalizeText(userMessage);
  if (!USER_CANCEL_INTENT.test(normalized)) return false;
  return /\b(cita|citas|horario|turno)\b|reserv\w+|agend\w+/i.test(normalized);
}

/** @deprecated Replaced by structural closure detection — kept for test migration. */
export function isContextualClosureSignal(text: string): boolean {
  const features = extractStructuralFeatures(text);
  return features.hasStandaloneClosure || features.hasPastCompletion || features.hasParticipleState;
}

function extractStructuralFeatures(text: string): StructuralFeatures {
  const normalized = normalizeText(text);
  const tokens = tokenize(normalized);
  const tokenCount = tokens.length;
  const completionScore = scoreCompletionMorphology(normalized);
  const domainCaps = detectDomainCapabilities(normalized);
  const hasPastCompletion = PAST_COMPLETION_PATTERN.test(normalized);
  const hasParticipleState = PARTICIPLE_STATE_PATTERN.test(normalized);
  const hasYaTemporal = /\bya\b/i.test(normalized);
  const hasFutureAction = FUTURE_ACTION_PATTERN.test(normalized);
  const hasForwardContinuation = /(?:^|\s)(adelante|procedo|procedemos|siguiente paso)(?:\s|$)/i.test(normalized);
  const lexeme = firstLexeme(normalized);
  const corePhrase = tokens.slice(0, Math.min(tokens.length, 3)).join(" ");

  const hasModalRoot = detectModalRoot(normalized);
  const hasDeferredFutureAction = detectDeferredFutureAction(normalized, {
    tokenCount,
    completionScore,
    domainCaps,
    hasPastCompletion,
    hasParticipleState,
    hasYaTemporal,
    hasFutureAction,
    hasModalAcknowledgement: false,
    hasStandaloneClosure: false,
    hasForwardContinuation,
    hasModalRoot,
    hasClosureSignal: false,
    hasDeferredFutureAction: false,
  });
  const hasClosureSignal = detectClosureSignal(normalized, {
    hasPastCompletion,
    hasParticipleState,
    lexeme,
    hasFutureAction,
    hasForwardContinuation,
    hasDeferredFutureAction,
  });

  const hasModalAcknowledgement =
    (matchesModalAcknowledgement(normalized, tokenCount) || MODAL_ACK_PATTERN.test(corePhrase) || hasModalRoot) &&
    !hasPastCompletion &&
    !hasParticipleState &&
    !(hasYaTemporal && !hasDeferredFutureAction) &&
    !CLOSURE_LEXEME_ROOT.test(lexeme);

  const hasStandaloneClosure =
    CLOSURE_LEXEME_ROOT.test(lexeme) &&
    !hasFutureAction &&
    !hasForwardContinuation &&
    !hasDeferredFutureAction;

  return {
    tokenCount,
    completionScore,
    domainCaps,
    hasPastCompletion,
    hasParticipleState,
    hasYaTemporal,
    hasFutureAction,
    hasModalAcknowledgement,
    hasStandaloneClosure,
    hasForwardContinuation,
    hasModalRoot,
    hasClosureSignal,
    hasDeferredFutureAction,
  };
}

/** Puntúa morfología de completación (estructura gramatical). */
export function scoreCompletionMorphology(text: string): number {
  const t = normalizeText(text);
  if (!t) return 0;

  let score = 0;

  if (PAST_COMPLETION_PATTERN.test(t)) score += 2;
  if (PARTICIPLE_STATE_PATTERN.test(t)) score += 2;
  if (/(con\s+[eé]xito|todo\s+listo|operaci[oó]n\s+(?:completad\w*|exitos\w*)|proceso\s+completad\w*)/i.test(t)) score += 2;
  if (hasOperationalResolutionAnywhere(t)) score += 2;
  if (/\bya\s+(est[aá]|qued[oó]|fue|lo|te|se|es)/i.test(t)) score += 2;
  if (/(qued[oó]\s+(reservad\w*|agendad\w*|confirmad\w*|hech\w*|procesad\w*|realizad\w*))/i.test(t)) score += 2;
  if (/est[aá]\s+(reservad\w*|confirmad\w*|hech\w*|procesad\w*|realizad\w*|disponible|asegurad\w*)/i.test(t)) score += 2;
  if (/\b(tuyo|tuya|tienes|te queda)\b/i.test(t)) score += 1;

  return score;
}

export function hasCompletionMorphology(text: string): boolean {
  return scoreCompletionMorphology(text) >= 2;
}

export function detectDomainCapabilities(text: string): AssertionCapability[] {
  const caps = new Set<AssertionCapability>();
  for (const rule of DOMAIN_CAPABILITY_RULES) {
    if (rule.pattern.test(text)) {
      for (const cap of rule.capabilities) caps.add(cap);
    }
  }
  return [...caps];
}

export function inferCapabilitiesFromUserIntent(userMessage?: string): AssertionCapability[] {
  if (!userMessage) return [];
  const normalized = normalizeText(userMessage);
  if (!normalized) return [];

  if (isCancelUserIntent(normalized)) return [];
  if (isConsultOnlyUserIntent(normalized)) return [];

  const caps = new Set<AssertionCapability>();
  for (const rule of USER_INTENT_RULES) {
    if (rule.pattern.test(normalized)) {
      for (const cap of rule.capabilities) caps.add(cap);
    }
  }
  return [...caps];
}

/** Agrega intención transaccional del historial + último mensaje. */
export function inferCapabilitiesFromConversationContext(context?: ClaimSecurityContext): AssertionCapability[] {
  const caps = new Set<AssertionCapability>();

  if (context?.conversationHistory) {
    for (const turn of context.conversationHistory) {
      if (turn.role !== "user") continue;
      for (const cap of inferCapabilitiesFromUserIntent(turn.content)) caps.add(cap);
    }
  }

  for (const cap of inferCapabilitiesFromUserIntent(context?.userMessage)) caps.add(cap);
  return [...caps];
}

function getPriorAssistantTurn(context?: ClaimSecurityContext): string | undefined {
  const history = context?.conversationHistory ?? [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn?.role === "assistant") return turn.content;
  }
  return undefined;
}

function hasRequestActionInHistory(context?: ClaimSecurityContext): boolean {
  const history = context?.conversationHistory ?? [];
  for (const turn of history) {
    if (turn.role !== "user") continue;
    if (inferCapabilitiesFromUserIntent(turn.content).length > 0) return true;
  }
  return false;
}

function isInformationQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    isConsultOnlyUserIntent(normalized) ||
    /\binformaci[oó]n (sobre|del|de|acerca)\b/i.test(normalized) ||
    /^(?:¿)?(qu[eé] horarios|cu[aá]les son|c[oó]mo funciona|qu[eé] incluye|informaci[oó]n)/i.test(normalized)
  );
}

function isStateQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  const isQuestion = /\?/.test(text) || /^¿/.test(text) || /^(?:y[aá]|est[aá]|qued[oó]|fue)\b/i.test(normalized);
  return isQuestion && STATE_QUESTION_PATTERN.test(normalized);
}

function isConfirmationRequest(text: string): boolean {
  return CONFIRMATION_REQUEST_PATTERN.test(normalizeText(text));
}

function isFollowUpInformation(text: string, priorAssistant?: string): boolean {
  const normalized = normalizeText(text);
  if (FOLLOW_UP_INFORMATION_PATTERN.test(normalized)) return true;
  if (priorAssistant && ASSISTANT_SCHEDULING_QUESTION.test(normalizeText(priorAssistant))) {
    return /\d|ma[nñ]ana|hoy|am|pm|:\d{2}/i.test(normalized);
  }
  return false;
}

export function inferStateQuestionCapabilities(text: string): AssertionCapability[] {
  const caps = new Set<AssertionCapability>();
  for (const rule of STATE_QUESTION_CAPABILITY_RULES) {
    if (rule.pattern.test(text)) {
      for (const cap of rule.capabilities) caps.add(cap);
    }
  }
  if (caps.size === 0 && STATE_QUESTION_PATTERN.test(text)) {
    return [...ALL_ASSERTION_CAPABILITIES];
  }
  return [...caps];
}

/** Analiza el contexto conversacional del usuario antes de clasificar la respuesta AI. */
export function analyzeUserContext(context?: ClaimSecurityContext): UserContextAnalysis {
  const userMessage = context?.userMessage ?? "";
  const normalized = normalizeText(userMessage);
  const priorAssistant = getPriorAssistantTurn(context);
  const transactionalCaps = inferCapabilitiesFromConversationContext(context);

  if (isPhaticUserContext(normalized)) {
    return {
      kind: "phatic",
      transactionalCaps,
      stateQuestionCaps: [],
      isTransactional: false,
      requiresEvidenceForModalAck: false,
    };
  }

  if (isStateQuestion(userMessage)) {
    const stateQuestionCaps = inferStateQuestionCapabilities(userMessage);
    return {
      kind: "state_question",
      transactionalCaps,
      stateQuestionCaps,
      isTransactional: true,
      requiresEvidenceForModalAck: true,
    };
  }

  if (isConfirmationRequest(userMessage)) {
    return {
      kind: "confirmation_request",
      transactionalCaps,
      stateQuestionCaps: transactionalCaps.length > 0 ? transactionalCaps : inferStateQuestionCapabilities(userMessage),
      isTransactional: true,
      requiresEvidenceForModalAck: true,
    };
  }

  if (isInformationQuestion(userMessage)) {
    return {
      kind: "information",
      transactionalCaps: [],
      stateQuestionCaps: [],
      isTransactional: false,
      requiresEvidenceForModalAck: false,
    };
  }

  if (isFollowUpInformation(userMessage, priorAssistant)) {
    const schedulingFollowUp =
      !!priorAssistant && ASSISTANT_SCHEDULING_QUESTION.test(normalizeText(priorAssistant));
    return {
      kind: "follow_up",
      transactionalCaps,
      stateQuestionCaps: [],
      isTransactional: transactionalCaps.length > 0,
      requiresEvidenceForModalAck:
        transactionalCaps.length > 0 &&
        (schedulingFollowUp || hasRequestActionInHistory(context)),
    };
  }

  const directRequestCaps = inferCapabilitiesFromUserIntent(userMessage);
  if (directRequestCaps.length > 0) {
    return {
      kind: "request_action",
      transactionalCaps,
      stateQuestionCaps: [],
      isTransactional: true,
      requiresEvidenceForModalAck: true,
    };
  }

  return {
    kind: transactionalCaps.length > 0 ? "follow_up" : "none",
    transactionalCaps,
    stateQuestionCaps: [],
    isTransactional: transactionalCaps.length > 0,
    requiresEvidenceForModalAck: transactionalCaps.length > 0,
  };
}

function resolveModalAcknowledgementIntent(
  features: StructuralFeatures,
  userContext: UserContextAnalysis,
  context?: ClaimSecurityContext,
): ResponseIntent {
  if (userContext.kind === "state_question") {
    return "external_claim";
  }

  if (
    userContext.requiresEvidenceForModalAck &&
    userContext.transactionalCaps.length > 0
  ) {
    return "completion_signal";
  }

  if (
    userContext.kind === "follow_up" &&
    userContext.isTransactional &&
    hasRequestActionInHistory(context)
  ) {
    return "completion_signal";
  }

  return "acknowledgement";
}

/**
 * Clase gramatical CERRADA de interrogativos del español (acentuados). Se exige la tilde para no
 * colisionar con el relativo átono "que"/"cuando"/"como"/"donde" (ubicuos en afirmaciones). No es
 * una lista de frases: es el paradigma interrogativo del idioma, opcionalmente antepuesto por
 * preposición ("a/para/con/de qué/quién/cuál…"). Cubre "para qué día", "a nombre de quién", etc.
 */
const INTERROGATIVE_WORD =
  /(?:^|\s)(?:a|para|con|de|en|por|hacia|hasta|sobre)?\s*(?:qu[é]|qui[é]n(?:es)?|cu[á]l(?:es)?|c[ó]mo|cu[á]ndo|d[ó]nde|cu[á]nt[oa]s?)(?:\s|$)/i;

/** Campos de dato personal solicitables — vocabulario cerrado, compartido con isDataCollectionRequest. */
const PERSONAL_DATA_FIELD =
  /(?:nombre|correo|email|tel[eé]fono|celular|whatsapp|n[uú]mero|numero|c[eé]dula|cedula|documento|direcci[oó]n|direccion|fecha|hora|d[ií]a|dato|datos)/i;

/** Pregunta operativa del asistente — recolección de datos, no afirmación de ejecución. */
function isAssistantQuestionContent(p: string): boolean {
  const s = stripLeadingModalPrefix(p);
  if (!s) return false;
  // 1. Ortográfico: ¿/? conservados por normalizeText (señal estructural más fuerte).
  if (propositionIsInterrogative(s)) return true;
  // 2. Interrogativo acentuado (clase gramatical cerrada), con/sin preposición antepuesta.
  if (INTERROGATIVE_WORD.test(s)) return true;
  // 3. Elicitación en 2ª persona: (me/nos) + verbo-2ª (-as/-es) + campo de dato personal.
  //    "me confirmas tu teléfono", "me indicas tu número", "me das tu correo".
  if (new RegExp(`^(?:me|nos)\\s+\\w+(?:as|es)\\s+(?:tu|tus|su|sus|el|la|los|las)\\s+${PERSONAL_DATA_FIELD.source}`, "i").test(s)) {
    return true;
  }
  // 4. Verbos de preferencia/oferta dirigidos al usuario (2ª persona) — piden decisión, no afirman.
  if (ASSISTANT_SCHEDULING_QUESTION.test(s)) return true;
  if (/^(?:prefieres|te conviene|te funciona|te sirve|deseas|quieres|quiere|podr[ií]as|gustar[ií]a)\b/i.test(s)) {
    return true;
  }
  return false;
}

/** Información general — precio, explicación; no afirma operación externa ejecutada. */
function isAssistantInformationContent(p: string): boolean {
  const s = stripLeadingModalPrefix(p);
  if (!s) return false;
  return (
    /\b(?:te explico|le explico|explico c[oó]mo|explico el|informaci[oó]n sobre|cuesta|precio|valor|\$\s*\d|\d[\d.,]*\s*(?:pesos|usd|cop))\b/i.test(s) ||
    /^el (?:servicio|precio|costo|plan|consulta|tarifa)\b/i.test(s) ||
    /^(?:la|el)\s+(?:servicio|precio|costo|plan|consulta|tarifa)\s+(?:cuesta|vale|es)\s+/i.test(s) ||
    /\bc[oó]mo funciona\b/i.test(s) ||
    /\bhorario(?:s)?\s+de\s+atenci[oó]n\b/i.test(s) ||
    /\bes\s+de\s+\d+\s+a\s+\d+\b/i.test(s) ||
    /\bte\s+cuento\b/i.test(s) ||
    /\bpaso\s+a\s+paso\b/i.test(s) ||
    /\bpara\s+(?:reservar|agendar)\s+necesitamos\s+(?:confirmar|verificar)\s+disponibilidad\b/i.test(s)
  );
}

/** Incertidumbre/deferral explícito — la operación aún no está afirmada como completada. */
function isExplicitUncertaintyOrDeferral(p: string): boolean {
  const s = stripLeadingModalPrefix(p);
  if (!s) return false;
  if (isPropositionDirectNegativeState(s)) return true;
  if (isClearlySafeFutureAction(s)) return true;
  return (
    /\b(?:todav[ií]a|a[uú]n)\s+no\s+(?:puedo|podemos)\b/i.test(s) ||
    /\bno\s+(?:puedo|podemos)\s+(?:confirm|asegur)/i.test(s) ||
    /\bnecesito\s+(?:verificar|comprobar|revisar|consultar|confirmar|validar)(?:lo|la|los|las|le|les)?\b/i.test(s) ||
    /\b(?:perm[ií]teme|d[eé]jame|perm[ií]ta)\s+(?:verificar|comprobar|revisar|consultar|confirmar)/i.test(s) ||
    /\b(?:todav[ií]a|a[uú]n)\s+estoy\s+(?:revisando|verificando|consultando|comprobando)/i.test(s) ||
    /\bestoy\s+pendiente\s+de\s+(?:revisar|verificar|consultar|comprobar)/i.test(s) ||
    /\bdebo\s+(?:comprobar|verificar|revisar|consultar|confirmar)(?:lo|la|los|las|le|les)?\b/i.test(s) ||
    /\bantes\s+de\s+(?:cerrar|confirmar|reservar|agendar)\b/i.test(s) ||
    /\bantes\s+de\s+confirm/i.test(s) ||
    /\bfalta\s+(?:verificar|comprobar|revisar|confirmar)/i.test(s)
    // "voy a/iré a/déjame + verificar/revisar/consultar" ya lo cubre isClearlySafeFutureAction
    // arriba (línea previa). NO reintroducir ese patrón aquí: sin límite de fin de cadena,
    // matchea aunque la proposición contenga un estado terminal después (bypass 4.4.23 Bypass A).
  );
}

/** Solicitud de datos al usuario — continúa el flujo sin afirmar ejecución externa. */
function isDataCollectionRequest(p: string): boolean {
  const s = stripLeadingModalPrefix(p);
  if (!s) return false;
  return (
    /\bnecesito\s+(?:tu|su|el|la)\s+(?:nombre|correo|tel[eé]fono|fecha|hora|d[ií]a)/i.test(s) ||
    /^(?:¿)?(?:qu[eé]\s+d[ií]a|qu[eé]\s+hora|a\s+qu[eé]\s+hora|para\s+cu[aá]ndo|cu[aá]l\s+(?:d[ií]a|hora))/i.test(s) ||
    /^para (?:reservar|agendar|continuar) necesito/i.test(s)
  );
}

function isHelpOfferProposition(p: string): boolean {
  const s = stripLeadingModalPrefix(p);
  if (!s) return false;
  return /\b(?:te ayudo|puedo ayudarte|estoy para ayudarte|con gusto te ayudo|encantad[oa]\s+de ayudarte)\b/i.test(s);
}

function isExplanationProposition(p: string): boolean {
  const s = stripLeadingModalPrefix(p);
  if (!s) return false;
  return /\b(?:te explico|explico(?:te)?|as[ií]\s+funciona|as[ií]\s+es\s+el\s+proceso)\b/i.test(s);
}

/**
 * Proposición estructuralmente segura: demuestra que NO afirma ejecución/completitud externa.
 * Carga de prueba invertida — en contexto transaccional todo lo demás requiere evidencia.
 */
function isPropositionClearlySafe(
  prop: string,
  features: StructuralFeatures,
  _userContext: UserContextAnalysis,
): boolean {
  const p = stripLeadingModalPrefix(prop);
  if (!p) return false;

  if (tokenize(p).length <= 2 && isModalOrClosurePrefix(p)) return false;

  if (isPropositionDirectNegativeState(p)) return true;
  if (isClearlySafeFutureAction(p)) return true;
  if (isHypotheticalOrPossibilityFrame(p)) return true;
  if (isAssistantQuestionContent(p)) return true;
  if (isAssistantInformationContent(p)) return true;
  if (isExplicitUncertaintyOrDeferral(p)) return true;
  if (isDataCollectionRequest(p)) return true;
  if (isHelpOfferProposition(p)) return true;
  if (isExplanationProposition(p)) return true;

  if (matchesSafeConversationalPattern(p, features)) return true;

  return false;
}

/**
 * Respuesta demostrablemente segura sin provenance.
 * En contexto transaccional fuerte: si no se puede demostrar → REQUIRES_EVIDENCE.
 */
export function isResponseClearlySafeWithoutProvenance(
  normalized: string,
  features: StructuralFeatures,
  userContext: UserContextAnalysis,
  context?: ClaimSecurityContext,
): boolean {
  if (userContext.kind === "information" || userContext.kind === "phatic") return true;
  if (isPhaticUserContext(context?.userMessage) && isPhaticAiClosure(normalized)) return true;

  const props = enumeratePropositions(normalized);

  {
    let substantiveEarly = 0;
    let allClearlySafe = true;
    for (const prop of props) {
      const p = stripLeadingModalPrefix(prop);
      if (!p || isBareNegationPrefix(p) || (tokenize(p).length <= 2 && isModalOrClosurePrefix(p))) continue;
      substantiveEarly += 1;
      if (!isPropositionClearlySafe(prop, features, userContext)) allClearlySafe = false;
    }
    // isPropositionClearlySafe tiene varias categorías con regex SIN anclar (isAssistantInformationContent
    // "te explico/te cuento", isHelpOfferProposition, isExplanationProposition, isDataCollectionRequest,
    // isExplicitUncertaintyOrDeferral) que matchean como subcadena en cualquier posición — pueden dar
    // "clearly safe" a una proposición que TAMBIÉN afirma completitud en otra parte de sí misma
    // ("Te explico que tu cita ya quedó confirmada"). Este bloque no puede confiar solo en el veredicto
    // por categoría: debe respetar el mismo veto global que ya aplican los bloques siguientes.
    if (
      substantiveEarly > 0 &&
      allClearlySafe &&
      !hasOperationalResolutionAnywhere(normalized) &&
      !hasPositiveCompletionAnywhere(normalized, features)
    ) {
      return true;
    }
  }

  if (
    !hasOperationalResolutionAnywhere(normalized) &&
    !hasPositiveCompletionAnywhere(normalized, features) &&
    props.some((prop) => isClearlySafeFutureAction(stripLeadingModalPrefix(prop)))
  ) {
    let substantive = 0;
    let unsafe = false;
    for (const prop of props) {
      const p = stripLeadingModalPrefix(prop);
      if (!p || isBareNegationPrefix(p) || (tokenize(p).length <= 2 && isModalOrClosurePrefix(p))) continue;
      substantive += 1;
      if (
        !isExplicitUncertaintyOrDeferral(prop) &&
        !isPropositionDirectNegativeState(p) &&
        !isClearlySafeFutureAction(p)
      ) {
        unsafe = true;
      }
    }
    if (substantive > 0 && !unsafe) return true;
  }

  if (
    detectDeferredFutureAction(normalized, features) &&
    !hasPositiveCompletionAnywhere(normalized, features) &&
    !hasOperationalResolutionAnywhere(normalized)
  ) {
    let substantive = 0;
    for (const prop of props) {
      const p = stripLeadingModalPrefix(prop);
      if (!p || isBareNegationPrefix(p) || (tokenize(p).length <= 2 && isModalOrClosurePrefix(p))) continue;
      substantive += 1;
      if (!isExplicitUncertaintyOrDeferral(prop) && !isPropositionDirectNegativeState(p)) {
        return false;
      }
    }
    if (substantive > 0) return true;
  }

  const hasPrimaryFutureProp = props.some((prop) =>
    isClearlySafeFutureAction(stripLeadingModalPrefix(prop)),
  );

  if (hasPrimaryCompletionSignal(normalized, features) && !hasPrimaryFutureProp) return false;
  if (hasOperationalResolutionAnywhere(normalized)) return false;
  if (hasPositiveCompletionAnywhere(normalized, features)) return false;

  if (props.length === 0) return false;

  let substantive = 0;
  for (const prop of props) {
    const p = stripLeadingModalPrefix(prop);
    if (!p) return false;
    if (isBareNegationPrefix(p) || (tokenize(p).length <= 2 && isModalOrClosurePrefix(p))) continue;
    substantive += 1;
    if (!isPropositionClearlySafe(prop, features, userContext)) return false;
  }

  return substantive > 0;
}

/**
 * Marcador de segunda persona / posesivo del cliente: la respuesta se refiere a la instancia
 * concreta del usuario ("tu cita", "te esperamos", "tu solicitud"), no a información genérica.
 */
const USER_INSTANCE_MARKER = /(?:^|\s)(?:tu|tus|su|sus|te|le|les|contigo|tuyo|tuya|tuyos|tuyas)(?:\s|$)/i;

/**
 * Hallazgo A (4.8.1): contexto operacional derivado de la PROPIA respuesta, no solo de la
 * intención de usuario reconocida. Cuando la respuesta menciona un dominio operacional (cita,
 * pago, soporte, solicitud, disponibilidad) Y se dirige a la instancia del cliente (tu/te/su…),
 * tiene naturaleza external-facing y debe demostrar que NO afirma una operación — aunque el
 * clasificador de intención del usuario haya fallado. NO se activa por mención genérica de
 * dominio sin referencia al cliente ("las citas duran 30 minutos" = información).
 */
function responseAssertsUserInstanceOperation(
  normalized: string,
  features: StructuralFeatures,
): boolean {
  if (features.domainCaps.length === 0) return false;
  return USER_INSTANCE_MARKER.test(normalized);
}

/**
 * Contexto que exige carga de prueba invertida: intención transaccional del usuario reconocida
 * O respuesta operacional dirigida al cliente. Única fuente para el gate de classifyResponseSafety.
 */
function requiresBurdenOfProof(
  normalized: string,
  features: StructuralFeatures,
  userContext: UserContextAnalysis,
): boolean {
  if (userContext.isTransactional && userContext.requiresEvidenceForModalAck) return true;
  return responseAssertsUserInstanceOperation(normalized, features);
}

/** Clasificación de seguridad para contexto transaccional (4.4.21 / 4.8.1). */
export function classifyResponseSafety(
  normalized: string,
  context?: ClaimSecurityContext,
): ResponseSafetyClass {
  const text = normalizeText(normalized);
  if (!text) return "clearly_safe";

  const features = extractStructuralFeatures(text);
  const userContext = analyzeUserContext(context);

  if (!requiresBurdenOfProof(text, features, userContext)) {
    return "clearly_safe";
  }

  if (isResponseClearlySafeWithoutProvenance(text, features, userContext, context)) {
    return "clearly_safe";
  }

  return "requires_evidence";
}

/**
 * Carga de prueba invertida (4.4.21):
 * contexto transaccional fuerte + respuesta NO demostrablemente segura → exige provenance.
 * NO depende de detectar positivamente un claim léxico concreto.
 */
function resolveTransactionalBurdenOfProof(
  normalized: string,
  features: StructuralFeatures,
  userContext: UserContextAnalysis,
  context?: ClaimSecurityContext,
): ResponseIntent | null {
  if (!userContext.isTransactional || !userContext.requiresEvidenceForModalAck) return null;
  if (isResponseClearlySafeWithoutProvenance(normalized, features, userContext, context)) {
    return null;
  }
  return "completion_signal";
}

/** @deprecated Usar resolveTransactionalBurdenOfProof — mantenido como alias interno. */
function resolveTransactionalResolutionFailClosed(
  normalized: string,
  features: StructuralFeatures,
  userContext: UserContextAnalysis,
  primaryCompletion: boolean,
  context?: ClaimSecurityContext,
): ResponseIntent | null {
  if (primaryCompletion) return "completion_signal";
  return resolveTransactionalBurdenOfProof(normalized, features, userContext, context);
}

export function classifyResponseIntent(
  text: string,
  context?: ClaimSecurityContext,
): ResponseIntent {
  const normalized = normalizeText(text);
  if (!normalized) return "conversational";

  const features = extractStructuralFeatures(normalized);
  const userCaps = inferCapabilitiesFromConversationContext(context);
  const userContext = analyzeUserContext(context);
  const primaryCompletion = hasPrimaryCompletionSignal(normalized, features);

  if (primaryCompletion && (userCaps.length > 0 || userContext.requiresEvidenceForModalAck)) {
    if (features.domainCaps.length > 0 || hasPositiveCompletionAnywhere(normalized, features)) {
      const stateAssertion =
        hasPositiveCompletionAnywhere(normalized, features) ||
        features.completionScore >= 2 ||
        features.hasPastCompletion ||
        features.hasParticipleState ||
        /\b(tuyo|tuya|tienes el turno)\b/i.test(normalized) ||
        /qued[oó]\s+(reservad\w*|agendad\w*|confirmad\w*|hech\w*|procesad\w*|realizad\w*)/i.test(normalized);
      if (stateAssertion) return "external_claim";
    }
    return "completion_signal";
  }

  if (matchesSafeConversationalPattern(normalized, features)) {
    if (!features.hasPastCompletion && !features.hasParticipleState && features.domainCaps.length === 0) {
      if (
        !userContext.requiresEvidenceForModalAck ||
        isResponseClearlySafeWithoutProvenance(normalized, features, userContext, context)
      ) {
        return "future_action";
      }
    }
  }

  if (features.hasDeferredFutureAction && !primaryCompletion) {
    if (
      !userContext.requiresEvidenceForModalAck ||
      isResponseClearlySafeWithoutProvenance(normalized, features, userContext, context)
    ) {
      return "future_action";
    }
  }

  if (features.hasFutureAction && !features.hasPastCompletion && !features.hasParticipleState && !primaryCompletion) {
    const bareForwardOnly =
      /(?:^|\s)(adelante|procedemos|procedo|continuamos)(?:\s|[,.!]|$)/i.test(normalized) &&
      !features.hasDeferredFutureAction;
    if (!bareForwardOnly || userCaps.length === 0) {
      const forwardOperational =
        /(?:^|\s)(procedemos|procedo|continuamos)(?:\s|$)/i.test(normalized) &&
        !/\b(procedemos|procedo|procedamos)\s+a\s+(consultar|revisar|verificar|comprobar|buscar)/i.test(normalized) &&
        userCaps.length > 0 &&
        features.domainCaps.length > 0;
      const assertsCompletedState =
        features.completionScore >= 2 ||
        (features.domainCaps.length > 0 &&
          userCaps.length > 0 &&
          /(?:qued[oó]|est[aá]|fue|confirmad\w*|reservad\w*|agendad\w*|realizad\w*|procesad\w*|hech\w*)/i.test(normalized));
      if ((!assertsCompletedState && !forwardOperational) && features.hasDeferredFutureAction) {
        if (
          !userContext.requiresEvidenceForModalAck ||
          isResponseClearlySafeWithoutProvenance(normalized, features, userContext, context)
        ) {
          return "future_action";
        }
      }
    }
  }

  if (COMMITMENT_PATTERN.test(normalized) && features.domainCaps.length === 0) {
    return userCaps.length > 0 ? "completion_signal" : "future_action";
  }

  const isHelpOfferWithoutCompletion =
    /\b(?:te ayudo|puedo ayudarte|estoy para ayudarte|con gusto te ayudo|encantad[oa]\s+de ayudarte)\b/i.test(
      normalized,
    ) &&
    !hasPositiveCompletionAnywhere(normalized, features) &&
    !hasOperationalResolutionAnywhere(normalized);

  if (features.domainCaps.length > 0 && !isNegativeIncompleteState(normalized, features) && !isHelpOfferWithoutCompletion) {
    const availabilityAssertion =
      features.domainCaps.includes("appointment.available") &&
      /\b(hay|tenemos|existe|confirmamos)\s+\w*disponib/i.test(normalized);
    const stateAssertion =
      hasPositiveCompletionAnywhere(normalized, features) ||
      features.completionScore >= 2 ||
      features.hasPastCompletion ||
      features.hasParticipleState ||
      /\b(tuyo|tuya|tienes el turno)\b/i.test(normalized) ||
      /qued[oó]\s+(reservad\w*|agendad\w*|confirmad\w*|hech\w*|procesad\w*|realizad\w*)/i.test(normalized) ||
      (userCaps.length > 0 &&
        /procedemos|continuamos|en orden|bloquead\w*|gestionad\w*|reserv\w+|agend\w+/i.test(normalized));

    if (availabilityAssertion || stateAssertion) {
      return "external_claim";
    }
  }

  if (
    !isNegativeIncompleteState(normalized, features) &&
    (hasPositiveCompletionAnywhere(normalized, features) ||
    (features.completionScore >= 2 && hasPositiveCompletionAnywhere(normalized, features)) ||
    features.hasPastCompletion ||
    features.hasParticipleState ||
    (features.hasYaTemporal && !features.hasModalAcknowledgement && !features.hasDeferredFutureAction))
  ) {
    return "completion_signal";
  }

  if (
    /\b(?:te ayudo|puedo ayudarte|estoy para ayudarte|con gusto te ayudo|encantad[oa]\s+de ayudarte)\b/i.test(
      normalized,
    ) &&
    !hasPositiveCompletionAnywhere(normalized, features) &&
    !hasOperationalResolutionAnywhere(normalized)
  ) {
    if (
      !userContext.requiresEvidenceForModalAck ||
      isResponseClearlySafeWithoutProvenance(normalized, features, userContext, context)
    ) {
      return "future_action";
    }
  }

  if (isAmbiguousAckOrClosureResponse(normalized, features)) {
    return resolveModalAcknowledgementIntent(features, userContext, context);
  }

  if (features.hasStandaloneClosure && userCaps.length === 0 && !features.hasPastCompletion && !features.hasParticipleState) {
    return "acknowledgement";
  }

  if (userCaps.length > 0 && !isNegativeIncompleteState(normalized, features)) {
    const hypotheticalOnly =
      enumeratePropositions(normalized).some((p) => isHypotheticalOrPossibilityFrame(p)) &&
      !hasOperationalResolutionAnywhere(normalized) &&
      !hasPositiveCompletionAnywhere(normalized, features);
    const clearlySafe = isResponseClearlySafeWithoutProvenance(normalized, features, userContext, context);
    if (!hypotheticalOnly && !clearlySafe && (features.hasStandaloneClosure || features.hasClosureSignal)) {
      return "completion_signal";
    }
  }

  const failClosed = resolveTransactionalResolutionFailClosed(
    normalized,
    features,
    userContext,
    primaryCompletion,
    context,
  );
  if (failClosed) return failClosed;

  return "conversational";
}

function intentToSemanticClass(intent: ResponseIntent): TextSemanticClass {
  if (intent === "acknowledgement" || intent === "future_action") return intent;
  return intent;
}

function requiredCapabilitiesForIntent(
  intent: ResponseIntent,
  userCaps: AssertionCapability[],
  domainCaps: AssertionCapability[],
  userContext?: UserContextAnalysis,
): AssertionCapability[] {
  if (intent === "conversational" || intent === "acknowledgement" || intent === "future_action") {
    return [];
  }
  if (intent === "external_claim") {
    if (domainCaps.length > 0) return domainCaps;
    if (userContext?.stateQuestionCaps.length) return userContext.stateQuestionCaps;
    return userCaps;
  }
  if (intent === "completion_signal") {
    if (userContext?.stateQuestionCaps.length) return userContext.stateQuestionCaps;
    const caps = new Set<AssertionCapability>(userCaps);
    for (const cap of domainCaps) caps.add(cap);
    if (caps.size > 0) return [...caps];
    return [...ALL_ASSERTION_CAPABILITIES];
  }
  return [];
}

export function isPhaticUserContext(userMessage?: string): boolean {
  if (!userMessage) return false;
  return PHATIC_USER_PATTERNS.some((p) => p.test(normalizeText(userMessage)));
}

function isPhaticAiClosure(text: string): boolean {
  return PHATIC_AI_RESPONSE_PATTERNS.some((p) => p.test(normalizeText(text)));
}

export function isConversationalIntentOnly(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  const intent = classifyResponseIntent(normalized);
  return intent === "conversational" || intent === "acknowledgement" || intent === "future_action";
}

function isConversationalSafeHarbor(
  text: string,
  context?: ClaimSecurityContext,
  domainCaps: AssertionCapability[] = [],
  userContext?: UserContextAnalysis,
  resolvedIntent?: ResponseIntent,
): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return true;

  const intent = resolvedIntent ?? classifyResponseIntent(normalized, context);
  const ctx = userContext ?? analyzeUserContext(context);

  if (ctx.requiresEvidenceForModalAck && (intent === "external_claim" || intent === "completion_signal")) {
    return false;
  }

  if (intent === "acknowledgement" || intent === "future_action" || intent === "conversational") {
    if (ctx.isTransactional && ctx.requiresEvidenceForModalAck) {
      const safetyFeatures = extractStructuralFeatures(normalized);
      if (!isResponseClearlySafeWithoutProvenance(normalized, safetyFeatures, ctx, context)) {
        return false;
      }
    }
    if (
      ctx.isTransactional &&
      ctx.requiresEvidenceForModalAck &&
      hasOperationalResolutionAnywhere(normalized) &&
      !detectDeferredFutureAction(normalized, extractStructuralFeatures(normalized))
    ) {
      return false;
    }
    if (domainCaps.length === 0 && !hasCompletionMorphology(normalized)) return true;
  }

  if (domainCaps.length > 0) return false;
  if (hasCompletionMorphology(normalized)) return false;

  const features = extractStructuralFeatures(normalized);
  if (matchesSafeConversationalPattern(normalized, features)) return true;

  if (
    isPhaticUserContext(context?.userMessage) &&
    domainCaps.length === 0 &&
    (isPhaticAiClosure(normalized) || features.hasModalAcknowledgement || features.hasStandaloneClosure)
  ) {
    return true;
  }

  return false;
}

export function analyzeTextForExternalClaims(
  text: string,
  context?: ClaimSecurityContext,
): ClaimAnalysisResult {
  const normalized = normalizeText(text);
  if (!normalized) {
    return {
      semanticClass: "conversational",
      responseIntent: "conversational",
      requiredCapabilities: [],
      completionScore: 0,
      conversationalSafe: true,
    };
  }

  const features = extractStructuralFeatures(normalized);
  const userCaps = inferCapabilitiesFromConversationContext(context);
  const userContext = analyzeUserContext(context);
  const responseSafety = classifyResponseSafety(normalized, context);
  let responseIntent = classifyResponseIntent(normalized, context);

  if (
    responseSafety === "requires_evidence" &&
    (responseIntent === "conversational" ||
      responseIntent === "acknowledgement" ||
      responseIntent === "future_action" ||
      responseIntent === "external_claim")
  ) {
    responseIntent = "completion_signal";
  }

  if (
    userContext.requiresEvidenceForModalAck &&
    responseSafety === "clearly_safe" &&
    isResponseClearlySafeWithoutProvenance(normalized, features, userContext, context)
  ) {
    return {
      semanticClass: intentToSemanticClass(responseIntent),
      responseIntent,
      requiredCapabilities: [],
      completionScore: features.completionScore,
      conversationalSafe: true,
      responseSafety,
    };
  }

  if (isConversationalSafeHarbor(normalized, context, features.domainCaps, userContext, responseIntent)) {
    return {
      semanticClass: "conversational",
      responseIntent,
      requiredCapabilities: [],
      completionScore: features.completionScore,
      conversationalSafe: true,
      responseSafety,
    };
  }

  const requiredCapabilities = requiredCapabilitiesForIntent(
    responseIntent,
    userCaps,
    features.domainCaps,
    userContext,
  );

  if (requiredCapabilities.length === 0) {
    return {
      semanticClass: intentToSemanticClass(responseIntent),
      responseIntent,
      requiredCapabilities: [],
      completionScore: features.completionScore,
      conversationalSafe: true,
      responseSafety,
    };
  }

  return {
    semanticClass: intentToSemanticClass(responseIntent),
    responseIntent,
    requiredCapabilities,
    completionScore: features.completionScore,
    conversationalSafe: false,
    responseSafety,
  };
}

export function detectExternalClaimsInText(
  text: string,
  context?: ClaimSecurityContext,
): AssertionCapability[] {
  return analyzeTextForExternalClaims(text, context).requiredCapabilities;
}

export function validateTextClaimsAgainstVerified(
  text: string,
  verifiedCapabilities: Set<AssertionCapability>,
  context?: ClaimSecurityContext,
): { ok: true } | { ok: false; missing: AssertionCapability[] } {
  const required = detectExternalClaimsInText(text, context);
  if (required.length === 0) return { ok: true };

  const missing = required.filter((cap) => !verifiedCapabilities.has(cap));
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing };
}

function capabilitiesFromVerifiedEntry(entry: VerifiedActionResult): AssertionCapability[] {
  if (!entry.verified) return [];

  const actionConfig = SOURCE_TO_ACTION[entry.source];
  if (!actionConfig) return [];

  const spec = resolveActionCapabilitySpec(actionConfig);
  const caps = new Set<AssertionCapability>(spec.verifiesOnSuccess ?? []);

  const data = entry.data ?? {};
  for (const outputKey of spec.outputVariables ?? []) {
    if (data[outputKey] !== undefined) {
      for (const cap of spec.verifiesOnSuccess ?? []) caps.add(cap);
    }
  }

  return [...caps];
}

export function extractVerifiedCapabilitiesFromVariables(
  variables: Record<string, unknown>,
): Set<AssertionCapability> {
  const verified = new Set<AssertionCapability>();
  const raw = variables[VERIFIED_RESULTS_VARIABLE_KEY];
  if (!Array.isArray(raw)) return verified;

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    for (const cap of capabilitiesFromVerifiedEntry(item as VerifiedActionResult)) {
      verified.add(cap);
    }
  }
  return verified;
}

function interpolateSegment(segment: string, variables?: Record<string, unknown>): string {
  if (!variables) return segment;
  return segment.replace(VARIABLE_PLACEHOLDER, (match) => {
    const key = match.slice(2, -2);
    const value = variables[key];
    if (value === null || value === undefined) return "";
    return String(value);
  });
}

export function extractLogicalMessageText(
  content: FlowMessageContent,
  variables?: Record<string, unknown>,
): string {
  const segments: string[] = [];

  if (content.text) segments.push(content.text);
  if (content.parts?.length) {
    segments.push(...content.parts);
    segments.push(content.parts.map((s) => interpolateSegment(s, variables)).join(""));
  }
  if (content.media?.caption) segments.push(content.media.caption);
  if (content.template?.templateName) segments.push(content.template.templateName);
  if (content.template?.variables) {
    segments.push(...Object.values(content.template.variables));
  }

  return normalizeText(
    segments.map((s) => interpolateSegment(s, variables)).join(" "),
  );
}

export function detectExternalClaimsInMessageTemplate(content: FlowMessageContent): AssertionCapability[] {
  const logical = extractLogicalMessageText(content);
  return detectExternalClaimsInText(logical, { source: "message_template" });
}

export function resolveMessageTextForClaimValidation(
  content: FlowMessageContent,
  variables: Record<string, unknown>,
): string {
  return extractLogicalMessageText(content, variables);
}

export function extractPlainTextFromMessageContent(content: FlowMessageContent): string {
  return extractLogicalMessageText(content);
}

function parseConversationHistory(raw: unknown): ConversationTurn[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const turns: ConversationTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      turns.push({ role, content });
    }
  }
  return turns.length ? turns : undefined;
}

export function extractClaimSecurityContextFromVariables(
  variables: Record<string, unknown>,
  source: ClaimSecurityContext["source"] = "ai_response",
): ClaimSecurityContext {
  return {
    userMessage: extractUserMessageFromVariables(variables),
    conversationHistory: parseConversationHistory(variables.__conversationHistory),
    source,
  };
}

export function extractUserMessageFromVariables(
  variables: Record<string, unknown>,
): string | undefined {
  if (typeof variables.__userMessage === "string") return variables.__userMessage;
  if (typeof variables.text === "string") return variables.text;
  if (typeof variables.lastUserMessage === "string") return variables.lastUserMessage;
  return undefined;
}
