/**
 * Bloque 25 — CAMBIO DE MODALIDAD (detal <-> por mayor) de un cliente, hecho por una asesora.
 *
 * Nunca silencioso: lo pide una persona del equipo que atiende (admin / agente) desde el panel, con
 * un motivo; el backend exige que la modalidad actual sea la que ella vio (compare-and-set) y deja
 * el evento en la bitácora inmutable (quién, cuándo, de qué a qué, por qué).
 *
 * Qué pasa con lo que ya existe: los pedidos abiertos CONSERVAN su canal y sus precios (nada se
 * recalcula en silencio). El siguiente mensaje del cliente ya cotiza con la modalidad nueva; si tiene
 * un pedido abierto de la otra modalidad, el agente no lo propone ni lo confirma y lo pasa a una
 * asesora (que lo cancela o lo cierra). El carrito de la conversación guarda solo referencias y
 * cantidades: su precio siempre se calcula de nuevo con la modalidad vigente.
 */
import { z } from "zod";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import type { CustomerChannelStore } from "@/lib/agente/clasificacion";

const canal = z.enum(["retail", "wholesale"]);
export const cambioCanalSchema = z
  .object({
    numero: z.string().trim().min(1).max(64),
    telefono: z.string().regex(/^[0-9]{6,20}$/),
    canal,
    /** La modalidad que la asesora vio en pantalla (null = sin clasificar). */
    canal_actual: canal.nullable(),
    motivo: z.string().trim().min(3).max(300),
  })
  .strict();

export interface CambioCanalDeps {
  store: CustomerChannelStore;
  /** ¿El número es de ESTE negocio? (nunca se toca un contacto de otro negocio). */
  numeroDelNegocio(tenantId: string, phoneNumberId: string): Promise<boolean>;
}

const ETIQUETA = { retail: "al detal", wholesale: "al por mayor" } as const;

export async function cambiarCanalCliente(deps: CambioCanalDeps, sesion: { tenantId: string; memberId: number }, body: unknown): Promise<Response> {
  const parsed = cambioCanalSchema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Datos inválidos: número, teléfono, modalidad, modalidad actual y motivo (3 a 300 caracteres).", 400);
  const b = parsed.data;
  try {
    if (!(await deps.numeroDelNegocio(sesion.tenantId, b.numero))) return apiError("NOT_FOUND", "No encontramos ese cliente.", 404);
    const r = await deps.store.change(
      { tenantId: sesion.tenantId, phoneNumberId: b.numero, waId: b.telefono },
      { channel: b.canal, expected: b.canal_actual, memberId: sesion.memberId, reason: b.motivo },
    );
    if (r.result === "conflicto") {
      const ahora = r.channel ? ETIQUETA[r.channel] : "sin clasificar";
      return apiError("CONFLICT", `La modalidad de este cliente cambió mientras tanto (ahora: ${ahora}). Actualiza y vuelve a intentar.`, 409);
    }
    return apiOk({ resultado: r.result, canal: r.channel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "?";
    if (msg.includes("42501")) return apiError("FORBIDDEN", "No puedes cambiar la modalidad de este cliente.", 403);
    console.error("[catalogo/clientes-canal]", msg);
    return apiError("INTERNAL_ERROR", "No se pudo cambiar la modalidad. Intenta de nuevo.", 500);
  }
}
