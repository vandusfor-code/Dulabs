/**
 * `registrar_en_modulo` — UN intento de registro, compartido por el motor (en línea, con
 * reintentos) y por el conciliador (fuera de línea). GENÉRICO: no conoce ningún negocio.
 *
 * Orden de barreras (idéntico en ambos caminos): número del tenant → módulo conocido y con
 * manejador → módulo HABILITADO para el tenant (estricto: un error de BD es transitorio, nunca
 * "permitido") → manejador del módulo (idempotente por flowExecutionId).
 *
 * Cada llamada a la BD y al manejador tiene su propio tope de tiempo: un intento colgado se
 * trata como TRANSITORIO (resultado ambiguo) y el siguiente intento no puede duplicar porque el
 * manejador es idempotente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import type { ManejadorRegistroModulo, ValorCampoModulo } from "@/lib/flow/registro-modulo";
import { esModuloId, moduloHabilitado as moduloHabilitadoReal, type ModuloId } from "@/lib/tenant-modulos";

export interface PedidoRegistroModulo {
  tenantId: string;
  phoneNumberId: string;
  telefonoCliente: string;
  flowExecutionId: string;
  modulo: string;
  campos: Record<string, ValorCampoModulo>;
}

export interface ProcesadorRegistroDeps {
  supabase: SupabaseClient;
  authorizer: Pick<InternalActionAuthorizer, "assertPhoneNumberOwnedByTenant">;
  /**
   * Verificación ESTRICTA del número: lanza si la BD falla (en vez de responder "no es tuyo").
   * El autorizador compartido cierra en falso ante un error de BD (correcto para seguridad), pero
   * aquí eso convertiría un error transitorio en un rechazo definitivo SIN respaldo. Si no se
   * inyecta, se usa el autorizador.
   */
  verificarNumero?: (tenantId: string, phoneNumberId: string) => Promise<boolean>;
  registrosDeModulo?: Readonly<Partial<Record<string, ManejadorRegistroModulo>>>;
  moduloHabilitado?: (supabase: SupabaseClient, tenantId: string, modulo: ModuloId) => Promise<boolean>;
  /** Tope por llamada (BD o manejador). Por defecto 8 s. */
  timeoutLlamadaMs?: number;
}

/**
 *   registrado  → listo (creado=false si ya existía: reintento/reproceso de la misma ejecución).
 *   permanente  → reintentar no cambia nada (datos inválidos, módulo sin manejador...).
 *   transitorio → puede resolverse solo (BD caída, timeout, respuesta ambigua).
 *   rechazado   → barrera de seguridad o de configuración del tenant (número ajeno, módulo
 *                 deshabilitado): nunca se registra.
 */
export type ResultadoIntentoRegistro =
  | { tipo: "registrado"; registroId: string | number; creado: boolean }
  | { tipo: "permanente"; motivo: string }
  | { tipo: "transitorio"; motivo: string }
  | { tipo: "rechazado"; motivo: string };

/** Resultado que no es un registro exitoso (barreras o fallo del manejador). */
export type FalloRegistro = Exclude<ResultadoIntentoRegistro, { tipo: "registrado" }>;

export const TIMEOUT_LLAMADA_REGISTRO_MS = 8_000;

class TiempoAgotado extends Error {}

/** Rechaza con TiempoAgotado si la promesa no termina en `ms`. */
export async function conTope<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TiempoAgotado()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Número del tenant según dulabs_clientes_config; LANZA si la BD falla (nunca "no" por un error). */
export function crearVerificadorNumeroEstricto(supabase: SupabaseClient) {
  return async (tenantId: string, phoneNumberId: string): Promise<boolean> => {
    if (!tenantId || !phoneNumberId) return false;
    const { data, error } = await supabase.from("dulabs_clientes_config").select("id_tenant").eq("phone_number_id", phoneNumberId).maybeSingle();
    if (error) throw new Error(`[registro-modulo] no se pudo verificar el número: ${error.message}`);
    return !!data && String((data as { id_tenant: unknown }).id_tenant) === tenantId;
  };
}

/** Barreras previas al registro (sin escribir nada). ok → el manejador que debe usarse. */
export async function verificarDestinoRegistro(
  deps: ProcesadorRegistroDeps,
  pedido: PedidoRegistroModulo,
): Promise<{ ok: true; manejador: ManejadorRegistroModulo } | { ok: false; resultado: FalloRegistro }> {
  const tope = deps.timeoutLlamadaMs ?? TIMEOUT_LLAMADA_REGISTRO_MS;
  let dueno: boolean;
  try {
    const verificar = deps.verificarNumero ?? ((t: string, pn: string) => deps.authorizer.assertPhoneNumberOwnedByTenant(t, pn));
    dueno = await conTope(verificar(pedido.tenantId, pedido.phoneNumberId), tope);
  } catch {
    return { ok: false, resultado: { tipo: "transitorio", motivo: "numero_no_verificable" } };
  }
  if (!dueno) return { ok: false, resultado: { tipo: "rechazado", motivo: "numero_ajeno" } };
  if (!esModuloId(pedido.modulo)) return { ok: false, resultado: { tipo: "permanente", motivo: "modulo_desconocido" } };
  const manejador = deps.registrosDeModulo?.[pedido.modulo];
  if (!manejador) return { ok: false, resultado: { tipo: "permanente", motivo: "modulo_sin_registro" } };
  let habilitado: boolean;
  try {
    habilitado = await conTope((deps.moduloHabilitado ?? moduloHabilitadoReal)(deps.supabase, pedido.tenantId, pedido.modulo), tope);
  } catch {
    return { ok: false, resultado: { tipo: "transitorio", motivo: "modulo_no_verificable" } };
  }
  if (!habilitado) return { ok: false, resultado: { tipo: "rechazado", motivo: "modulo_no_habilitado" } };
  return { ok: true, manejador };
}

/** Una llamada al manejador del módulo, con tope de tiempo. Nunca lanza. */
export async function llamarManejadorRegistro(
  deps: ProcesadorRegistroDeps,
  pedido: PedidoRegistroModulo,
  manejador: ManejadorRegistroModulo,
): Promise<ResultadoIntentoRegistro> {
  try {
    const r = await conTope(
      manejador({
        supabase: deps.supabase,
        tenantId: pedido.tenantId,
        phoneNumberId: pedido.phoneNumberId,
        telefonoCliente: pedido.telefonoCliente,
        flowExecutionId: pedido.flowExecutionId,
        campos: pedido.campos,
      }),
      deps.timeoutLlamadaMs ?? TIMEOUT_LLAMADA_REGISTRO_MS,
    );
    if (r.ok) return { tipo: "registrado", registroId: r.registroId, creado: r.creado };
    return r.reintentable ? { tipo: "transitorio", motivo: r.motivo } : { tipo: "permanente", motivo: r.motivo };
  } catch (err) {
    // Timeout o excepción: el registro PUDO haberse guardado. Ambiguo → transitorio; el
    // siguiente intento es seguro porque el manejador es idempotente por la ejecución.
    return { tipo: "transitorio", motivo: err instanceof TiempoAgotado ? "timeout" : "excepcion" };
  }
}

/** Barreras + manejador: un intento completo. */
export async function intentarRegistroEnModulo(deps: ProcesadorRegistroDeps, pedido: PedidoRegistroModulo): Promise<ResultadoIntentoRegistro> {
  const destino = await verificarDestinoRegistro(deps, pedido);
  if (!destino.ok) return destino.resultado;
  return llamarManejadorRegistro(deps, pedido, destino.manejador);
}

/**
 * Política de reintentos FUERA de línea (conciliador): espera creciente entre rondas y un tope
 * de rondas; al agotarlo la fila pasa a "fallido" (visible) en vez de reintentarse para siempre.
 */
export const POLITICA_CONCILIACION = {
  maxRondas: 12,
  esperaSegundos(ronda: number): number {
    return Math.min(60 * 2 ** Math.max(ronda - 1, 0), 6 * 60 * 60);
  },
} as const;
