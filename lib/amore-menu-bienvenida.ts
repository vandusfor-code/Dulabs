/**
 * AMORE, modo «saludo único» (lib/amore-bot-modo.ts) -- ¿qué opción del menú de bienvenida está eligiendo la clienta?
 *
 *   ¿Qué deseas hacer?   1. Quiero una cita   2. Quiero hacer una consulta   3. Hablar con una persona
 *
 * Solo se consulta mientras el menú está pendiente (su siguiente mensaje tras el saludo), así que ahí un mensaje corto como «cita» o «uno» no es ambiguo. Reconoce el número
 * escrito de varias formas («1», «1.», «1️⃣», «la 1», «opción 1», «uno», «opción dos por favor») y lo que dice cada opción a secas («cita», «agendar», «consulta», «una persona»).
 * Cualquier otra cosa devuelve null: el asistente no adivina.
 */
import { normalizeText } from "@/lib/flow-triggers/normalize-text";

export type OpcionMenuBienvenida = "1" | "2" | "3";

const NUMERO: Record<string, OpcionMenuBienvenida> = {
  "1": "1",
  uno: "1",
  primera: "1",
  "2": "2",
  dos: "2",
  segunda: "2",
  "3": "3",
  tres: "3",
  tercera: "3",
};

const CORTESIA_FINAL = String.raw`(?:\s+(?:por favor|porfa|porfis|pf|gracias))?`;

export function opcionDelMenuBienvenida(texto: string): OpcionMenuBienvenida | null {
  const t = normalizeText(texto)
    .replace(/[️⃣]/g, "") // el emoji «1️⃣» es el «1» + dos marcas invisibles (normalizeText ya las quita; aquí queda explícito)
    .replace(/[.,;:!?¡¿()\-_*#"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t === "") return null;

  // «1», «la 1», «opcion 2», «numero tres», «uno», «opcion 3 por favor»
  const numero = t.match(new RegExp(String.raw`^(?:(?:la|el|opcion|numero|num)\s+){0,2}(1|2|3|uno|dos|tres|primera|segunda|tercera)${CORTESIA_FINAL}$`));
  if (numero) return NUMERO[numero[1]!] ?? null;

  // Lo que dice cada opción, a secas.
  if (new RegExp(String.raw`^(?:una\s+)?(?:cita|citas|agenda)${CORTESIA_FINAL}$`).test(t)) return "1";
  if (new RegExp(String.raw`^(?:agendar|reservar|separar|apartar)${CORTESIA_FINAL}$`).test(t)) return "1";
  if (new RegExp(String.raw`^(?:quiero\s+|quisiera\s+)?(?:hacer\s+|tengo\s+)?(?:una\s+)?(?:consulta|pregunta)${CORTESIA_FINAL}$`).test(t)) return "2";
  if (new RegExp(String.raw`^(?:una\s+)?persona${CORTESIA_FINAL}$`).test(t)) return "3";
  return null;
}
