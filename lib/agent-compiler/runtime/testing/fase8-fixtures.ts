// Business Agent 2.0, FASE 8 — fixtures y puertos en memoria para los tests de paridad.
//
// Los puertos en memoria reproducen el CONTRATO de los reales (mismas reglas que la migración 20261127000000 para
// recordatorios; mismo aislamiento por tenant para contactos; mismo inventario por tenant). Nada aquí se usa en
// producción.

import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { barberSpec, storeSpec } from "@/lib/agent-compiler/conversation/testing/harness";
import type { InventoryProduct, ProductInventoryPort } from "@/lib/agent-compiler/actions/native/products";
import type { LeadContactPort, LeadRecord } from "@/lib/agent-compiler/actions/native/leads";
import type { DueReminder, ReminderStore, ScheduleOutcome } from "@/lib/agent-compiler/actions/native/reminders";

/** Barbería del brief: agenda (Nylas), traspaso, interesados y recordatorios; Barbero 1 / Barbero 2; motor conversacional. */
export function barberia8Spec(): BusinessAgentSpec {
  const s = barberSpec();
  s.identity.businessName = "Barbería Centro";
  s.capabilities = { ...s.capabilities, faq: false, catalog: false, sales: false, humanHandoff: true, scheduling: true, leadCapture: true };
  s.runtime = {
    engine: "state_machine_v1",
    tone: "cercano",
    reminders: { enabled: true, offsetMinutes: 60 },
    resources: [
      { id: "barbero-1", name: "Barbero 1", kind: "staff" },
      { id: "barbero-2", name: "Barbero 2", kind: "staff" },
    ],
    leadCapture: { fieldKeys: ["nombreCliente"], captureInterest: true },
  };
  return s;
}

export const BARBERIA_SERVICES = [
  { name: "Corte", durationMinutes: 30, price: 25_000 },
  { name: "Corte + barba", durationMinutes: 45, price: 35_000 },
];

/** Tienda del brief: catálogo de PRODUCTOS (inventario real), sin agenda; motor conversacional. */
export function tienda8Spec(): BusinessAgentSpec {
  const s = storeSpec();
  s.identity.businessName = "Tienda Sol";
  s.capabilities = { ...s.capabilities, catalog: true, sales: false, faq: false, humanHandoff: true };
  s.catalog = { ...s.catalog, useServices: false, useProducts: true };
  s.runtime = { engine: "state_machine_v1", tone: "cercano" };
  return s;
}

export const TIENDA_PRODUCTS: InventoryProduct[] = [
  { name: "Camisa negra", price: 80_000, stock: 5 },
  { name: "Camisa negra talla M", price: 80_000, stock: 2 },
  { name: "Camisa blanca", price: 75_000, stock: 0 },
  { name: "Pantalón azul", price: 120_000 },
];

export function memoryInventory(byTenant: Record<string, InventoryProduct[]>): ProductInventoryPort & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async list(tenantId) {
      reads.push(tenantId);
      return (byTenant[tenantId] ?? []).map((p) => ({ ...p }));
    },
  };
}

export function memoryLeads(owners: Record<string, string> = {}): LeadContactPort & { saved: LeadRecord[] } {
  const saved: LeadRecord[] = [];
  return {
    saved,
    async save(lead) {
      const owner = owners[lead.phoneNumberId];
      if (owner && owner !== lead.tenantId) throw new Error("lead_tenant_mismatch");
      saved.push(lead);
      return { saved: Object.keys(lead.fields).length };
    },
  };
}

interface Row {
  id: string;
  tenantId: string;
  agentId: string;
  conversationId: string;
  phoneNumberId: string;
  telefonoCliente: string;
  anchorRef: string;
  appointmentStart: string;
  remindAt: string;
  message: string;
  key: string;
  status: "scheduled" | "sending" | "sent" | "cancelled" | "failed" | "unknown";
  attempts: number;
  leaseUntil: number | null;
  lastError: string | null;
}

/** Recordatorios en memoria con las MISMAS reglas que las funciones de Postgres (ver el test SQL de la migración). */
export function memoryReminders(now: () => number): ReminderStore & { rows: Row[] } {
  const rows: Row[] = [];
  let seq = 0;
  return {
    rows,
    async schedule(i) {
      const at = Date.parse(i.remindAt);
      if (at >= Date.parse(i.appointmentStart)) return { outcome: "after_appointment", remindAt: i.remindAt };
      if (at < now() - 60_000) return { outcome: "in_past", remindAt: i.remindAt };
      const active = rows.find((r) => r.tenantId === i.tenantId && r.conversationId === i.conversationId && r.anchorRef === i.anchorRef && (r.status === "scheduled" || r.status === "sending"));
      if (active) {
        if (active.status === "sending") return { outcome: "already_sending", remindAt: active.remindAt };
        if (active.remindAt === i.remindAt && active.appointmentStart === i.appointmentStart) return { outcome: "unchanged", remindAt: active.remindAt };
        active.remindAt = i.remindAt;
        active.appointmentStart = i.appointmentStart;
        active.message = i.message;
        return { outcome: "updated", remindAt: active.remindAt };
      }
      const byKey = rows.find((r) => r.tenantId === i.tenantId && r.key === i.idempotencyKey);
      if (byKey) return { outcome: `closed_${byKey.status}` as ScheduleOutcome, remindAt: byKey.remindAt };
      rows.push({ id: `rem-${++seq}`, tenantId: i.tenantId, agentId: i.agentId, conversationId: i.conversationId, phoneNumberId: i.phoneNumberId, telefonoCliente: i.telefonoCliente, anchorRef: i.anchorRef, appointmentStart: i.appointmentStart, remindAt: i.remindAt, message: i.message, key: i.idempotencyKey, status: "scheduled", attempts: 0, leaseUntil: null, lastError: null });
      return { outcome: "scheduled", remindAt: i.remindAt };
    },
    async cancel(tenantId, conversationId, anchor) {
      let n = 0;
      for (const r of rows) {
        if (r.tenantId === tenantId && r.conversationId === conversationId && r.status === "scheduled" && (!anchor || r.anchorRef === anchor)) {
          r.status = "cancelled";
          n++;
        }
      }
      return n;
    },
    async reschedule(tenantId, conversationId, anchor, newStart, offset) {
      let n = 0;
      const at = new Date(Date.parse(newStart) - offset * 60_000).toISOString();
      for (const r of rows) {
        if (r.tenantId === tenantId && r.conversationId === conversationId && r.status === "scheduled" && (!anchor || r.anchorRef === anchor) && Date.parse(at) > now()) {
          r.appointmentStart = newStart;
          r.remindAt = at;
          n++;
        }
      }
      return n;
    },
    async claimDue(limit, leaseSeconds) {
      for (const r of rows) {
        if (r.status === "sending" && r.leaseUntil !== null && r.leaseUntil < now()) {
          r.status = "unknown";
          r.lastError = "OUTCOME_UNKNOWN";
          r.leaseUntil = null;
        }
      }
      const due = rows.filter((r) => r.status === "scheduled" && Date.parse(r.remindAt) <= now() && r.attempts < 10).slice(0, limit);
      for (const r of due) {
        r.status = "sending";
        r.attempts++;
        r.leaseUntil = now() + leaseSeconds * 1000;
      }
      return due.map((r): DueReminder => ({ id: r.id, tenantId: r.tenantId, agentId: r.agentId, conversationId: r.conversationId, phoneNumberId: r.phoneNumberId, telefonoCliente: r.telefonoCliente, appointmentStart: r.appointmentStart, remindAt: r.remindAt, message: r.message, attempts: r.attempts }));
    },
    async complete(i) {
      const r = rows.find((x) => x.id === i.id && x.tenantId === i.tenantId && x.status === "sending" && x.attempts === i.attempts);
      if (!r) return false;
      r.leaseUntil = null;
      r.lastError = i.error;
      if (i.status === "retry") {
        const retryAt = i.retryAt ? Date.parse(i.retryAt) : now();
        if (retryAt >= Date.parse(r.appointmentStart)) r.status = "failed";
        else {
          r.status = "scheduled";
          r.remindAt = new Date(retryAt).toISOString();
        }
        return true;
      }
      r.status = i.status;
      return true;
    },
  };
}
