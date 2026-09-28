// DuLabs Business — Business Agent 2.0, FASE 7 — resolución de entidades y contexto mínimo del turno.
//
// El modelo SEÑALA lo que el cliente dijo ("corte", "después de las 4"); el BACKEND decide a qué corresponde en el
// negocio real, de forma determinista y ANTES de la state machine:
//
//   entendimiento validado (FASE 2) → resolveTurnEntities → MESSAGE_UNDERSTOOD (state machine) → requisitos → acción
//
// 1. Servicio contra el catálogo REAL del negocio (dulabs_servicios del tenant, o los servicios del modelo publicado):
//    - exacto (sin tildes/mayúsculas/puntuación)                     → resuelto al nombre real;
//    - lo que dijo está contenido en UN solo servicio ("clásico")     → resuelto;
//    - contenido en VARIOS ("corte": Corte clásico / Corte + barba)   → ambiguo: se pregunta cuál (nunca se elige);
//    - UN servicio aparece completo dentro de la frase               → resuelto (el más específico, si es único);
//    - parecido pero no igual ("cort", "corte clasco")               → SUGERENCIA: se pregunta "¿te refieres a …?";
//      el parecido NUNCA selecciona solo;
//    - nada parecido                                                  → inválido "service_not_offered": se dice que no
//      existe y se muestran las opciones reales (nunca se inventa uno).
//    Respuestas cortas a esa pregunta: "sí" a una sugerencia única y "el primero/la segunda" a una lista.
// 2. Hora/franja sin am/pm ("a las 4", "después de las 4"): si el horario de atención deja UNA sola lectura posible, se
//    resuelve con ella (autoridad: el negocio); si deja dos o ninguna, se pregunta.
// 3. Contexto mínimo para el modelo: solo los nombres de servicios RELEVANTES al mensaje (no el catálogo completo).

import type { StructuredUnderstanding, UnderstoodSlot } from "@/lib/agent-compiler/understanding/contract";
import { foldText, type NormalizedSlotValue } from "@/lib/agent-compiler/understanding/slots";
import { slotDisplayValue } from "@/lib/agent-compiler/understanding/validate";
import type { BusinessHours } from "@/lib/agent-compiler/spec/types";
import { isSlotUsable, type ConversationState } from "@/lib/agent-compiler/conversation/model";

export interface CatalogService {
  name: string;
  durationMinutes?: number;
  /** FASE 8 — precio REAL del negocio (moneda del negocio, entero). null = sin precio fijo; ausente = no se conoce. */
  price?: number | null;
}

/** Catálogo del turno. `source` dice de dónde salió (tablas del negocio o modelo publicado). */
export interface TurnCatalog {
  source: "business_tables" | "model";
  services: readonly CatalogService[];
}

/** Carga el catálogo del tenant del turno (tenant-scoped por construcción: lo arma el runtime con SU tenant). */
export interface CatalogPort {
  load(): Promise<TurnCatalog>;
}

export const MAX_SERVICE_CANDIDATES = 6;
export const MAX_CONTEXT_OFFERINGS = 12;

// ---------------------------------------------------------------------------
// Coincidencia de servicios (reglas explícitas)
// ---------------------------------------------------------------------------

/** Palabras que no identifican un servicio. */
const STOPWORDS = new Set([
  "un", "una", "unos", "unas", "el", "la", "los", "las", "lo", "de", "del", "al", "a", "en", "para", "por", "con", "y", "o", "mi", "me",
  "quiero", "quisiera", "necesito", "hacer", "hacerme", "servicio", "cita", "turno", "reservar", "agendar", "favor", "porfa", "porfavor",
]);

export function serviceTokens(text: string): string[] {
  return foldText(text)
    .replace(/[+&/_-]/g, " ")
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t));
}

/**
 * Raíz ligera en español, solo para COMPARAR: "cortarme", "cortar", "corte", "cortes" → "cort"; "barbas" → "barb".
 * (Pronombre enclítico, terminaciones verbales/plurales comunes y vocal final.) Nunca se muestra ni se guarda.
 */
export function stem(token: string): string {
  let t = token.replace(/(?<=[aei]r)(?:me|te|se|nos|lo|la|le)$/, "");
  for (const suf of ["iendo", "ando", "ado", "ada", "ar", "er", "ir", "es", "os", "as"]) {
    if (t.length - suf.length >= 4 && t.endsWith(suf)) {
      t = t.slice(0, -suf.length);
      break;
    }
  }
  return t.length > 4 && /[aeiou]$/.test(t) ? t.slice(0, -1) : t;
}

const stems = (text: string) => serviceTokens(text).map(stem);

type Tok = { word: string; stem: string };
const toks = (text: string): Tok[] => serviceTokens(text).map((word) => ({ word, stem: stem(word) }));

/**
 * Palabra COMPLETA equivalente: igual, o misma raíz sin ser más corta que la del servicio ("cortes"/"cortarme" ≈
 * "corte"; "cort" NO: es un pedazo de palabra y solo puede sugerir).
 */
const sameWord = (u: Tok, s: Tok) => u.word === s.word || (u.stem === s.stem && u.word.length >= s.word.length);

/** Distancia de edición con transposiciones (Damerau, alineación óptima): "tinet" → "tinte" = 1. Solo para SUGERIR. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * Reglas del parecido (solo sugiere, nunca selecciona):
 *   - prefijo: la palabra del cliente tiene ≥ 4 letras y es el comienzo de una palabra del servicio ("cort" → "corte");
 *   - errata: palabras de ≥ 5 letras a distancia 1 (≥ 8 letras: distancia 2) ("clasco" → "clasico").
 */
function similarToken(user: string, service: string): boolean {
  if (user === service) return true;
  if (user.length >= 4 && service.startsWith(user)) return true;
  if (user.length >= 5 && service.length >= 5) return editDistance(user, service, 2) <= (Math.min(user.length, service.length) >= 8 ? 2 : 1);
  return false;
}

export type ServiceMatch =
  | { kind: "resolved"; service: CatalogService; rule: "exact" | "unique_partial" | "named_in_phrase" }
  | { kind: "ambiguous"; candidates: CatalogService[] }
  | { kind: "suggestion"; candidates: CatalogService[] }
  | { kind: "none" };

export function matchService(raw: string, services: readonly CatalogService[]): ServiceMatch {
  const folded = foldText(raw);
  const user = toks(raw);
  if (!folded || user.length === 0) return { kind: "none" };
  const entries = services.map((s) => ({ s, tokens: toks(s.name) })).filter((e) => e.tokens.length > 0);
  const pick = (list: typeof entries, max = MAX_SERVICE_CANDIDATES) => list.map((e) => e.s).slice(0, max);
  const has = (list: Tok[], t: Tok) => list.some((x) => sameWord(t, x));
  const inUser = (t: Tok) => user.some((u) => sameWord(u, t));

  // 1. Exacto (sin tildes/mayúsculas/puntuación, o las mismas palabras).
  const exact = entries.filter((e) => foldText(e.s.name) === folded || (e.tokens.length === user.length && e.tokens.every(inUser)));
  if (exact.length === 1) return { kind: "resolved", service: exact[0]!.s, rule: "exact" };
  if (exact.length > 1) return { kind: "ambiguous", candidates: pick(exact) };

  // 2. Todo lo que dijo está en el nombre de UN servicio ("clásico" → Corte clásico); en varios, se pregunta.
  const containing = entries.filter((e) => user.every((u) => has(e.tokens, u)));
  if (containing.length === 1) return { kind: "resolved", service: containing[0]!.s, rule: "unique_partial" };
  if (containing.length > 1) return { kind: "ambiguous", candidates: pick(containing) };

  // 3. El nombre completo de un servicio aparece en la frase ("el corte clásico de siempre"): el más específico.
  const named = entries.filter((e) => e.tokens.every(inUser));
  if (named.length > 0) {
    const most = Math.max(...named.map((e) => e.tokens.length));
    const specific = named.filter((e) => e.tokens.length === most);
    if (specific.length === 1) return { kind: "resolved", service: specific[0]!.s, rule: "named_in_phrase" };
    return { kind: "ambiguous", candidates: pick(specific) };
  }

  // 4. Coincidencia PARCIAL (misma raíz, con palabras de más o cortada: "cortarme el pelo", "cort"): nunca selecciona
  //    sola. Un servicio → se sugiere ("¿te refieres a …?"); varios → se listan para que elija.
  const overlap = entries.filter((e) => user.some((u) => u.stem.length >= 4 && e.tokens.some((t) => t.stem === u.stem)));
  if (overlap.length === 1) return { kind: "suggestion", candidates: pick(overlap, 1) };
  if (overlap.length > 1) return { kind: "ambiguous", candidates: pick(overlap) };

  // 5. Parecido por errata ("tinet", "clasco"): solo sugerencia.
  const similar = entries.filter((e) => user.every((u) => e.tokens.some((t) => similarToken(u.word, t.word))));
  if (similar.length > 0) return { kind: "suggestion", candidates: pick(similar, 3) };
  return { kind: "none" };
}

const ORDINALS: Record<string, number> = { primero: 1, primera: 1, "1": 1, segundo: 2, segunda: 2, "2": 2, tercero: 3, tercera: 3, "3": 3, cuarto: 4, cuarta: 4, "4": 4, quinto: 5, quinta: 5, "5": 5, sexto: 6, sexta: 6, "6": 6 };

/**
 * "el primero", "la segunda", "opción 2", "la 2 por favor" → índice 1-based; null si no es una respuesta ordinal. Solo
 * reconoce el mensaje COMPLETO como elección (una frase con más contenido no se reinterpreta como número).
 */
export function ordinalAnswer(raw: string): number | null {
  const t = foldText(raw)
    .replace(/[.,;:!?¡¿]+/g, " ")
    .replace(/\s+(?:por favor|porfa|gracias|opcion)\s*$/g, "")
    .replace(/^(?:quiero|prefiero|me quedo con|dame)\s+/, "")
    .replace(/^(?:el|la|opcion|numero)\s+/, "")
    .replace(/^(?:opcion|numero)\s+/, "")
    .replace(/\s+(?:opcion|hora|cita)$/, "")
    .trim();
  return ORDINALS[t] ?? null;
}

/** Valor normalizado de una opción elegida según el tipo de dato. */
function offerValue(slot: string, value: string): NormalizedSlotValue {
  if (slot === "time" && /^\d{2}:\d{2}$/.test(value)) return { kind: "time", time: value };
  return { kind: "text", text: value };
}

// ---------------------------------------------------------------------------
// Hora y franja con el horario de atención
// ---------------------------------------------------------------------------

type Interval = { open: string; close: string };

/** Intervalos de atención del día pedido (excepciones primero); sin día, todos los de la semana. */
function openIntervals(hours: BusinessHours, date: string | null): Interval[] {
  if (date) {
    const ex = hours.exceptions.find((e) => e.date === date);
    if (ex) return ex.closed ? [] : ex.intervals;
    const day = hours.week[new Date(`${date}T12:00:00Z`).getUTCDay()];
    return !day || day.closed ? [] : day.intervals;
  }
  return hours.week.flatMap((d) => (d.closed ? [] : d.intervals));
}

function timeFits(time: string, intervals: readonly Interval[]): boolean {
  return intervals.some((i) => time >= i.open && time < i.close);
}

/**
 * Una lectura de franja es plausible si sus límites CAEN dentro de un intervalo de atención (una franja cuyo límite
 * queda fuera, p. ej. "después de las 4 a. m." en un negocio que abre a las 8, no restringe nada: no es lo que se pidió).
 */
function rangeFits(from: string | undefined, to: string | undefined, intervals: readonly Interval[]): boolean {
  return intervals.some((i) => (!from || (from >= i.open && from < i.close)) && (!to || (to > i.open && to <= i.close)));
}

function parseRangeCandidate(c: string): { from?: string; to?: string } | null {
  const m = /^(\d{2}:\d{2})?-(\d{2}:\d{2})?$/.exec(c);
  if (!m || (!m[1] && !m[2])) return null;
  return { ...(m[1] ? { from: m[1] } : {}), ...(m[2] ? { to: m[2] } : {}) };
}

// ---------------------------------------------------------------------------
// Resolución del turno
// ---------------------------------------------------------------------------

export interface EntityResolutionInput {
  understanding: StructuredUnderstanding;
  state: ConversationState;
  /** FASE 8 — texto del cliente (solo para reconocer una elección ordinal "la segunda"; nunca se interpreta otra cosa). */
  text?: string;
  /** FASE 8 — opciones configuradas de los datos tipo lista (select) del negocio, por slot. */
  selectOptions?: Readonly<Record<string, readonly string[]>>;
  /** null = el catálogo no aplica a este agente (sin agenda con servicios ni catálogo de servicios). */
  catalog: TurnCatalog | null;
  businessHours: BusinessHours | null;
}

export interface EntityResolutionTrace {
  service?: ServiceMatch["kind"] | "ordinal" | "suggestion_accepted" | "catalog_empty";
  serviceRule?: string;
  time?: "business_hours" | "still_ambiguous";
  timeRange?: "business_hours" | "still_ambiguous";
  /** FASE 8 — elección ordinal resuelta contra las opciones que mostró el backend. */
  offer?: { slot: string; index: number };
}

function withChange(slot: UnderstoodSlot): UnderstoodSlot {
  if (slot.value && slot.previous !== undefined && foldText(slotDisplayValue(slot.value)) === foldText(slot.previous)) return { ...slot, change: "restated" };
  return slot;
}

function resolvedService(base: UnderstoodSlot, name: string): UnderstoodSlot {
  const { reason: _r, candidates: _c, ...rest } = base;
  void _r;
  void _c;
  return withChange({ ...rest, status: "resolved", value: { kind: "text", text: name }, normalizedBy: "business_catalog" });
}

/** Aplica el catálogo y el horario al entendimiento del turno. Puro: devuelve una copia; nunca inventa valores. */
export function resolveTurnEntities(input: EntityResolutionInput): { understanding: StructuredUnderstanding; trace: EntityResolutionTrace } {
  const u: StructuredUnderstanding = structuredClone(input.understanding);
  const trace: EntityResolutionTrace = {};
  const state = input.state;
  const previousService = state.slots.service;
  const services = input.catalog?.services ?? [];

  // 0. FASE 8 — "la segunda": elige de la lista que el BACKEND mostró para el dato que se preguntó (horarios, citas) o
  //    de las opciones configuradas de un dato tipo lista (p. ej. el recurso). Fuera de rango = no se elige nada.
  const ordinal = input.text !== undefined ? ordinalAnswer(input.text) : null;
  const asked = state.lastQuestion?.slot;
  if (ordinal !== null && asked && asked !== "service") {
    const offered = state.offers?.slot === asked ? state.offers.options : null;
    const configured = input.selectOptions?.[asked];
    const pick = offered ? offered[ordinal - 1]?.value : configured?.[ordinal - 1];
    if (pick) {
      const value: NormalizedSlotValue = offered ? offerValue(asked, pick) : { kind: "select", option: pick };
      u.slots[asked] = { name: asked, origin: offered ? "universal" : "business", raw: input.text!.slice(0, 200), status: "resolved", value, normalizedBy: "offer_selection", change: "new" };
      u.ambiguities = u.ambiguities.filter((a) => a.slot !== asked);
      trace.offer = { slot: asked, index: ordinal };
    }
  }

  // 1. Servicio.
  const said = u.slots.service;
  if (input.catalog && services.length === 0 && said) trace.service = "catalog_empty";
  if (said && services.length > 0 && said.status === "resolved" && said.value?.kind === "text") {
    const pendingCandidates = previousService?.status === "AMBIGUOUS" && state.lastQuestion?.slot === "service" ? (previousService.candidates ?? []) : [];
    const ordinal = ordinalAnswer(said.raw);
    const byIndex = ordinal !== null && pendingCandidates.length >= ordinal ? pendingCandidates[ordinal - 1] : undefined;
    if (byIndex && services.some((s) => s.name === byIndex)) {
      u.slots.service = resolvedService(said, byIndex);
      trace.service = "ordinal";
    } else {
      const m = matchService(said.value.text, services);
      trace.service = m.kind;
      if (m.kind === "resolved") {
        u.slots.service = resolvedService(said, m.service.name);
        trace.serviceRule = m.rule;
      } else {
        const candidates = (m.kind === "none" ? services.slice(0, MAX_SERVICE_CANDIDATES) : m.candidates).map((s) => s.name);
        const { value: _v, normalizedBy: _n, ...rest } = said;
        void _v;
        void _n;
        u.slots.service = {
          ...rest,
          status: m.kind === "none" ? "invalid" : "ambiguous",
          reason: m.kind === "none" ? "service_not_offered" : m.kind === "suggestion" ? "service_suggestion" : "service_ambiguous",
          candidates,
        };
        u.ambiguities.push({ kind: m.kind === "none" ? "slot_invalid" : "slot_ambiguous", slot: "service", detail: u.slots.service.reason });
      }
    }
  } else if (
    !said &&
    services.length > 0 &&
    previousService?.status === "AMBIGUOUS" &&
    previousService.reason === "service_suggestion" &&
    previousService.candidates?.length === 1 &&
    state.lastQuestion?.slot === "service" &&
    u.intent.primary.intent === "CONFIRMATION" &&
    services.some((s) => s.name === previousService.candidates![0])
  ) {
    // "¿Te refieres a Corte clásico?" → "sí": acepta LA sugerencia que el sistema hizo (nunca otra).
    u.slots.service = { name: "service", origin: "universal", raw: "sí", status: "resolved", value: { kind: "text", text: previousService.candidates[0]! }, normalizedBy: "business_catalog", change: "new" };
    trace.service = "suggestion_accepted";
  }

  // 2. Hora / franja con el horario de atención (solo si el negocio lo tiene).
  if (input.businessHours) {
    const dateSlot = u.slots.date?.status === "resolved" && u.slots.date.value?.kind === "date" ? u.slots.date.value.date : isSlotUsable(state.slots.date) && state.slots.date.value.kind === "date" ? state.slots.date.value.date : null;
    const intervals = openIntervals(input.businessHours, dateSlot);
    const time = u.slots.time;
    if (time?.status === "ambiguous" && time.reason === "time_am_pm_unspecified" && time.candidates?.length) {
      const fits = time.candidates.filter((c) => /^\d{2}:\d{2}$/.test(c) && timeFits(c, intervals));
      if (fits.length === 1) {
        const { reason: _r, candidates: _c, ...rest } = time;
        void _r;
        void _c;
        u.slots.time = withChange({ ...rest, status: "resolved", value: { kind: "time", time: fits[0]! }, normalizedBy: "business_hours" });
        u.ambiguities = u.ambiguities.filter((a) => a.slot !== "time" || a.kind !== "slot_ambiguous");
        trace.time = "business_hours";
      } else trace.time = "still_ambiguous";
    }
    const range = u.slots.time_range;
    if (range?.status === "ambiguous" && range.reason === "time_range_am_pm_unspecified" && range.candidates?.length) {
      const fits = range.candidates.map((c) => ({ c, r: parseRangeCandidate(c) })).filter((x) => x.r && rangeFits(x.r.from, x.r.to, intervals));
      if (fits.length === 1) {
        const { reason: _r, candidates: _c, ...rest } = range;
        void _r;
        void _c;
        u.slots.time_range = withChange({ ...rest, status: "resolved", value: { kind: "time_range", ...fits[0]!.r! }, normalizedBy: "business_hours" });
        u.ambiguities = u.ambiguities.filter((a) => a.slot !== "time_range" || a.kind !== "slot_ambiguous");
        trace.timeRange = "business_hours";
      } else trace.timeRange = "still_ambiguous";
    }
  }
  return { understanding: u, trace };
}

// ---------------------------------------------------------------------------
// Contexto mínimo para el modelo
// ---------------------------------------------------------------------------

/**
 * Nombres de servicios que el modelo necesita ver en ESTE turno: con un catálogo pequeño, todos; con uno grande, solo
 * los que se parecen a lo que el cliente escribió (o los que se le acaban de ofrecer). Nunca precios ni IDs.
 */
export function relevantOfferings(catalog: TurnCatalog | null, message: string, state: ConversationState): string[] {
  const services = catalog?.services ?? [];
  if (services.length <= MAX_CONTEXT_OFFERINGS) return services.map((s) => s.name);
  const offered = state.slots.service?.candidates ?? [];
  const words = stems(message);
  const scored = services
    .map((s) => ({ name: s.name, score: offered.includes(s.name) ? 10 : stems(s.name).filter((t) => words.some((w) => similarToken(w, t))).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, MAX_CONTEXT_OFFERINGS).map((x) => x.name);
}

// ---------------------------------------------------------------------------
// Puerto de catálogo según el artefacto publicado
// ---------------------------------------------------------------------------

/** Lector de servicios ACTIVOS del negocio en sus tablas (dulabs_servicios), siempre filtrado por el tenant dado. */
export type ServiceTableReader = (tenantId: string) => Promise<CatalogService[]>;

type CatalogArtifact = {
  tenantId: string;
  catalogAuthority: "business_tables" | "model";
  services: ReadonlyArray<{ name: string; durationMinutes: number; bookable: boolean; price?: number | null }>;
  booking: { requiresService: boolean } | null;
  capabilities: ReadonlyArray<{ id: string; enabled: boolean }>;
};

/** ¿Este agente trabaja con servicios? (agenda que pide servicio o capacidad de catálogo encendida). */
export function artifactUsesServices(artifact: Pick<CatalogArtifact, "booking" | "capabilities">): boolean {
  return Boolean(artifact.booking?.requiresService || artifact.capabilities.some((c) => c.id === "catalog" && c.enabled));
}

/**
 * Catálogo del turno según la autoridad publicada: con `business_tables`, las tablas del negocio (la MISMA fuente que
 * usan los handlers de agenda); con `model`, los servicios reservables del artefacto. Sin servicios en juego: null.
 */
export function catalogPortForArtifact(artifact: CatalogArtifact, readTables: ServiceTableReader | undefined): CatalogPort | undefined {
  if (!artifactUsesServices(artifact)) return undefined;
  if (artifact.catalogAuthority === "model") {
    const services = artifact.services.filter((s) => s.bookable).map((s) => ({ name: s.name, durationMinutes: s.durationMinutes, ...(s.price !== undefined ? { price: s.price } : {}) }));
    return { load: async () => ({ source: "model", services }) };
  }
  if (!readTables) return undefined;
  return { load: async () => ({ source: "business_tables", services: await readTables(artifact.tenantId) }) };
}

// ---------------------------------------------------------------------------
// FASE 8 — hechos de precio del catálogo (backend), para "¿cuánto cuesta?" sin acción de cotización
// ---------------------------------------------------------------------------

export interface PriceFact {
  name: string;
  /** null = el negocio no tiene precio fijo para ese servicio (se dice así; nunca "$0"). */
  amount: number | null;
}

/**
 * Precios REALES de lo que el cliente está mirando: el servicio elegido o, si aún duda, las opciones que se le
 * mostraron. Nada de precios de servicios que no estén en el catálogo; sin precio conocido, no hay hecho.
 */
/**
 * FASE 10 — `understood`: el servicio que el cliente nombró en ESTE mensaje (resuelto contra el catálogo). Con él, un
 * "¿cuánto cuesta el corte?" como PRIMER mensaje recibe el precio real aunque el estado todavía no tenga ese dato (antes
 * caía a la búsqueda de conocimiento y, sin FAQ, decía que no sabía). Sin ningún servicio mencionado se listan los
 * precios del catálogo (acotado); un servicio que no existe no lista nada (el negocio no lo ofrece).
 */
export function priceFactsFor(catalog: TurnCatalog | null, state: ConversationState, understood?: UnderstoodSlot): PriceFact[] {
  const services = catalog?.services ?? [];
  if (services.length === 0) return [];
  const slot = state.slots.service;
  let names: string[];
  if (understood) {
    // Lo que el cliente nombró EN ESTE mensaje manda sobre lo que quedó en el estado.
    if (understood.status === "resolved" && understood.normalizedBy === "business_catalog" && understood.value) names = [slotDisplayValue(understood.value)];
    else if (understood.status === "ambiguous") names = understood.candidates ?? [];
    else return [];
  } else {
    names = isSlotUsable(slot) ? [slotDisplayValue(slot.value)] : (slot?.candidates ?? []);
    if (names.length === 0) names = services.map((s) => s.name);
  }
  return names
    .map((n) => services.find((s) => s.name === n))
    .filter((s): s is CatalogService => Boolean(s) && s!.price !== undefined)
    .slice(0, MAX_SERVICE_CANDIDATES)
    .map((s) => ({ name: s.name, amount: s.price ?? null }));
}
