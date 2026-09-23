/**
 * Endpoint de pruebas de AMORE -- habilitación, autenticación y saneamiento de salida. Todo puro (el entorno y la
 * hora se inyectan) para que los tests cubran cada rechazo sin depender del proceso.
 *
 * Autenticación: firma HMAC-SHA256 del cuerpo EXACTO con un secreto propio (AMORE_PRUEBAS_TOKEN). El secreto nunca
 * viaja: cada petición lleva `x-amore-pruebas-timestamp` (segundos Unix) y `x-amore-pruebas-firma`
 * (`v1=<hex de HMAC(token, "<timestamp>.<cuerpo>")>`). La hora se limita a ±60 s y cada firma se acepta una sola vez
 * (ver route.ts), así que una petición capturada no se puede repetir ni modificar.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const VENTANA_TIMESTAMP_SEG = 60;
export const LARGO_MINIMO_TOKEN = 32;

type Entorno = Record<string, string | undefined>;

/**
 * El endpoint existe SOLO en un deployment Preview con la bandera explícita y un token largo. En Production (o en
 * local, o sin la bandera) la ruta responde 404 sin leer el cuerpo -- como si no existiera.
 */
export function pruebasHabilitadas(env: Entorno): boolean {
  if (env.VERCEL_ENV !== "preview") return false;
  if (env.AMORE_PRUEBAS_HABILITADAS !== "1") return false;
  return (env.AMORE_PRUEBAS_TOKEN?.length ?? 0) >= LARGO_MINIMO_TOKEN;
}

export function firmarCuerpo(token: string, timestamp: string, cuerpo: string): string {
  return `v1=${createHmac("sha256", token).update(`${timestamp}.${cuerpo}`).digest("hex")}`;
}

/** Comparación en tiempo constante sobre hashes de longitud fija (mismo patrón que app/api/diagnostics/token-status). */
function igualesTiempoConstante(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export type ResultadoFirma = { ok: true } | { ok: false; motivo: "sin_cabeceras" | "timestamp_invalido" | "fuera_de_ventana" | "firma_invalida" };

export function verificarFirma(p: { token: string; timestamp: string | null; firma: string | null; cuerpo: string; ahoraMs: number }): ResultadoFirma {
  if (!p.timestamp || !p.firma) return { ok: false, motivo: "sin_cabeceras" };
  if (!/^\d{9,11}$/.test(p.timestamp)) return { ok: false, motivo: "timestamp_invalido" };
  if (Math.abs(p.ahoraMs / 1000 - Number(p.timestamp)) > VENTANA_TIMESTAMP_SEG) return { ok: false, motivo: "fuera_de_ventana" };
  const esperada = firmarCuerpo(p.token, p.timestamp, p.cuerpo);
  return igualesTiempoConstante(esperada, p.firma) ? { ok: true } : { ok: false, motivo: "firma_invalida" };
}

/** Huella de la firma para el control de "una sola vez" -- nunca se guarda la firma en sí. */
export function huellaFirma(firma: string): string {
  return createHash("sha256").update(firma).digest("hex").slice(0, 32);
}

// --- Saneamiento de salida ---------------------------------------------------------------------------------------------

const NOMBRE_SENSIBLE = /(KEY|SECRET|TOKEN|PASSWORD|PASS|GRANT|PRIVATE|CREDENTIAL|_URL|DSN|WEBHOOK)/i;

/** Valores reales de toda variable de entorno con nombre sensible (nunca se devuelven; solo se usan para tacharlos si aparecieran en la salida). */
export function valoresSensiblesDelEntorno(env: Entorno): string[] {
  const valores = new Set<string>();
  for (const [nombre, valor] of Object.entries(env)) {
    if (!valor || valor.length < 8) continue;
    if (NOMBRE_SENSIBLE.test(nombre)) valores.add(valor);
  }
  // Los más largos primero: un valor que contenga a otro se tacha completo.
  return [...valores].sort((a, b) => b.length - a.length);
}

const PATRONES: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  [/Bearer\s+[^\s"',]+/gi, "Bearer [REDACTADO]"],
  [/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[REDACTADO_JWT]"],
  [/\b(?:nyk|sk|pk|rk|whsec|xox[abp])_[\w-]{8,}/gi, "[REDACTADO_CLAVE]"],
  [/\bAIza[\w-]{30,}/g, "[REDACTADO_CLAVE]"],
  // URL: se conserva protocolo + host + ruta; se quitan credenciales y parámetros.
  [/\b(https?):\/\/(?:[^\s/@]+@)?([^\s/?#"']+)([^\s?#"']*)(?:[?#][^\s"']*)?/gi, (_m, proto, host, ruta) => `${proto}://${host}${ruta}`],
  // Correos (los calendar_id de Google suelen serlo): se enmascara la parte local.
  [/\b([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, (_m, ini, dom) => `${ini}***@${dom}`],
  [/\b[A-Za-z0-9_]{40,}\b/g, "[REDACTADO_LARGO]"],
];

export function sanearTexto(texto: string, secretos: string[]): string {
  let salida = texto;
  for (const s of secretos) if (salida.includes(s)) salida = salida.split(s).join("[REDACTADO]");
  for (const [re, reemplazo] of PATRONES) salida = salida.replace(re, reemplazo as never);
  return salida;
}

/** Recorre cualquier valor serializable y sanea cada string (claves incluidas). */
export function sanear<T>(valor: T, secretos: string[]): T {
  const visitar = (v: unknown): unknown => {
    if (typeof v === "string") return sanearTexto(v, secretos);
    if (Array.isArray(v)) return v.map(visitar);
    if (v && typeof v === "object") {
      if (v instanceof Date) return v.toISOString();
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [sanearTexto(k, secretos), visitar(x)]));
    }
    return v;
  };
  return visitar(valor) as T;
}

/** Identificador opaco y estable para un calendar_id (permite comparar entre respuestas sin revelarlo). */
export function enmascararIdentificador(valor: string): string {
  return `${valor.slice(0, 2)}…#${createHash("sha256").update(valor).digest("hex").slice(0, 6)}`;
}
