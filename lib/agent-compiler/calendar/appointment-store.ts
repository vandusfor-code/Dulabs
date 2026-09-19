// DuLabs Business — Agent Compiler, R7 — registro de citas del Business Agent.
//
// Índice "de quién es cada evento del calendario" (tabla dulabs_ba_appointments). Es lo que permite
// cancelar/reprogramar SIN que la IA elija ids: el backend lista las citas del (tenant, teléfono del
// canal) y opera solo sobre esas.
//
// INVARIANTES (los cumplen las dos implementaciones y los tests):
//   - tenantId viene del contexto confiable (request.tenantId); telefono, de la conversación (canal).
//   - TODA operación filtra por (tenantId, telefono): una persona solo ve/toca SUS citas y un tenant
//     nunca las de otro.
//   - cancelar/mover son idempotentes (repetir no duplica ni rompe).

import type { SupabaseClient } from "@supabase/supabase-js";

export type AppointmentState = "confirmada" | "cancelada";

export interface AgentAppointment {
  id: string;
  tenantId: string;
  telefonoCliente: string;
  calendarId: string;
  eventId: string;
  servicio: string | null;
  nombreCliente: string | null;
  inicioIso: string;
  finIso: string;
  estado: AppointmentState;
  reprogramaciones: number;
}

export interface RecordAppointmentInput {
  tenantId: string;
  telefonoCliente: string;
  calendarId: string;
  eventId: string;
  servicio?: string | null;
  nombreCliente?: string | null;
  inicioIso: string;
  finIso: string;
}

export type CancelOutcome = "cancelada" | "ya_cancelada" | "no_encontrada";

export interface AppointmentStore {
  /** Registra la cita (idempotente por tenant+evento: un replay no duplica). */
  record(input: RecordAppointmentInput): Promise<void>;
  /** Citas CONFIRMADAS y futuras de esta persona en este negocio, ordenadas por inicio (máx. `limit`). */
  listUpcoming(tenantId: string, telefono: string, nowIso: string, limit: number): Promise<AgentAppointment[]>;
  /** Marca cancelada la cita (solo si pertenece a tenant+teléfono). */
  markCancelled(tenantId: string, telefono: string, id: string, nowIso: string): Promise<CancelOutcome>;
  /** Cambia evento y horario de la cita (solo si pertenece a tenant+teléfono y está confirmada). */
  markRescheduled(tenantId: string, telefono: string, id: string, next: { eventId: string; inicioIso: string; finIso: string }): Promise<boolean>;
}

const TABLE = "dulabs_ba_appointments";
const COLUMNS = "id, id_tenant, telefono_cliente, calendar_id, event_id, servicio, nombre_cliente, inicio, fin, estado, reprogramaciones";

interface AppointmentRow {
  id: string;
  id_tenant: string;
  telefono_cliente: string;
  calendar_id: string;
  event_id: string;
  servicio: string | null;
  nombre_cliente: string | null;
  inicio: string;
  fin: string;
  estado: AppointmentState;
  reprogramaciones: number;
}

function rowToAppointment(r: AppointmentRow): AgentAppointment {
  return {
    id: r.id,
    tenantId: r.id_tenant,
    telefonoCliente: r.telefono_cliente,
    calendarId: r.calendar_id,
    eventId: r.event_id,
    servicio: r.servicio,
    nombreCliente: r.nombre_cliente,
    inicioIso: new Date(r.inicio).toISOString(),
    finIso: new Date(r.fin).toISOString(),
    estado: r.estado,
    reprogramaciones: r.reprogramaciones,
  };
}

export function createSupabaseAppointmentStore(supabase: SupabaseClient): AppointmentStore {
  return {
    async record(i) {
      const { error } = await supabase.from(TABLE).upsert(
        {
          id_tenant: i.tenantId,
          telefono_cliente: i.telefonoCliente,
          calendar_id: i.calendarId,
          event_id: i.eventId,
          servicio: i.servicio ?? null,
          nombre_cliente: i.nombreCliente ?? null,
          inicio: i.inicioIso,
          fin: i.finIso,
        },
        { onConflict: "id_tenant,event_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    },

    async listUpcoming(tenantId, telefono, nowIso, limit) {
      const { data, error } = await supabase
        .from(TABLE)
        .select(COLUMNS)
        .eq("id_tenant", tenantId)
        .eq("telefono_cliente", telefono)
        .eq("estado", "confirmada")
        .gt("inicio", nowIso)
        .order("inicio", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return ((data ?? []) as AppointmentRow[]).map(rowToAppointment);
    },

    async markCancelled(tenantId, telefono, id, nowIso) {
      const { data, error } = await supabase
        .from(TABLE)
        .update({ estado: "cancelada", cancelled_at: nowIso })
        .eq("id", id)
        .eq("id_tenant", tenantId)
        .eq("telefono_cliente", telefono)
        .eq("estado", "confirmada")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (data) return "cancelada";
      // No se actualizó: ¿ya estaba cancelada (idempotencia) o no es de esta persona/negocio?
      const { data: existente, error: e2 } = await supabase
        .from(TABLE)
        .select("estado")
        .eq("id", id)
        .eq("id_tenant", tenantId)
        .eq("telefono_cliente", telefono)
        .maybeSingle();
      if (e2) throw e2;
      return existente && (existente as { estado: AppointmentState }).estado === "cancelada" ? "ya_cancelada" : "no_encontrada";
    },

    async markRescheduled(tenantId, telefono, id, next) {
      // reprogramaciones + 1: lectura previa (el volumen es mínimo; la fila ya está acotada por tenant+teléfono).
      const { data: actual, error: e1 } = await supabase
        .from(TABLE)
        .select("reprogramaciones")
        .eq("id", id)
        .eq("id_tenant", tenantId)
        .eq("telefono_cliente", telefono)
        .eq("estado", "confirmada")
        .maybeSingle();
      if (e1) throw e1;
      if (!actual) return false;
      const { data, error } = await supabase
        .from(TABLE)
        .update({ event_id: next.eventId, inicio: next.inicioIso, fin: next.finIso, reprogramaciones: (actual as { reprogramaciones: number }).reprogramaciones + 1 })
        .eq("id", id)
        .eq("id_tenant", tenantId)
        .eq("telefono_cliente", telefono)
        .eq("estado", "confirmada")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  };
}

/** Store en memoria (tests): mismo contrato y mismos invariantes que el real. */
export function createInMemoryAppointmentStore(): AppointmentStore & { all(): AgentAppointment[] } {
  const filas: AgentAppointment[] = [];
  let seq = 0;
  const propia = (a: AgentAppointment, tenantId: string, telefono: string) => a.tenantId === tenantId && a.telefonoCliente === telefono;
  return {
    all: () => filas.map((f) => ({ ...f })),
    async record(i) {
      if (filas.some((f) => f.tenantId === i.tenantId && f.eventId === i.eventId)) return;
      filas.push({
        id: `appt-${++seq}`,
        tenantId: i.tenantId,
        telefonoCliente: i.telefonoCliente,
        calendarId: i.calendarId,
        eventId: i.eventId,
        servicio: i.servicio ?? null,
        nombreCliente: i.nombreCliente ?? null,
        inicioIso: i.inicioIso,
        finIso: i.finIso,
        estado: "confirmada",
        reprogramaciones: 0,
      });
    },
    async listUpcoming(tenantId, telefono, nowIso, limit) {
      return filas
        .filter((f) => propia(f, tenantId, telefono) && f.estado === "confirmada" && f.inicioIso > nowIso)
        .sort((a, b) => a.inicioIso.localeCompare(b.inicioIso))
        .slice(0, limit)
        .map((f) => ({ ...f }));
    },
    async markCancelled(tenantId, telefono, id) {
      const f = filas.find((x) => x.id === id && propia(x, tenantId, telefono));
      if (!f) return "no_encontrada";
      if (f.estado === "cancelada") return "ya_cancelada";
      f.estado = "cancelada";
      return "cancelada";
    },
    async markRescheduled(tenantId, telefono, id, next) {
      const f = filas.find((x) => x.id === id && propia(x, tenantId, telefono) && x.estado === "confirmada");
      if (!f) return false;
      f.eventId = next.eventId;
      f.inicioIso = next.inicioIso;
      f.finIso = next.finIso;
      f.reprogramaciones += 1;
      return true;
    },
  };
}
