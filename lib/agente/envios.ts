/**
 * FASE 3B.6 — MOTOR DE ENVÍOS: cobertura, tiempos de entrega y regla horaria, DETERMINÍSTICO y sin modelo.
 *
 * Es la única fuente de lo que el agente puede decir sobre un envío. La IA no calcula tiempos, no decide
 * cobertura, no inventa ciudades y no interpreta "2–3 días": pregunta aquí (herramienta `consultar_envio`)
 * y repite el texto EXACTO que el negocio configuró (`customer_text`). Todo sale de la configuración del
 * propio negocio (checkout_opciones.envios); nada es un valor por defecto ni viene de otro negocio.
 *
 * Los cinco resultados que NO se mezclan:
 *   covered               ciudad conocida y cubierta (con tiempo verificable, o sin él: `eta_type: "unknown"` => persona)
 *   not_covered           ciudad conocida y EXCLUIDA explícitamente por el negocio
 *   coverage_unverified   ciudad conocida, pero el negocio no declaró que la cubra (lista blanca) => persona
 *   unknown_city          ciudad que ni el sistema ni la configuración reconocen => persona (nunca se inventa una)
 *   inconsistent_location departamento que no corresponde a la ciudad (o que no es un departamento) => persona
 *   insufficient_info     falta la ciudad: se le pregunta al cliente (no hay nada que verificar todavía)
 *   rules_unavailable     el negocio no tiene reglas de envío configuradas => persona
 * Ante cualquier incertidumbre: `human_handoff_required: true`. Jamás una estimación.
 *
 * BOGOTÁ (y toda regla con corte horario): "los pedidos hechos antes de la hora límite PUEDEN tener entrega el
 * mismo día". Eso es una POSIBILIDAD, nunca una garantía: `eta_type: "same_day_possible"`, `guaranteed: false`
 * siempre. La hora es la de Colombia (America/Bogota) del reloj que inyecta el backend: ni la del servidor ni
 * una que mande el modelo.
 *
 * DÍAS HÁBILES Y FESTIVOS: en el sistema no existe una fuente confiable de festivos colombianos (brecha
 * documentada en agenda-v2/disponibilidad.ts) y no se improvisa una. Por eso aquí NO se convierten días hábiles
 * en fechas: se devuelve el rango que el negocio declaró ("2 a 3 días hábiles") y su texto. El único calendario
 * que se usa son las fechas que el negocio escribió explícitamente en `corte.festivos.no_aplica_en`; con
 * `festivos: ignorar` el negocio decidió no considerarlos (queda marcado `holidays: "not_checked"`).
 */
import { normalizar } from "@/lib/agente/lenguaje/normalizar";
import { CIUDADES } from "@/lib/agente/lenguaje/lexico";
import { leerDepartamento, type Departamento } from "@/lib/agente/lenguaje/departamentos";
import type { CheckoutOpciones } from "@/lib/agente/perfil-negocio";

export type EnviosConfig = NonNullable<CheckoutOpciones["envios"]>;
type ReglaTiempo = EnviosConfig["tiempos"][number];
type Dia = "lun" | "mar" | "mie" | "jue" | "vie" | "sab" | "dom";

export const SHIPPING_STATUSES = ["covered", "not_covered", "coverage_unverified", "unknown_city", "inconsistent_location", "insufficient_info", "rules_unavailable"] as const;
export type ShippingStatus = (typeof SHIPPING_STATUSES)[number];
export const SHIPPING_ETA_TYPES = ["same_day_possible", "business_days", "text_only", "unknown"] as const;
export type ShippingEtaType = (typeof SHIPPING_ETA_TYPES)[number];

/** Respuesta ESTRUCTURADA del backend (lo único que el agente puede usar para hablar de un envío). */
export interface ShippingDecision {
  status: ShippingStatus;
  /** true = cobertura CONFIRMADA por el negocio; false = excluida; null = sin certeza. */
  covered: boolean | null;
  /** true solo si el negocio lo configuró; null = no hay información de costo (no se dice nada del costo). */
  free_shipping: true | null;
  /** Transportadora que la regla de ESA ciudad fija (null = no confirmada para la ciudad). */
  carrier: string | null;
  /** Transportadora habitual declarada por el negocio. NO es una promesa para esta ciudad. */
  usual_carrier: string | null;
  eta_type: ShippingEtaType;
  /** Antes de la hora límite de un día hábil: el mismo día es POSIBLE. Nunca una garantía. */
  same_day_possible: boolean;
  /** Siempre false: ningún tiempo de entrega es una garantía. */
  guaranteed: false;
  min_business_days: number | null;
  max_business_days: number | null;
  /** Texto EXACTO del negocio para el cliente: lo único que se puede repetir sobre el tiempo de entrega. */
  customer_text: string | null;
  /** Ciudad reconocida (como se muestra) o null. */
  city: string | null;
  /** Qué hay que pedirle al cliente (solo con información insuficiente). */
  ask: "city" | null;
  human_handoff_required: boolean;
  /** Código estable del motivo (para la traza y las pruebas; nunca texto del cliente). */
  reason: string;
  /** Solo si se evaluó una regla horaria: festivos explícitos revisados, o no revisados (el negocio los ignora). */
  holidays: "checked_explicit" | "not_checked" | null;
  /** Solo si se evaluó una regla horaria: momento evaluado en la hora de Colombia ("2026-10-02 09:15 vie"). */
  evaluated_at: string | null;
}

// ---------------------------------------------------------------------------
// Hora de Colombia
// ---------------------------------------------------------------------------

const DIAS: Readonly<Record<string, Dia>> = { Mon: "lun", Tue: "mar", Wed: "mie", Thu: "jue", Fri: "vie", Sat: "sab", Sun: "dom" };
const FORMATO = new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });

/** La fecha y la hora en Colombia de un instante (ms). No depende de la zona horaria del servidor. */
export function horaEnColombia(nowMs: number): { fecha: string; hora: string; minutos: number; dia: Dia } {
  const p = Object.fromEntries(FORMATO.formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  const hh = Number(p.hour);
  const mm = Number(p.minute);
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, minutos: hh * 60 + mm, dia: DIAS[p.weekday] ?? "lun" };
}

// ---------------------------------------------------------------------------
// Referencia geográfica: departamento de cada CAPITAL (cruce de seguridad)
// ---------------------------------------------------------------------------

/**
 * Solo capitales de departamento sin homónimos relevantes (geografía oficial). Sirve únicamente para detectar un
 * departamento que NO corresponde a la ciudad ("Bogotá, Antioquia") y mandar el caso a una persona. Para una ciudad
 * fuera de esta lista no se puede cruzar y no se afirma nada (un falso positivo aquí solo causa una derivación).
 * Excluidas a propósito por tener homónimos: Armenia, Florencia, San Andrés.
 */
const DEPARTAMENTO_DE_CAPITAL: Readonly<Record<string, readonly Departamento[]>> = {
  bogota: ["Bogotá D.C.", "Cundinamarca"],
  medellin: ["Antioquia"],
  cali: ["Valle del Cauca"],
  barranquilla: ["Atlántico"],
  cartagena: ["Bolívar"],
  cucuta: ["Norte de Santander"],
  bucaramanga: ["Santander"],
  pereira: ["Risaralda"],
  "santa marta": ["Magdalena"],
  ibague: ["Tolima"],
  pasto: ["Nariño"],
  manizales: ["Caldas"],
  neiva: ["Huila"],
  villavicencio: ["Meta"],
  valledupar: ["Cesar"],
  monteria: ["Córdoba"],
  sincelejo: ["Sucre"],
  popayan: ["Cauca"],
  tunja: ["Boyacá"],
  riohacha: ["La Guajira"],
  quibdo: ["Chocó"],
  yopal: ["Casanare"],
  mocoa: ["Putumayo"],
  leticia: ["Amazonas"],
  arauca: ["Arauca"],
  "san jose del guaviare": ["Guaviare"],
  inirida: ["Guainía"],
  mitu: ["Vaupés"],
  "puerto carreno": ["Vichada"],
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** "Bogotá D.C." / "bogota dc" / "Bogotá, Cundinamarca" => { ciudad: "bogota", departamento: "Cundinamarca" } */
function leerUbicacion(city: string | null | undefined, department: string | null | undefined): { ciudad: string; departamentoTexto: string | null } {
  let ciudadTexto = (city ?? "").trim();
  let departamentoTexto = (department ?? "").trim() || null;
  const coma = ciudadTexto.indexOf(",");
  if (coma >= 0) {
    // "Medellín, Antioquia": lo de después de la coma es el departamento (si no llegó aparte).
    if (!departamentoTexto) departamentoTexto = ciudadTexto.slice(coma + 1).trim() || null;
    ciudadTexto = ciudadTexto.slice(0, coma);
  }
  const ciudad = normalizar(ciudadTexto).replace(/\s+(d\s?c|dc|distrito capital|colombia)$/, "").trim();
  return { ciudad, departamentoTexto };
}

const titulo = (s: string) => s.replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());

function mostrar(ciudad: string): string {
  return CIUDADES[ciudad] ?? titulo(ciudad);
}

function base(rules: EnviosConfig | null | undefined): Pick<ShippingDecision, "free_shipping" | "usual_carrier"> {
  return { free_shipping: rules?.envio_gratis === true ? true : null, usual_carrier: rules?.transportadora_habitual ?? null };
}

/** Resultado sin un tiempo verificable: ni costo ni transportadora (solo una ciudad CUBIERTA con regla los trae). */
function sinTiempo(over: Partial<ShippingDecision> & Pick<ShippingDecision, "status" | "reason">): ShippingDecision {
  return {
    covered: null,
    carrier: null,
    eta_type: "unknown",
    same_day_possible: false,
    guaranteed: false,
    min_business_days: null,
    max_business_days: null,
    customer_text: null,
    city: null,
    ask: null,
    human_handoff_required: true,
    holidays: null,
    evaluated_at: null,
    free_shipping: null,
    usual_carrier: null,
    ...over,
  };
}

/** Todas las ciudades que el negocio nombró en su configuración (las reconoce aunque no estén en el léxico general). */
function ciudadesDelNegocio(rules: EnviosConfig): Set<string> {
  const s = new Set<string>();
  if (rules.cobertura.tipo === "lista_blanca") for (const c of rules.cobertura.ciudades) s.add(c);
  else for (const c of rules.cobertura.excluidas) s.add(c);
  for (const t of rules.tiempos) if (Array.isArray(t.ciudades)) for (const c of t.ciudades) s.add(c);
  return s;
}

// ---------------------------------------------------------------------------
// El motor
// ---------------------------------------------------------------------------

/**
 * Qué se puede afirmar sobre el envío a una ciudad. PURO: misma configuración + misma consulta + mismo
 * instante => misma respuesta. `nowMs` lo pone el backend (reloj del turno), nunca el modelo.
 */
export function resolverEnvio(rules: EnviosConfig | null | undefined, query: { city?: string | null; department?: string | null }, nowMs: number): ShippingDecision {
  if (!rules) return sinTiempo({ status: "rules_unavailable", reason: "shipping_rules_not_configured" });
  const { ciudad, departamentoTexto } = leerUbicacion(query.city, query.department);
  if (ciudad.length < 2) return sinTiempo({ status: "insufficient_info", reason: "city_missing", ask: "city", human_handoff_required: false });

  // 1) ¿Se reconoce la ciudad? (léxico general o la propia configuración del negocio). Nunca se inventa una.
  const conocidasDelNegocio = ciudadesDelNegocio(rules);
  if (!(ciudad in CIUDADES) && !conocidasDelNegocio.has(ciudad)) return sinTiempo({ status: "unknown_city", reason: "city_unrecognized" });
  const mostrada = mostrar(ciudad);

  // 2) Departamento (si llegó): debe ser un departamento y, si la ciudad es una capital conocida, el suyo.
  if (departamentoTexto !== null) {
    const departamento = leerDepartamento(departamentoTexto);
    if (!departamento) return sinTiempo({ status: "inconsistent_location", reason: "department_unrecognized", city: mostrada });
    const esperado = DEPARTAMENTO_DE_CAPITAL[ciudad];
    if (esperado && !esperado.includes(departamento)) return sinTiempo({ status: "inconsistent_location", reason: "department_mismatch", city: mostrada });
  }

  // 3) Cobertura.
  const cob = rules.cobertura;
  if (cob.tipo === "todo_el_pais_salvo" && cob.excluidas.includes(ciudad)) {
    return sinTiempo({ status: "not_covered", covered: false, reason: "city_excluded", city: mostrada, human_handoff_required: false });
  }
  if (cob.tipo === "lista_blanca" && !cob.ciudades.includes(ciudad)) {
    // El negocio solo declaró las ciudades de la lista: que no aparezca NO prueba que no la cubra. Es una duda: persona.
    return sinTiempo({ status: "coverage_unverified", reason: "city_not_in_coverage_list", city: mostrada });
  }

  // 4) Tiempo: la regla de ESA ciudad, o la del resto con cobertura. Sin regla => cubierta pero sin tiempo verificable.
  const regla: ReglaTiempo | undefined = rules.tiempos.find((t) => Array.isArray(t.ciudades) && t.ciudades.includes(ciudad)) ?? rules.tiempos.find((t) => t.ciudades === "resto_con_cobertura");
  if (!regla) return sinTiempo({ status: "covered", covered: true, reason: "eta_unverified", city: mostrada });

  const dias = regla.dias_habiles ?? null;
  const comun = {
    status: "covered" as const,
    covered: true,
    carrier: regla.transportadora ?? null,
    guaranteed: false as const,
    min_business_days: dias?.min ?? null,
    max_business_days: dias?.max ?? null,
    city: mostrada,
    ask: null,
    human_handoff_required: false,
    ...base(rules),
  };
  const corte = regla.corte;
  if (!corte) {
    return { ...comun, eta_type: dias ? "business_days" : "text_only", same_day_possible: false, customer_text: regla.texto, reason: dias ? "covered_business_days" : "covered_text_only", holidays: null, evaluated_at: null };
  }

  // 5) Regla horaria (p. ej. Bogotá, antes de las 11:30): hora de Colombia del reloj del backend.
  const t = horaEnColombia(nowMs);
  const [h, m] = corte.hora_limite.split(":").map(Number);
  const festivo = corte.festivos.tipo === "no_aplica_en" && corte.festivos.fechas.includes(t.fecha);
  const diaHabil = (corte.dias as readonly string[]).includes(t.dia) && !festivo;
  const antes = diaHabil && t.minutos < h * 60 + m;
  const evaluated_at = `${t.fecha} ${t.hora} ${t.dia}`;
  const holidays = corte.festivos.tipo === "no_aplica_en" ? ("checked_explicit" as const) : ("not_checked" as const);
  if (antes) {
    return { ...comun, eta_type: "same_day_possible", same_day_possible: true, customer_text: corte.texto_antes, reason: "before_cutoff_same_day_possible", holidays, evaluated_at };
  }
  // Después de la hora, o un día en que la regla no aplica (fin de semana / festivo explícito): nunca "mismo día".
  const despuesDeLaHora = diaHabil;
  return {
    ...comun,
    eta_type: dias ? "business_days" : "text_only",
    same_day_possible: false,
    customer_text: despuesDeLaHora ? corte.texto_despues : regla.texto,
    reason: despuesDeLaHora ? "after_cutoff" : festivo ? "cutoff_not_applicable_holiday" : "cutoff_not_applicable_day",
    holidays,
    evaluated_at,
  };
}

/** Para el checkout: ¿la ciudad está confirmada como cubierta? (cualquier otra cosa => una persona lo confirma). */
export function coberturaDeCiudad(rules: EnviosConfig | null | undefined, city: string, nowMs: number): "cubierta" | "sin_certeza" {
  const d = resolverEnvio(rules, { city }, nowMs);
  return d.status === "covered" && d.covered === true ? "cubierta" : "sin_certeza";
}
