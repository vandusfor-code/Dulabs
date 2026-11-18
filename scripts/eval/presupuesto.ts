/**
 * Tope de gasto y revisión previa de las evaluaciones con Gemini REAL (scripts/eval/gemini-comercial.ts y gemini-lenguaje.ts).
 *
 * Una evaluación real consume el crédito PREPAGADO de la persona dueña de la clave: una corrida completa son decenas de casos × varias repeticiones × 2 o 3 llamadas al modelo
 * cada una. Sin esto no había forma de acotarla ni de saber de antemano cuánto cuesta. Esto es PURO (sin red, sin archivos): cada script le pasa lo que gastó cada turno y le
 * pregunta, ANTES de empezar el siguiente caso, si ya se pasó. Nunca interrumpe un caso a la mitad (dejaría el mundo de la prueba a medias): el exceso máximo es un caso.
 *
 *   --presupuesto-tokens <N>   tope de tokens (entrada + salida + pensamiento) de toda la corrida
 *   --max-llamadas <N>         tope de llamadas al modelo de toda la corrida
 *   --estimar                  NO llama a nadie: imprime cuánto se espera gastar y termina
 *   --precio-entrada <USD>     (con --estimar) USD por millón de tokens de entrada, para ver el costo; sin esto solo se estiman tokens
 *   --precio-salida <USD>      (con --estimar) USD por millón de tokens de salida (incluye el pensamiento)
 */

export interface OpcionesPresupuesto {
  /** Tope de tokens de la corrida; null = sin tope. */
  maxTokens: number | null;
  /** Tope de llamadas al modelo de la corrida; null = sin tope. */
  maxLlamadas: number | null;
  /** Solo estimar: no se llama a nadie. */
  estimar: boolean;
  /** USD por millón de tokens (solo para mostrar el costo estimado). */
  precioEntrada: number | null;
  precioSalida: number | null;
}

/** Lo que gastó un turno del agente (los contadores de su traza). */
export interface UsoDeTurno {
  usage: { input: number; output: number; thinking: number };
  /** Llamadas al modelo del turno (rondas) y reintentos: cada reintento es otra llamada HTTP. */
  rounds: number;
  retries: number;
}

/** 1234567 -> "1.234.567" (sin depender de los datos de idioma de Node: la salida es la misma en cualquier equipo). */
const miles = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const numero = (argv: readonly string[], nombre: string): number | null => {
  const i = argv.indexOf(nombre);
  if (i < 0) return null;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Lee las opciones de gasto de la línea de comandos. Un valor que no es un número positivo se ignora (nunca deja un tope en 0 o NaN). */
export function leerOpcionesPresupuesto(argv: readonly string[]): OpcionesPresupuesto {
  return {
    maxTokens: numero(argv, "--presupuesto-tokens"),
    maxLlamadas: numero(argv, "--max-llamadas"),
    estimar: argv.includes("--estimar"),
    precioEntrada: numero(argv, "--precio-entrada"),
    precioSalida: numero(argv, "--precio-salida"),
  };
}

export interface Presupuesto {
  /** Suma lo que gastó un turno. */
  registrar(turno: UsoDeTurno): void;
  /** Lo gastado hasta ahora. */
  gastado(): { tokens: number; llamadas: number };
  /** null = se puede seguir; si no, el motivo (para el informe): qué tope se pasó y por cuánto. */
  excedido(): string | null;
}

export function crearPresupuesto(opciones: Pick<OpcionesPresupuesto, "maxTokens" | "maxLlamadas">): Presupuesto {
  let tokens = 0;
  let llamadas = 0;
  return {
    registrar(t) {
      tokens += Math.max(0, t.usage.input) + Math.max(0, t.usage.output) + Math.max(0, t.usage.thinking);
      llamadas += Math.max(0, t.rounds) + Math.max(0, t.retries);
    },
    gastado: () => ({ tokens, llamadas }),
    excedido() {
      if (opciones.maxTokens !== null && tokens >= opciones.maxTokens) return `tokens ${miles(tokens)} de ${miles(opciones.maxTokens)}`;
      if (opciones.maxLlamadas !== null && llamadas >= opciones.maxLlamadas) return `llamadas ${llamadas} de ${opciones.maxLlamadas}`;
      return null;
    },
  };
}

/**
 * Cuánto se espera gastar. Los promedios son los medidos en el diseño del agente (DELACOUR_PILOTO.md): la instrucción de sistema y las herramientas pesan ~7.000 tokens de entrada
 * por llamada y un turno típico son 2 llamadas (consulta de herramienta + respuesta). Es una cota para decidir si vale la pena correr, NO una factura: el costo real depende de la
 * tarifa vigente del modelo y de cuánto de la entrada se reutiliza (caché).
 */
export const PROMEDIOS_POR_TURNO = { llamadas: 2.2, entrada: 7_000, salida: 450 } as const;

export interface Estimacion {
  turnos: number;
  llamadas: number;
  tokensEntrada: number;
  tokensSalida: number;
  tokens: number;
  /** USD, solo si se dieron los dos precios. */
  usd: number | null;
}

export function estimarCorrida(entrada: { turnos: number; repeticiones: number; precioEntrada?: number | null; precioSalida?: number | null }): Estimacion {
  const turnos = Math.max(0, Math.round(entrada.turnos * Math.max(1, entrada.repeticiones)));
  const llamadas = Math.round(turnos * PROMEDIOS_POR_TURNO.llamadas);
  const tokensEntrada = llamadas * PROMEDIOS_POR_TURNO.entrada;
  const tokensSalida = llamadas * PROMEDIOS_POR_TURNO.salida;
  const usd = entrada.precioEntrada != null && entrada.precioSalida != null ? (tokensEntrada / 1_000_000) * entrada.precioEntrada + (tokensSalida / 1_000_000) * entrada.precioSalida : null;
  return { turnos, llamadas, tokensEntrada, tokensSalida, tokens: tokensEntrada + tokensSalida, usd };
}

/** El texto de `--estimar`, en español claro. */
export function textoDeEstimacion(e: Estimacion, contexto: { casos: number; repeticiones: number }): string {
  const n = miles;
  return [
    `Estimación (NO se llamó a nadie): ${contexto.casos} caso(s) × ${contexto.repeticiones} corrida(s) = ${n(e.turnos)} turnos ≈ ${n(e.llamadas)} llamadas al modelo.`,
    `Tokens aproximados: ${n(e.tokensEntrada)} de entrada + ${n(e.tokensSalida)} de salida = ${n(e.tokens)}.`,
    e.usd !== null ? `Costo aproximado con tus precios: US$ ${e.usd.toFixed(2)}.` : "Para ver el costo agrega --precio-entrada y --precio-salida (USD por millón de tokens, según tu tarifa vigente).",
    `Para acotar el gasto: --presupuesto-tokens ${n(Math.round(e.tokens * 0.5))} (la mitad) o --max-llamadas ${n(Math.round(e.llamadas * 0.5))}; para correr solo una parte: --solo "<regex de ids>".`,
  ].join("\n");
}

/**
 * Qué decirle a la persona cuando la llamada de prueba (el «canario») no obtuvo respuesta, según la causa que dejó la traza (`error_kind`).
 * Lo importante: con la cuenta sin saldo NO se gasta nada más y se dice qué hacer.
 */
export function mensajeDeCanarioFallido(kind: string | null | undefined): string {
  switch (kind) {
    case "quota":
      return "Gemini respondió que NO hay saldo o cupo (crédito prepagado agotado, tope de gasto o cupo diario). Nada se gastó: recarga el crédito en Google AI Studio (o espera al reinicio del cupo diario) y vuelve a correr.";
    case "auth":
      return "Gemini rechazó la clave (401/403): revisa que GEMINI_EVAL_KEY sea válida, esté activa y tenga acceso a la API de Gemini.";
    case "rate_limit":
      return "Gemini limitó las peticiones por minuto: espera un momento y repite (o usa --pausa para espaciar los casos).";
    case "timeout":
    case "server":
    case "network":
      return `Gemini no respondió a tiempo o hay un problema de red/servicio (${kind}): repite en unos minutos.`;
    default:
      return `Gemini NO respondió en la llamada de prueba (error: ${kind ?? "sin rondas"}). Revisa la clave o su acceso a la API de Gemini.`;
  }
}
