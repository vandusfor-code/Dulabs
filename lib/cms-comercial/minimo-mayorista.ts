/**
 * CMS comercial — el MÍNIMO de la compra inicial mayorista, editable desde el panel de la tienda. PURO (tipos, reglas y nombres; sin I/O).
 *
 * El número vive en la configuración del asistente (`negocio.pedido.minimo_mayorista`) y de ahí lo usan la regla de la primera compra mayorista del asistente y los textos del CMS que escriben
 * `{{minimo_mayorista}}`. Cambiarlo desde el panel lo hace una función SQL atómica (supabase/migrations/20261214000000_dulabs_agente_minimo_mayorista.sql) que también actualiza el monto escrito a mano
 * dentro de los textos del asistente y deja una fila de auditoría. Aquí viven las reglas que ve también el navegador.
 */
import { z } from "zod";

/** El mínimo permitido: un entero entre $10.000 y $100.000.000 (un «75» por «750.000» o un cero de más no pasa). La base lo vuelve a exigir. */
export const MINIMO_MAYORISTA_MIN = 10_000;
export const MINIMO_MAYORISTA_MAX = 100_000_000;

export const minimoMayoristaSchema = z.strictObject({
  /** El mínimo nuevo, en pesos. */
  minimo: z
    .number({ error: "Escribe el monto en pesos." })
    .int({ message: "El monto debe ser un valor entero en pesos." })
    .min(MINIMO_MAYORISTA_MIN, { message: "El mínimo no puede ser menor de $10.000." })
    .max(MINIMO_MAYORISTA_MAX, { message: "El mínimo no puede superar $100.000.000." }),
  /** El mínimo que la persona estaba viendo al editar: si mientras tanto cambió, no se pisa el cambio de otra persona. */
  esperado: z.number({ error: "Falta el monto que estabas viendo." }).int().min(1).max(1_000_000_000),
});
export type MinimoMayoristaInput = z.output<typeof minimoMayoristaSchema>;

/** Cómo está el mínimo hoy: lo que el panel muestra antes de editar. */
export interface MinimoMayoristaVista {
  /** El negocio tiene un mínimo entero configurado en alguna línea habilitada. */
  configurado: boolean;
  /** El mínimo vigente (null si no está configurado). */
  minimo: number | null;
  /** Todas las líneas habilitadas con mínimo tienen el MISMO valor (si no, el panel no elige por la persona). */
  uniforme: boolean;
  filas: number;
  /** Las rutas de los textos del asistente que tienen el monto escrito a mano (se actualizan junto con el mínimo). */
  lugares: string[];
}

/** Lo que pasó al cambiarlo. */
export interface ResultadoMinimoMayorista {
  /** false = el monto nuevo era el mismo: no se tocó nada. */
  cambio: boolean;
  antes: number;
  despues: number;
  filas: number;
  lugares: string[];
}

export interface PuertoMinimoMayorista {
  ver(tenantId: string): Promise<MinimoMayoristaVista>;
  /** `actorUserId`: el usuario de la sesión (queda en la auditoría). `esperado`: el mínimo que la persona estaba viendo. */
  fijar(tenantId: string, actorUserId: string, nuevo: number, esperado: number): Promise<ResultadoMinimoMayorista>;
}

/** Qué clase de texto del asistente es (la persona no ve rutas técnicas): la pantalla lo traduce. */
export const GRUPOS_DE_LUGAR = ["mayor", "inicio", "conocimiento", "pedido", "reglas", "otros"] as const;
export type GrupoDeLugar = (typeof GRUPOS_DE_LUGAR)[number];

export function grupoDeLugar(ruta: string): GrupoDeLugar {
  if (ruta === "inicio.mayor") return "mayor";
  if (ruta.startsWith("inicio.")) return "inicio";
  if (ruta.startsWith("conocimiento.")) return "conocimiento";
  if (ruta.startsWith("pedido.")) return "pedido";
  if (/^(presentacion|saludo|tono|personalidad|politicas)(\.|$)/.test(ruta)) return "reglas";
  return "otros";
}

/** Cuántos textos hay de cada clase (en el orden fijo de GRUPOS_DE_LUGAR; solo las clases que aparecen). */
export function contarLugares(rutas: readonly string[]): Array<{ grupo: GrupoDeLugar; n: number }> {
  const cuenta = new Map<GrupoDeLugar, number>();
  for (const r of rutas) cuenta.set(grupoDeLugar(r), (cuenta.get(grupoDeLugar(r)) ?? 0) + 1);
  return GRUPOS_DE_LUGAR.filter((g) => cuenta.has(g)).map((grupo) => ({ grupo, n: cuenta.get(grupo) as number }));
}

// ---------------------------------------------------------------------------
// El monto escrito A MANO dentro de un texto del asistente
// ---------------------------------------------------------------------------

/** 750000 → «750.000» (puntos de miles; no depende del idioma del equipo que lo ejecuta). */
export const conPuntosDeMiles = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Cómo se reconoce un monto escrito a mano: «750.000» (con puntos de miles) o «750000», sin pegarse a otro número por delante («1.750.000») ni por detrás («750.000,50»). Es la misma regla con la que
 * el CMS impide publicar un monto a mano (escribioMontoAMano en variables.ts). Solo los DÍGITOS son el monto: el «$» y los espacios que lo acompañen se conservan.
 */
function patronDeMonto(monto: number): RegExp {
  const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d.,])(?:${escapar(conPuntosDeMiles(monto))}|${Math.round(monto)})(?!\\d|[.,]\\d)`, "g");
}

/** ¿Tiene el texto ese monto escrito a mano? */
export const textoTieneMonto = (texto: string, monto: number): boolean => new RegExp(patronDeMonto(monto).source).test(texto);

/** El texto con el monto viejo cambiado por el nuevo, en el mismo estilo (con puntos de miles o sin ellos). El resto del texto no se toca. */
export function montoEnTexto(texto: string, viejo: number, nuevo: number): string {
  return texto.replace(patronDeMonto(viejo), (escrito) => (escrito.includes(".") ? conPuntosDeMiles(nuevo) : String(Math.round(nuevo))));
}

/** El valor (texto, lista u objeto, a cualquier profundidad) con el monto cambiado SOLO dentro de los textos: ni las claves, ni los números, ni los booleanos cambian. No altera el original. */
export function montoEnJson<T>(valor: T, viejo: number, nuevo: number): T {
  if (typeof valor === "string") return montoEnTexto(valor, viejo, nuevo) as T;
  if (Array.isArray(valor)) return valor.map((x) => montoEnJson(x, viejo, nuevo)) as T;
  if (typeof valor === "object" && valor !== null) return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, montoEnJson(v, viejo, nuevo)])) as T;
  return valor;
}

/** Las rutas («inicio.mayor», «conocimiento.3.info»…) de los textos que tienen ese monto escrito a mano, en orden. */
export function rutasConMonto(valor: unknown, monto: number, ruta = ""): string[] {
  const salida: string[] = [];
  const unir = (clave: string) => (ruta === "" ? clave : `${ruta}.${clave}`);
  if (typeof valor === "string") {
    if (textoTieneMonto(valor, monto)) salida.push(ruta);
  } else if (Array.isArray(valor)) {
    valor.forEach((x, i) => salida.push(...rutasConMonto(x, monto, unir(String(i)))));
  } else if (typeof valor === "object" && valor !== null) {
    for (const [k, v] of Object.entries(valor)) salida.push(...rutasConMonto(v, monto, unir(k)));
  }
  return ruta === "" ? [...new Set(salida)].sort() : salida;
}

/** El valor que hay en una ruta de punto («conocimiento.3.info»); undefined si no existe. */
export function valorEnRuta(valor: unknown, ruta: string): unknown {
  let actual: unknown = valor;
  for (const paso of ruta.split(".")) {
    if (Array.isArray(actual)) actual = actual[Number(paso)];
    else if (typeof actual === "object" && actual !== null) actual = (actual as Record<string, unknown>)[paso];
    else return undefined;
  }
  return actual;
}

/** El mínimo que trae una configuración del asistente (`pedido.minimo_mayorista`), o null si no tiene uno entero. */
export function minimoDeNegocio(negocio: unknown): number | null {
  const pedido = typeof negocio === "object" && negocio !== null ? (negocio as { pedido?: unknown }).pedido : undefined;
  const minimo = typeof pedido === "object" && pedido !== null ? (pedido as { minimo_mayorista?: unknown }).minimo_mayorista : undefined;
  return typeof minimo === "number" && Number.isSafeInteger(minimo) ? minimo : null;
}
