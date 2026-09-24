/**
 * Publi Bordados — Fase 2A: observador SHADOW de WhatsApp Coexistence.
 *
 * Es completamente INERTE para el negocio: no llama a Gemini, no envía WhatsApp, no pausa ni
 * toma conversaciones, no toca Flow/legacy/agentes ni la configuración de otros tenants. Solo
 * registra, en tablas propias de PB, qué eventos llegan para el número de PB (sin texto ni
 * teléfonos) para medir Coexistence con datos reales.
 *
 * Activación (dos llaves, ambas necesarias):
 *   1. PUBLIBORDADOS_ENABLED=true en el servidor (sin ella no se lee NINGUNA tabla).
 *   2. Una fila en dulabs_pb_config con enabled = true (shadow_mode es obligatorio en 2A).
 *
 * Fail-safe: nunca lanza ni rechaza. Cualquier error se registra en el log técnico y el webhook
 * sigue exactamente igual (este módulo se ejecuta en after(), fuera del camino de respuesta).
 */
import { supabaseAdmin } from "@/lib/supabase";
import { clasificarEcos, extraerObservaciones, type ChangeCrudo, type OrigenesWamid } from "./extraer";
import { createSupabaseObservadorStore, type ConfigObservador, type ObservadorStore } from "./repositorio";

const TTL_CACHE_MS = 30_000;
type EntradaCache = { valor: ConfigObservador | null; vence: number };
const cacheConfig = new Map<string, EntradaCache>();

/** Interruptor maestro. Síncrono y sin I/O: si es false, el webhook ni siquiera programa el observador. */
export function observadorPublibordadosActivo(env: Record<string, string | undefined> = process.env): boolean {
  return env.PUBLIBORDADOS_ENABLED === "true";
}

export interface ResultadoObservacion {
  estado: "inactivo" | "no_es_pb" | "tenant_no_coincide" | "observado" | "error";
  nuevas?: number;
  repetidas?: number;
  error?: string;
}

export interface DepsObservador {
  store?: ObservadorStore;
  env?: Record<string, string | undefined>;
  ahora?: () => number;
  /** Solo tests: desactiva la caché de configuración. */
  sinCache?: boolean;
  log?: (linea: string) => void;
}

function logTecnico(linea: string) {
  console.log(linea);
}

async function configCacheada(store: ObservadorStore, phoneNumberId: string, ahora: number, sinCache: boolean): Promise<ConfigObservador | null> {
  const hit = sinCache ? undefined : cacheConfig.get(phoneNumberId);
  if (hit && hit.vence > ahora) return hit.valor;
  const valor = await store.configDe(phoneNumberId);
  if (!sinCache) cacheConfig.set(phoneNumberId, { valor, vence: ahora + TTL_CACHE_MS });
  return valor;
}

/**
 * Observa UN `change` del webhook. La copia del evento se toma de forma SÍNCRONA al llamar
 * (antes de cualquier await), así el procesamiento normal del webhook, que corre en paralelo,
 * no altera lo observado. Devuelve una promesa que NUNCA se rechaza.
 */
export function observarCambioPublibordados(change: unknown, recibidoAt: Date, deps: DepsObservador = {}): Promise<ResultadoObservacion> {
  let copia: ChangeCrudo;
  try {
    if (!observadorPublibordadosActivo(deps.env)) return Promise.resolve({ estado: "inactivo" });
    copia = structuredClone(change) as ChangeCrudo;
  } catch (err) {
    return Promise.resolve({ estado: "error", error: err instanceof Error ? err.message : String(err) });
  }
  return observar(copia, recibidoAt, deps).catch((err) => {
    const mensaje = err instanceof Error ? err.message : String(err);
    try {
      (deps.log ?? logTecnico)(`[publibordados-observador] ERROR ${mensaje.slice(0, 300)}`);
    } catch {
      /* el log nunca puede romper al webhook */
    }
    return { estado: "error" as const, error: mensaje };
  });
}

async function observar(change: ChangeCrudo, recibidoAt: Date, deps: DepsObservador): Promise<ResultadoObservacion> {
  const value = change && typeof change.value === "object" && change.value !== null ? (change.value as Record<string, unknown>) : {};
  const metadata = typeof value.metadata === "object" && value.metadata !== null ? (value.metadata as Record<string, unknown>) : {};
  const phoneNumberId = typeof metadata.phone_number_id === "string" ? metadata.phone_number_id : null;
  // Sin phone_number_id el evento no se puede atribuir a un número: no es (demostrablemente) de PB.
  if (!phoneNumberId) return { estado: "no_es_pb" };

  const store = deps.store ?? createSupabaseObservadorStore(supabaseAdmin());
  const ahora = (deps.ahora ?? Date.now)();
  const config = await configCacheada(store, phoneNumberId, ahora, deps.sinCache === true);
  if (!config) return { estado: "no_es_pb" };

  // Identidad: el tenant de la config de PB debe ser el tenant real del número en DuLabs.
  const tenantReal = await store.tenantDelNumero(phoneNumberId);
  if (!tenantReal || tenantReal.toLowerCase() !== config.idTenant.toLowerCase()) {
    (deps.log ?? logTecnico)(`[publibordados-observador] tenant_no_coincide phone=${phoneNumberId}`);
    return { estado: "tenant_no_coincide" };
  }

  const base = extraerObservaciones(change, { idTenant: config.idTenant, phoneNumberId, recibidoAt });
  const wamidsSalientes = base.filter((o) => (o.event_type === "ECHO_UNCLASSIFIED" || o.event_type === "STATUS") && o.wamid).map((o) => o.wamid as string);
  let origenes: OrigenesWamid | null = null;
  try {
    origenes = await store.origenesDe(phoneNumberId, [...new Set(wamidsSalientes)]);
  } catch (err) {
    // Sin registro de envíos no se inventa la clasificación: los ecos quedan como UNKNOWN.
    (deps.log ?? logTecnico)(`[publibordados-observador] origenes_no_disponibles ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
  }
  const filas = clasificarEcos(base, origenes);
  const { nuevas, repetidas } = await store.guardar(filas);
  (deps.log ?? logTecnico)(
    `[publibordados-observador] phone=${phoneNumberId} campo=${String(change.field ?? "?").slice(0, 40)} eventos=${filas
      .map((f) => f.event_type)
      .join(",")} nuevas=${nuevas} repetidas=${repetidas}`,
  );
  return { estado: "observado", nuevas, repetidas };
}

/** Solo tests. */
export function _limpiarCacheObservador(): void {
  cacheConfig.clear();
}
