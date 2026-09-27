// DuLabs Business — Business Agent 2.0, FASE 8 — handler de las acciones NATIVAS del Business Agent.
//
// Mismo contrato que el executor interno (EffectDispatchRequest → EffectDispatchResult) para que el Action Engine las
// trate igual: validación, autorización por artefacto, idempotencia (claim en Postgres), timeout y ActionResult. El
// tenant sale SIEMPRE de request.tenantId (contexto del servidor) y la conversación de request.conversation; nada del
// modelo. La configuración (moneda, datos del lead, anticipación, zona, tono) viene de los params compilados.

import type { EffectDispatchRequest, EffectDispatchResult } from "@/lib/flow/executor-types";
import type { ActionHandler } from "@/lib/agent-compiler/actions/engine";
import { resolveProduct, type ProductInventoryPort } from "@/lib/agent-compiler/actions/native/products";
import { leadFieldsToSave, type LeadContactPort } from "@/lib/agent-compiler/actions/native/leads";
import { computeReminderAt, type ReminderStore } from "@/lib/agent-compiler/actions/native/reminders";
import { phrasebook } from "@/lib/agent-compiler/conversation/phrasebook";
import { formatInstant } from "@/lib/agent-compiler/conversation/renderer";

export interface NativeActionDeps {
  products?: ProductInventoryPort;
  leads?: LeadContactPort;
  reminders?: ReminderStore;
  clock?: () => Date;
}

const ok = (data: Record<string, unknown>): EffectDispatchResult => ({ success: true, classification: "SUCCESS", data });
const fail = (classification: EffectDispatchResult["classification"], error: string): EffectDispatchResult => ({ success: false, classification, error });

function params(req: EffectDispatchRequest): Record<string, string> {
  const p = (req.action as { params?: Record<string, unknown> } | undefined)?.params ?? {};
  return Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === "string")) as Record<string, string>;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function createNativeActionHandler(deps: NativeActionDeps): ActionHandler {
  const clock = deps.clock ?? (() => new Date());
  return async (req) => {
    const action = req.action?.actionType as string | undefined;
    const cfg = params(req);
    const conv = req.conversation;
    switch (action) {
      case "ba_consultar_producto": {
        if (!deps.products) return fail("NON_RETRYABLE", "inventario_no_configurado");
        const query = str(req.payload.producto);
        if (!query) return fail("VALIDATION_ERROR", "sin_producto");
        let list;
        try {
          list = await deps.products.list(req.tenantId);
        } catch {
          return fail("RETRYABLE", "inventario_no_disponible");
        }
        const r = resolveProduct(query, list, str(req.payload.contexto));
        const base = { consulta: r.query.slice(0, 200), coincidencia: r.kind, moneda: cfg.moneda ?? null };
        switch (r.kind) {
          case "ambiguous":
            return ok({ ...base, resultado: "ambiguo", opciones: r.options ?? [] });
          case "not_found":
            return ok({ ...base, resultado: "no_encontrado" });
          case "out_of_stock":
            return ok({ ...base, resultado: "agotado", productoNombre: r.product!.name, precio: r.product!.price, stock: 0, controlaStock: true });
          default:
            return ok({
              ...base,
              resultado: "encontrado",
              productoNombre: r.product!.name,
              precio: r.product!.price,
              stock: typeof r.product!.stock === "number" ? r.product!.stock : null,
              controlaStock: typeof r.product!.stock === "number",
            });
        }
      }
      case "ba_guardar_lead": {
        if (!deps.leads) return fail("NON_RETRYABLE", "contacto_no_configurado");
        if (!conv) return fail("VALIDATION_ERROR", "conversation_required");
        const keys = (cfg.fieldKeys ?? "").split(",").map((k) => k.trim()).filter(Boolean);
        const fields = leadFieldsToSave(req.payload, keys);
        if (Object.keys(fields).length === 0) return fail("VALIDATION_ERROR", "sin_datos");
        try {
          const r = await deps.leads.save({
            tenantId: req.tenantId,
            phoneNumberId: conv.phoneNumberId,
            telefonoCliente: conv.telefonoCliente,
            fields,
            interest: cfg.captureInterest === "true" ? (str(req.payload.interes)?.slice(0, 200) ?? null) : null,
            capturedAt: clock().toISOString(),
          });
          return ok({ leadGuardado: true, camposGuardados: r.saved });
        } catch (e) {
          return fail(e instanceof Error && e.message === "lead_tenant_mismatch" ? "SECURITY_REJECTED" : "RETRYABLE", e instanceof Error && e.message === "lead_tenant_mismatch" ? "tenant_mismatch" : "contacto_no_disponible");
        }
      }
      case "ba_programar_recordatorio": {
        if (!deps.reminders) return fail("NON_RETRYABLE", "recordatorios_no_configurados");
        if (!conv) return fail("VALIDATION_ERROR", "conversation_required");
        const start = str(req.payload.citaInicio);
        const anchor = str(req.payload.citaRef);
        if (!start || !anchor) return fail("NON_RETRYABLE", "sin_cita");
        const tz = cfg.timezone ?? "America/Bogota";
        const offset = Number(cfg.offsetMinutes ?? "60");
        const at = computeReminderAt({ appointmentStart: start, offsetMinutes: offset, date: str(req.payload.fecha), time: str(req.payload.hora), timeZone: tz, now: clock() });
        if (!at.ok) return fail("VALIDATION_ERROR", at.reason === "invalid_input" ? "momento_invalido:entrada" : `momento_invalido:${at.reason}`);
        const service = str(req.payload.citaServicio) ?? null;
        // Tono: el del paso (presentación publicada); `cfg.tone` solo por compatibilidad con artefactos de FASE 8.
        const tone = str(req.payload.tono) ?? cfg.tone;
        const message = phrasebook(tone).reminderMessage(service, formatInstant(start, tz)).slice(0, 500);
        const key = req.effectId.split(":")[0]!;
        try {
          const r = await deps.reminders.schedule({
            tenantId: req.tenantId,
            agentId: str(req.payload.agentId) ?? "unknown",
            conversationId: `${conv.phoneNumberId}:${conv.telefonoCliente}`,
            phoneNumberId: conv.phoneNumberId,
            telefonoCliente: conv.telefonoCliente,
            anchorRef: anchor,
            appointmentStart: start,
            service,
            remindAt: at.remindAt,
            timezone: tz,
            message,
            idempotencyKey: /^[a-f0-9]{32}$/.test(key) ? key : "0".repeat(32),
            tone: tone ?? null,
          });
          if (r.outcome === "after_appointment" || r.outcome === "in_past") return fail("VALIDATION_ERROR", `momento_invalido:${r.outcome}`);
          if (r.outcome === "already_sending" || r.outcome.startsWith("closed_")) return fail("NON_RETRYABLE", "recordatorio_cerrado");
          return ok({ programado: true, recordatorioEn: r.remindAt, citaInicio: start, actualizado: r.outcome === "updated" });
        } catch {
          return fail("RETRYABLE", "recordatorios_no_disponibles");
        }
      }
      default:
        return fail("NON_RETRYABLE", "accion_nativa_desconocida");
    }
  };
}
