/**
 * CMS comercial — el cálculo (SOLO servidor) de cambiar el mínimo mayorista en la configuración del asistente. Sin I/O: recibe las líneas tal como están y devuelve lo que la base debe aplicar.
 *
 * Por qué aquí y no en SQL: un texto del asistente tiene un largo máximo (lib/agente/config.ts: `inicio.mayor` 900 caracteres, cada `conocimiento[].info` 800…). Un monto nuevo más largo que el viejo
 * («$750.000» → «$1.750.000») puede empujar un texto por encima de su máximo y dejar la configuración INVÁLIDA, y una configuración inválida hace que el asistente deje de responder (falla cerrado).
 * Por eso el cambio se calcula acá y se comprueba con el MISMO esquema con el que el asistente carga su configuración: si la nueva no lo cumple, el cambio ni se intenta. La base solo aplica lo ya
 * comprobado (con control de concurrencia).
 */
import { businessConfigSchema } from "@/lib/agente/config";
import { minimoDeNegocio, montoEnJson, rutasConMonto, valorEnRuta } from "@/lib/cms-comercial/minimo-mayorista";

export interface FilaDeNegocio {
  phone_number_id: string;
  negocio: unknown;
}

/** Lo que la base aplica por cada línea (ver dulabs_agente_minimo_mayorista_aplicar). */
export interface FilaPreparada {
  phone_number_id: string;
  antes: unknown;
  despues: unknown;
  /** De cada texto que cambió: ruta → cómo era. Solo para la auditoría. */
  textos_antes: Record<string, string>;
  textos_despues: Record<string, string>;
}

export type Preparacion =
  | { ok: true; filas: FilaPreparada[]; lugares: string[] }
  | {
      ok: false;
      /** `configuracion_invalida`: la configuración de hoy ya no cumple el esquema (el asistente ya tiene un problema: no se toca). `texto_demasiado_largo`: con el monto nuevo la configuración dejaría de cumplirlo. */
      motivo: "configuracion_invalida" | "texto_demasiado_largo";
      /** Las partes de la configuración que no cumplen (rutas, sin el contenido). */
      rutas: string[];
    };

const rutasConProblema = (error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }> }) => [...new Set(error.issues.map((i) => i.path.map(String).join(".")).filter((r) => r !== ""))].sort();

/** Prepara el cambio de `viejo` a `nuevo` en todas las líneas. Nada se escribe aquí: si algo no cumple, se dice cuál y no se prepara nada. */
export function prepararCambioDeMinimo(filas: readonly FilaDeNegocio[], viejo: number, nuevo: number): Preparacion {
  const preparadas: FilaPreparada[] = [];
  const lugares = new Set<string>();
  for (const fila of filas) {
    const hoy = businessConfigSchema.safeParse(fila.negocio);
    if (!hoy.success) return { ok: false, motivo: "configuracion_invalida", rutas: rutasConProblema(hoy.error) };

    const rutas = rutasConMonto(fila.negocio, viejo);
    const reemplazado = montoEnJson(fila.negocio, viejo, nuevo) as Record<string, unknown>;
    const pedido = typeof reemplazado.pedido === "object" && reemplazado.pedido !== null ? (reemplazado.pedido as Record<string, unknown>) : {};
    const despues = { ...reemplazado, pedido: { ...pedido, minimo_mayorista: nuevo } };

    const luego = businessConfigSchema.safeParse(despues);
    if (!luego.success) return { ok: false, motivo: "texto_demasiado_largo", rutas: rutasConProblema(luego.error) };

    const textosAntes: Record<string, string> = {};
    const textosDespues: Record<string, string> = {};
    for (const ruta of rutas) {
      textosAntes[ruta] = String(valorEnRuta(fila.negocio, ruta));
      textosDespues[ruta] = String(valorEnRuta(despues, ruta));
      lugares.add(ruta);
    }
    preparadas.push({ phone_number_id: fila.phone_number_id, antes: fila.negocio, despues, textos_antes: textosAntes, textos_despues: textosDespues });
  }
  return { ok: true, filas: preparadas, lugares: [...lugares].sort() };
}

/** El mínimo vigente de un conjunto de líneas: el de todas si coinciden; null si no hay ninguno; `uniforme: false` si hay montos distintos. */
export function minimoVigente(filas: readonly FilaDeNegocio[]): { minimo: number | null; uniforme: boolean } {
  const minimos = filas.map((f) => minimoDeNegocio(f.negocio)).filter((m): m is number => m !== null);
  if (minimos.length === 0) return { minimo: null, uniforme: true };
  return { minimo: Math.min(...minimos), uniforme: new Set(minimos).size === 1 };
}
