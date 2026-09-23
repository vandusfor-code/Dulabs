/**
 * Cerco de pruebas (endpoint /api/diagnostics/amore-pruebas, SOLO Preview) -- contexto asíncrono que acompaña a UNA
 * ejecución de prueba y que las dos únicas salidas con efectos externos consultan antes de actuar:
 *   - lib/whatsapp-worker-client.ts (todo envío de WhatsApp por el worker)
 *   - lib/nylas/nylas-client.ts     (toda escritura en un calendario real)
 * Fuera de una ejecución de prueba no hay cerco activo (getStore() === undefined) y ambas se comportan EXACTAMENTE
 * como siempre. Dentro, lo que el cerco no permite explícitamente se bloquea y queda registrado -- así ningún camino
 * del bot (incluido uno que no reciba las dependencias inyectadas, como el Flow Engine o un aviso a Jessica) puede
 * escribirle a un número distinto del fijado en el servidor, ni tocar un calendario real sin la bandera de reserva.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type EventoCerco =
  | { tipo: "envio_permitido"; ruta: string; destinoFinal4: string }
  | { tipo: "envio_bloqueado"; ruta: string; destinoFinal4: string; motivo: string }
  | { tipo: "escritura_nylas_bloqueada"; operacion: "crear" | "actualizar" | "borrar" }
  | { tipo: "escritura_db_bloqueada"; tabla: string; operacion: string }
  | { tipo: "log"; nivel: "error" | "warn"; texto: string };

export interface CercoPruebas {
  /** Decide si una llamada al worker (enviar, enviar-audio, estado, iniciar...) puede salir. `destino` = dígitos del teléfono destino, o null si la ruta no envía a nadie. */
  permitirLlamadaWorker(p: { idTenant: string; ruta: string; destino: string | null }): boolean;
  permitirEscrituraNylas: boolean;
  registrar(evento: EventoCerco): void;
}

const almacen = new AsyncLocalStorage<CercoPruebas>();

export function ejecutarDentroDeCerco<T>(cerco: CercoPruebas, fn: () => Promise<T>): Promise<T> {
  return almacen.run(cerco, fn);
}

export function cercoActivo(): CercoPruebas | undefined {
  return almacen.getStore();
}

export const final4 = (telefono: string | null | undefined) => (telefono ?? "").replace(/\D/g, "").slice(-4);

/** Error propio: el router de Agenda V2 lo atrapa como cualquier fallo técnico (sesión intacta, nada escrito). */
export class BloqueadoPorCercoDePruebas extends Error {
  constructor(detalle: string) {
    super(`bloqueado_por_cerco_de_pruebas: ${detalle}`);
    this.name = "BloqueadoPorCercoDePruebas";
  }
}

/**
 * console.error/console.warn del bot DENTRO de una ejecución de prueba se copian al cerco (para devolverlos como
 * "errores observados", ya saneados). Solo se captura lo que ocurre en el contexto asíncrono del cerco -- nunca los
 * logs de otras peticiones que compartan la instancia. Se instala una sola vez y no cambia nada fuera del cerco.
 */
let consolaInstalada = false;
export function instalarCapturaDeConsola(): void {
  if (consolaInstalada) return;
  consolaInstalada = true;
  for (const nivel of ["error", "warn"] as const) {
    const original = console[nivel].bind(console);
    console[nivel] = (...args: unknown[]) => {
      const cerco = almacen.getStore();
      if (cerco) {
        const texto = args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : safeStringify(a))).join(" ");
        cerco.registrar({ tipo: "log", nivel, texto: texto.slice(0, 500) });
      }
      original(...args);
    };
  }
}

function safeStringify(valor: unknown): string {
  try {
    return JSON.stringify(valor) ?? String(valor);
  } catch {
    return String(valor);
  }
}
