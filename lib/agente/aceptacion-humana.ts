/**
 * FASE 3B.5 — ACEPTACIÓN HUMANA: a quién le toca un pedido pendiente de aceptación y cómo se entera.
 *
 *   pedido pendiente de aceptación
 *     -> el BACKEND (nunca el modelo) verifica que la persona responsable configurada sea un miembro ACTIVO
 *        del MISMO negocio (si no: el pedido ni se envía a aceptación — fail-closed);
 *     -> asigna la conversación a esa persona (Inbox) sin quitársela a otra que ya la tuviera;
 *     -> le avisa por los canales configurados (hoy solo el panel; el resto queda preparado, sin inventar
 *        credenciales, destinos ni plantillas);
 *     -> deja la IA en silencio en esa conversación (el mecanismo de pausa de siempre, sin acortar nunca una
 *        pausa humana más larga).
 *
 * Todo es idempotente: repetir el envío, el reintento de un webhook o la recarga de una página no crea dos
 * asignaciones ni dos eventos ni dos avisos por el mismo acto. Nada de esto confirma una venta: aceptar es
 * una acción de una persona autenticada (lib/catalogo/pedidos/por-aceptar.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { eventIdFrom } from "@/lib/catalogo/pedidos/eventos";
import type { AcceptedReservation, Order } from "@/lib/catalogo/pedidos/contrato";
import type { AcceptanceRouter, HumanHandoffPort } from "@/lib/catalogo/pedidos/motor";
import { loadAgentConfig, type AgentConfigStore, type AgentRuntimeConfig } from "@/lib/agente/config";
import { cierreConAceptacion, reservaAlAceptar } from "@/lib/agente/perfil-negocio";
import { verificarResponsable, type MiembroEquipo, type MiembrosStore, type ResponsableConfig, type ResponsableError } from "@/lib/agente/responsable";

// ---------------------------------------------------------------------------
// Configuración que importa a los pedidos pendientes de aceptación
// ---------------------------------------------------------------------------

export type QuienAcepta = "solo_responsable" | "responsable_y_admins";

export interface ConfigAceptacion {
  responsable: ResponsableConfig;
  aceptan: QuienAcepta;
  reservaTrasAceptar: AcceptedReservation;
  /** Respuesta ÚNICA al "sí" del cliente después del aviso (texto exacto del negocio). */
  textoTrasAviso: string;
  /** D11: si una persona ya le escribió al cliente, ¿igual se le responde al "sí"? */
  siYaRespondioPersona: "no_responder" | "responder";
  /** Nota de envío del negocio (p. ej. "envío gratis"), solo para mostrarla a la persona. */
  notaEnvio: string | null;
  /**
   * Fase 3B.8: textos del negocio para el cliente tras una decisión humana (plantillas con {pedido} y, en rechazo y cancelación,
   * {motivo}). null/ausente = el negocio no configuró ese texto: no se le escribe nada (nunca se inventa uno).
   */
  textosDecision?: { aceptado: string | null; rechazado: string | null; cancelado: string | null };
}

/** null = el negocio no usa la aceptación humana (o la configuración no es utilizable): nunca se inventa nada. */
export function leerConfigAceptacion(config: Pick<AgentRuntimeConfig, "checkoutOptions" | "business">): ConfigAceptacion | null {
  const opciones = config.checkoutOptions;
  const cierre = opciones ? cierreConAceptacion(opciones) : null;
  const reserva = opciones ? reservaAlAceptar(opciones) : null;
  if (!cierre || !reserva) return null;
  return {
    responsable: cierre.responsable,
    aceptan: cierre.aceptan,
    reservaTrasAceptar: reserva,
    textoTrasAviso: cierre.textos.tras_aviso_confirma,
    siYaRespondioPersona: cierre.respuesta_tras_aviso.si_ya_respondio_persona,
    notaEnvio: config.business.pedido?.nota_envio_domicilio ?? null,
    textosDecision: { aceptado: cierre.textos.aceptado ?? null, rechazado: cierre.textos.rechazado ?? null, cancelado: cierre.textos.cancelado ?? null },
  };
}

/** Lector de la configuración por (negocio, número). Con la configuración inválida, sin fila o apagada => null. */
export type LectorConfigAceptacion = (tenantId: string, phoneNumberId: string) => Promise<ConfigAceptacion | null>;

export function crearLectorConfigAceptacion(store: AgentConfigStore): LectorConfigAceptacion {
  return async (tenantId, phoneNumberId) => {
    const r = await loadAgentConfig(store, { tenantId, phoneNumberId });
    return r.kind === "ok" ? leerConfigAceptacion(r.config) : null;
  };
}

/** ¿Esta persona puede aceptar o rechazar? (D7) El responsable y su respaldo; con "responsable_y_admins", también un admin. */
export function puedeDecidir(config: Pick<ConfigAceptacion, "responsable" | "aceptan">, persona: { miembroId: number; esAdmin: boolean }): boolean {
  if (persona.miembroId === config.responsable.miembro_id || persona.miembroId === config.responsable.respaldo_miembro_id) return true;
  return config.aceptan === "responsable_y_admins" && persona.esAdmin;
}

// ---------------------------------------------------------------------------
// Notificación a la persona responsable (abstracción por canal)
// ---------------------------------------------------------------------------

export const CANALES_RESPONSABLE = ["panel", "correo", "whatsapp"] as const;
export type CanalResponsable = (typeof CANALES_RESPONSABLE)[number];

export interface AvisoResponsable {
  tenantId: string;
  /** Número público del pedido (nunca el id interno). */
  pedido: string;
  responsable: MiembroEquipo;
  /** Determinista por pedido + canal: un canal con almacenamiento lo usa para no avisar dos veces. */
  clave: string;
}

/** Un canal de aviso. Idempotente por `clave`. Sin credenciales o destino reales no se registra (queda "no_configurado"). */
export interface CanalNotificador {
  enviar(aviso: AvisoResponsable): Promise<{ estado: "entregada" | "error" }>;
}

export interface NotificadorResponsableDeps {
  canales: Partial<Record<CanalResponsable, CanalNotificador>>;
}

export type ResultadoCanal = { canal: CanalResponsable; estado: "entregada" | "no_configurado" | "error" };

/**
 * Avisa a la persona responsable por cada canal configurado. Hoy solo existe el canal del panel: el aviso es
 * que la conversación queda asignada a la persona (Inbox, "pendiente") y el pedido aparece en "Por aceptar".
 * Correo y WhatsApp son parte del contrato, pero sin adaptador (sin correo, plantilla ni credenciales
 * reales) devuelven "no_configurado": no se inventa ningún destino y el pedido igual queda visible.
 * Un fallo de un canal nunca impide los demás ni deshace nada.
 */
export async function notificarResponsablePedido(
  deps: NotificadorResponsableDeps,
  input: { tenantId: string; order: Pick<Order, "id" | "orderId">; responsable: MiembroEquipo; canales: readonly CanalResponsable[] },
): Promise<ResultadoCanal[]> {
  const resultados: ResultadoCanal[] = [];
  for (const canal of [...new Set(input.canales)]) {
    const adaptador = deps.canales[canal];
    if (!adaptador) {
      resultados.push({ canal, estado: "no_configurado" });
      continue;
    }
    try {
      const r = await adaptador.enviar({ tenantId: input.tenantId, pedido: input.order.orderId, responsable: input.responsable, clave: eventIdFrom("aviso-responsable", input.order.id, canal) });
      resultados.push({ canal, estado: r.estado });
    } catch {
      resultados.push({ canal, estado: "error" });
    }
  }
  return resultados;
}

/** Canal del panel: no envía nada porque el panel LEE el estado (conversación asignada + lista "Por aceptar"). */
export const canalPanel: CanalNotificador = { enviar: async () => ({ estado: "entregada" }) };

// ---------------------------------------------------------------------------
// Asignación de la conversación a la persona responsable
// ---------------------------------------------------------------------------

export type EstadoAsignacion = "asignada" | "ya_asignada" | "de_otra_persona";

export interface AsignacionesStore {
  /**
   * Deja la conversación (número + cliente) asignada a `miembroId`:
   *   - sin asignar        => "asignada" (y UN evento "asignado" de la bitácora de la conversación);
   *   - ya de esa persona  => "ya_asignada" (sin evento: repetir no repite nada);
   *   - de OTRA persona    => "de_otra_persona" (NUNCA se le quita: un humano que ya la atiende manda).
   * El número debe ser del negocio: de otro negocio => lanza (fail-closed).
   */
  asignar(input: { tenantId: string; phoneNumberId: string; waId: string; miembroId: number; pedido: string }): Promise<{ estado: EstadoAsignacion; miembroActual: number | null }>;
}

export function createSupabaseAsignacionesStore(supabase: SupabaseClient): AsignacionesStore {
  return {
    async asignar({ tenantId, phoneNumberId, waId, miembroId, pedido }) {
      // El número debe pertenecer al negocio (las tablas de asignación se identifican por número + cliente).
      const dueno = await supabase.from("dulabs_clientes_config").select("phone_number_id").eq("phone_number_id", phoneNumberId).eq("id_tenant", tenantId).maybeSingle();
      if (dueno.error) throw new Error(`[aceptacion-humana] numero ${dueno.error.code ?? "?"}`);
      if (!dueno.data) throw new Error("[aceptacion-humana] el número no es de este negocio");
      const leer = () => supabase.from("dulabs_conversacion_asignaciones").select("id, miembro_id").eq("phone_number_id", phoneNumberId).eq("telefono_cliente", waId).maybeSingle();
      const actual = await leer();
      if (actual.error) throw new Error(`[aceptacion-humana] asignacion ${actual.error.code ?? "?"}`);
      const comparar = (fila: { miembro_id: number | string | null } | null): { estado: EstadoAsignacion; miembroActual: number | null } => {
        const m = fila?.miembro_id != null ? Number(fila.miembro_id) : null;
        return { estado: m === miembroId ? "ya_asignada" : "de_otra_persona", miembroActual: m };
      };
      let gano = false;
      if (!actual.data) {
        // Gana el primero (UNIQUE número + cliente): un reintento o una carrera se reconocen por el 23505.
        const ins = await supabase.from("dulabs_conversacion_asignaciones").insert({ phone_number_id: phoneNumberId, telefono_cliente: waId, miembro_id: miembroId, asignado_por: null });
        if (ins.error) {
          if (ins.error.code !== "23505") throw new Error(`[aceptacion-humana] asignar ${ins.error.code ?? "?"}`);
          const otra = await leer();
          return comparar(otra.data as { miembro_id: number | string | null } | null);
        }
        gano = true;
      } else if (actual.data.miembro_id == null) {
        const upd = await supabase.from("dulabs_conversacion_asignaciones").update({ miembro_id: miembroId, asignado_por: null, updated_at: new Date().toISOString() }).eq("id", actual.data.id).is("miembro_id", null).select("id");
        if (upd.error) throw new Error(`[aceptacion-humana] asignar ${upd.error.code ?? "?"}`);
        if ((upd.data ?? []).length === 0) return comparar((await leer()).data as { miembro_id: number | string | null } | null);
        gano = true;
      } else {
        return comparar(actual.data as { miembro_id: number | string | null });
      }
      if (gano) {
        // Evento de la bitácora de la conversación: UNO por asignación real (misma bitácora del Inbox).
        const ev = await supabase.from("dulabs_conversacion_eventos").insert({
          phone_number_id: phoneNumberId,
          telefono_cliente: waId,
          tipo: "asignado",
          miembro_id: miembroId,
          detalle: { motivo: "pedido_pendiente_de_aceptacion", pedido, automatico: true, miembro_id_destino: miembroId },
        });
        if (ev.error) console.error("[aceptacion-humana] evento de asignación:", ev.error.code ?? "?");
      }
      return { estado: "asignada", miembroActual: miembroId };
    },
  };
}

export interface EventoAsignacionMemoria {
  phoneNumberId: string;
  waId: string;
  tipo: "asignado";
  miembroId: number;
  detalle: Record<string, unknown>;
}

/** Igual que la tabla: una fila por (número, cliente) y una bitácora de eventos. `numeros`: número -> negocio. */
export function createMemoryAsignacionesStore(numeros: Record<string, string>): AsignacionesStore & { filas: Map<string, number | null>; eventos: EventoAsignacionMemoria[] } {
  const filas = new Map<string, number | null>();
  const eventos: EventoAsignacionMemoria[] = [];
  return {
    filas,
    eventos,
    async asignar({ tenantId, phoneNumberId, waId, miembroId, pedido }) {
      if (numeros[phoneNumberId] !== tenantId) throw new Error("[aceptacion-humana] el número no es de este negocio");
      const k = `${phoneNumberId}|${waId}`;
      if (filas.has(k) && filas.get(k) !== null) {
        const m = filas.get(k) as number;
        return { estado: m === miembroId ? "ya_asignada" : "de_otra_persona", miembroActual: m };
      }
      filas.set(k, miembroId);
      eventos.push({ phoneNumberId, waId, tipo: "asignado", miembroId, detalle: { motivo: "pedido_pendiente_de_aceptacion", pedido, automatico: true, miembro_id_destino: miembroId } });
      return { estado: "asignada", miembroActual: miembroId };
    },
  };
}

// ---------------------------------------------------------------------------
// El enrutador (lo que el motor invoca al enviar un pedido a aceptación)
// ---------------------------------------------------------------------------

export type CodigoSinResponsable = "sin_configuracion" | ResponsableError;

export interface EnrutadorAceptacionDeps {
  config: LectorConfigAceptacion;
  miembros: MiembrosStore;
  asignaciones: AsignacionesStore;
  notificador: NotificadorResponsableDeps;
  /** Pausa de la IA en esa conversación (mecanismo existente; nunca acorta una pausa humana más larga). */
  handoff?: HumanHandoffPort;
  /** Registro SIN datos personales (ni teléfono, ni documento, ni texto del cliente). */
  log?: (entry: Record<string, unknown>) => void;
}

const logPorDefecto = (entry: Record<string, unknown>) => console.info(JSON.stringify({ log: "acceptance_routing", ...entry }));

export function createAcceptanceRouter(deps: EnrutadorAceptacionDeps): AcceptanceRouter {
  const log = deps.log ?? logPorDefecto;
  const resolver = async (tenantId: string, phoneNumberId: string) => {
    const cfg = await deps.config(tenantId, phoneNumberId);
    if (!cfg) return { ok: false as const, code: "sin_configuracion" as CodigoSinResponsable };
    const r = await verificarResponsable(deps.miembros, tenantId, cfg.responsable);
    return r.ok ? { ok: true as const, cfg, miembro: r.miembro } : { ok: false as const, code: r.error as CodigoSinResponsable };
  };
  return {
    async check({ tenantId, contact }) {
      const r = await resolver(tenantId, contact.phoneNumberId).catch(() => ({ ok: false as const, code: "sin_configuracion" as CodigoSinResponsable }));
      if (!r.ok) log({ business_id: tenantId, fase: "check", resultado: "bloqueado", motivo: r.code });
      return r.ok ? { ok: true } : { ok: false, code: r.code };
    },
    async route({ tenantId, order }) {
      if (!order.contact || order.businessId !== tenantId) throw new Error("[aceptacion-humana] pedido sin conversación o de otro negocio");
      const contact = order.contact;
      // Los pasos son INDEPENDIENTES: que uno falle nunca salta los demás (sobre todo, la IA SIEMPRE queda en
      // silencio). Al final, si algo falló, se lanza para dejar constancia y el reintento lo repara.
      const fallos: string[] = [];
      let asignacion: EstadoAsignacion | null = null;
      let avisos: ResultadoCanal[] = [];
      // 1) Persona responsable (del MISMO negocio y activa) -> asignación -> aviso por los canales configurados.
      try {
        const r = await resolver(tenantId, contact.phoneNumberId);
        if (!r.ok) {
          fallos.push(`sin_responsable:${r.code}`);
        } else {
          try {
            // Idempotente; no le quita la conversación a otra persona que ya la tenga.
            asignacion = (await deps.asignaciones.asignar({ tenantId, phoneNumberId: contact.phoneNumberId, waId: contact.waId, miembroId: r.miembro.id, pedido: order.orderId })).estado;
          } catch {
            fallos.push("asignacion");
          }
          try {
            avisos = await notificarResponsablePedido(deps.notificador, { tenantId, order, responsable: r.miembro, canales: r.cfg.responsable.canales });
          } catch {
            fallos.push("aviso");
          }
        }
      } catch {
        fallos.push("responsable_ilegible");
      }
      // 2) La IA calla en esa conversación hasta que una persona la libere (la pausa nunca se acorta). Pase lo que pase arriba.
      const pausa = deps.handoff ? await deps.handoff.pauseConversation({ tenantId, contact, reason: "pedido pendiente de aceptación", until: "released" }).catch(() => ({ ok: false })) : { ok: false };
      if (!pausa.ok) fallos.push("pausa");
      log({ business_id: tenantId, order_id: order.orderId, fase: "route", resultado: fallos.length === 0 ? "ok" : "con_fallos", fallos, asignacion, avisos, pausa: pausa.ok });
      if (fallos.length > 0) throw new Error(`[aceptacion-humana] ${fallos.join(",")}`);
    },
  };
}
