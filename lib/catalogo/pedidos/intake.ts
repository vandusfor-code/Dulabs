/**
 * ENTRADA de pedidos por WhatsApp — se llama desde el webhook EXISTENTE
 * (app/webhook-dulabs/route.ts → procesarCambio), no hay webhook nuevo.
 *
 * Cadena de resolución (nunca por nombre del negocio, nunca "el primero"):
 *
 *   WABA (entry.id) ─► phone_number_id (metadata, UNIQUE en dulabs_clientes_config)
 *     ─► tenant (id_tenant de esa fila) ─► contacto (wa_id del remitente)
 *     ─► conversación (phone_number_id + wa_id) ─► pedido
 *
 * El webhook ya resolvió el negocio por phone_number_id. Aquí además:
 *   - si Meta envió el WABA y no coincide con el del negocio => se ignora
 *     (payload inconsistente; no se registra nada);
 *   - solo texto de clientes (los ecos del dueño y los estados no llegan aquí);
 *   - solo si el negocio tiene el módulo Catálogo y la migración de pedidos;
 *   - solo si el texto ES un pedido del catálogo (líneas con referencia o
 *     "Solicitud: DL-ORD-…"): cualquier otro mensaje sigue su camino normal
 *     (IA, Flow, Business Agent) sin que esto cambie nada.
 *
 * Registra y devuelve una respuesta ESTRUCTURADA (pedido + siguiente paso).
 * En esta fase NO responde por WhatsApp: la IA/asesora conversa y consulta
 * el pedido con las herramientas. Nunca lanza (no puede romper el webhook).
 */
import { randomUUID } from "node:crypto";
import { publicView, type OrderPublicView } from "@/lib/catalogo/pedidos/contrato";
import { contactRef, logOrderOperation, type OrderLogger } from "@/lib/catalogo/pedidos/log";
import { OrderError, nextStepOf, type NextStep, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { parseWhatsappOrderText } from "@/lib/catalogo/pedidos/whatsapp";

/** Lo mínimo del negocio que resolvió el webhook (fila de dulabs_clientes_config). */
export interface IntakeBusiness {
  id_tenant: string;
  phone_number_id: string;
  whatsapp_business_account_id: string | null;
}

export interface IntakeMessage {
  /** wamid: único por mensaje en Meta (idempotencia; nunca el timestamp). */
  id: string;
  type: string;
  text?: { body?: string } | null;
}

export interface IntakeDeps {
  engine: OrderEngine;
  isModuleEnabled: (tenantId: string) => Promise<boolean>;
  log?: OrderLogger;
}

export type IntakeResult =
  | { status: "skipped"; reason: "not_text" | "not_an_order" | "waba_mismatch" | "module_disabled" | "orders_unavailable" | "blocked" }
  | { status: "created" | "claimed" | "duplicate"; order: OrderPublicView; next_step: NextStep }
  | { status: "error"; code: string };

export async function recibirPedidoWhatsapp(
  input: { business: IntakeBusiness; wabaId?: string | null; message: IntakeMessage; waId: string; blocked?: boolean },
  deps: IntakeDeps,
): Promise<IntakeResult> {
  const log = deps.log ?? logOrderOperation;
  const started = Date.now();
  const requestId = randomUUID();
  const note = (result: IntakeResult) => {
    log({
      request_id: requestId,
      business_id: input.business.id_tenant,
      operation: "whatsapp_intake",
      result: result.status === "error" ? "error" : result.status === "skipped" ? "skipped" : result.status === "duplicate" ? "duplicate" : "ok",
      duration_ms: Date.now() - started,
      contact_ref: contactRef(input.waId),
      ...(result.status === "error" ? { error_code: result.code } : {}),
      ...(result.status === "skipped" ? { reason: result.reason } : {}),
      ...("order" in result ? { order_id: result.order.order_id, status: result.order.status } : {}),
    });
    return result;
  };

  const body = input.message.type === "text" ? input.message.text?.body : undefined;
  if (!body) return { status: "skipped", reason: "not_text" };
  // Filtro barato y sin BD: la inmensa mayoría de los mensajes no son pedidos.
  if (!parseWhatsappOrderText(body)) return { status: "skipped", reason: "not_an_order" };

  try {
    if (input.blocked) return note({ status: "skipped", reason: "blocked" });
    const wabaNegocio = input.business.whatsapp_business_account_id?.trim();
    if (input.wabaId && wabaNegocio && input.wabaId !== wabaNegocio) return note({ status: "skipped", reason: "waba_mismatch" });
    if (!(await deps.isModuleEnabled(input.business.id_tenant))) return note({ status: "skipped", reason: "module_disabled" });
    if (!(await deps.engine.available())) return note({ status: "skipped", reason: "orders_unavailable" });

    const r = await deps.engine.receiveWhatsappOrder({
      tenantId: input.business.id_tenant,
      contact: { phoneNumberId: input.business.phone_number_id, waId: input.waId },
      messageId: input.message.id,
      text: body,
      requestId,
    });
    if (r.kind === "not_an_order") return note({ status: "skipped", reason: "not_an_order" });
    return note({ status: r.kind, order: publicView(r.order), next_step: nextStepOf(r.order) });
  } catch (err) {
    const code = err instanceof OrderError ? err.code : "INTERNAL";
    if (code === "INTERNAL") console.error("[catalogo/pedidos] error registrando pedido de WhatsApp:", err instanceof Error ? err.message : err);
    return note({ status: "error", code });
  }
}
