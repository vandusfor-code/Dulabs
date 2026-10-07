/**
 * SOLO PARA PRUEBAS — un «mundo AMORE» en memoria para ejercitar de punta a punta el código REAL de reservas (portal), «Mi cita», recordatorios y chat:
 *   - una base en memoria con las MISMAS reglas que importan de Postgres: el EXCLUDE de solape de citas (23P01) y la clave única de la idempotencia (23505);
 *   - un Google Calendar falso (Nylas) con estado: crear / borrar eventos y leer lo ocupado, sin salir nunca a la red;
 *   - el envío por WhatsApp capturado.
 * Tenant, profesionales, clientas y servicios de PRUEBA (el tenant es el de AMORE porque el código de reservas por Nylas está limitado a ese id).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearSupabaseEnMemoria, type TablasEnMemoria } from "@/lib/test-helpers/supabase-en-memoria";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import type { NylasEvent, NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";
import { createMemoryEnlacesStore } from "@/lib/mi-cita/enlaces";
import type { DepsMiCita } from "@/lib/mi-cita/gestion";

export const T = AMORE_TENANT_ID;
export const TELEFONO_CLIENTA = "573148127388";
export const PROFESIONALES = [
  { id: 1262, nombre: "Mary", calendario: "cal-mary" },
  { id: 1263, nombre: "Cristal", calendario: "cal-cristal" },
];
export const SERVICIO_DIPPING = { id: "s-dipping", nombre: "Dipping", duracion_min: 120, precio: 60000 };

/**
 * El «ahora» FIJO para las pruebas que dependen del día o de la hora («ya pasó», «dentro de N días», días hábiles): lunes 2026-10-05, 10:30 en Bogotá. Con el reloj del sistema esas pruebas
 * fallaban según el día de la semana y la hora en que se corrieran. Es una función y no un `Date` compartido para que ninguna prueba pueda mover el instante de otra.
 * CUIDADO: solo es seguro si TODO el código de producción que la prueba ejercita usa el reloj INYECTADO (`deps.ahora`). Hay código que lee el reloj REAL por su cuenta
 * (`urlEnlaceDeCita` en lib/mi-cita/chat.ts y `consultarCitasActivasEspecialista`): con un mundo fijo en el pasado, sus enlaces «vencen» y la consulta del chat descarta la cita, así que las
 * pruebas que pasan por ahí (panel.test.ts, reserva-portal.test.ts) deben seguir con el reloj real: un reloj fijo las rompería cuando el reloj real alcance esas fechas.
 */
export const ahoraFijo = (): Date => new Date("2026-10-05T10:30:00-05:00");

const sumarDiasISO = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const hoyBogota = (ahora: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(ahora);

/** Un día laborable (lunes a sábado) dentro de N días desde `desde`. */
export function diaLaborable(desde: Date, minimoDias: number): string {
  let dia = sumarDiasISO(hoyBogota(desde), minimoDias);
  while (new Date(`${dia}T12:00:00-05:00`).getDay() === 0) dia = sumarDiasISO(dia, 1);
  return dia;
}

export interface EventoFalso {
  id: string;
  calendarId: string;
  startUnix: number;
  endUnix: number;
  title: string;
}

export function crearGoogleCalendarFalso() {
  const eventos = new Map<string, EventoFalso>();
  let seq = 0;
  const llamadas = { listar: 0, crear: 0, borrar: 0 };
  const falla = { listar: false, crear: false, borrar: false };
  const read: NylasEventsClient = {
    async listEvents(p) {
      llamadas.listar++;
      if (falla.listar) throw new Error("nylas caído");
      return [...eventos.values()]
        .filter((e) => e.calendarId === p.calendarId && e.startUnix < p.endUnix && e.endUnix > p.startUnix)
        .map<NylasEvent>((e) => ({ id: e.id, status: "confirmed", busy: true, when: { object: "timespan", start_time: e.startUnix, end_time: e.endUnix } }));
    },
  };
  const write: NylasEventsWriteClient = {
    async createEvent(p) {
      llamadas.crear++;
      if (falla.crear) throw new Error("nylas no pudo crear el evento");
      const id = `evt-${++seq}`;
      eventos.set(id, { id, calendarId: p.calendarId, startUnix: p.startUnix, endUnix: p.endUnix, title: p.title });
      return { id };
    },
    async deleteEvent(p) {
      llamadas.borrar++;
      if (falla.borrar) throw new Error("nylas no pudo borrar el evento");
      // Como el Google real: un evento solo se borra desde SU calendario (borrarlo desde otro responde «no existe»).
      const existente = eventos.get(p.eventId);
      if (existente && existente.calendarId !== p.calendarId) throw new Error("el evento no está en ese calendario");
      eventos.delete(p.eventId);
    },
  } as NylasEventsWriteClient;
  return { eventos, read, write, llamadas, falla, grantId: "grant-de-prueba" };
}

type Fila = Record<string, unknown>;

const SOLAPE = (existentes: Fila[], c: Fila) =>
  existentes.some(
    (f) =>
      f.especialista_id === c.especialista_id &&
      f.bloquea_horario === true &&
      c.bloquea_horario === true &&
      ["pendiente", "confirmada"].includes(f.estado as string) &&
      ["pendiente", "confirmada"].includes(c.estado as string) &&
      new Date(c.inicio as string) < new Date(f.fin as string) &&
      new Date(c.fin as string) > new Date(f.inicio as string),
  );

export interface OpcionesMundo {
  /** El reloj del mundo. Sin esto es el reloj REAL del sistema: coherente con el código de producción que lee `new Date()` por su cuenta, pero no determinista (ver `ahoraFijo`). */
  ahora?: Date;
  /** La profesional requiere aprobación manual (la cita nace «pendiente»). */
  requiereAprobacion?: boolean;
}

export function crearMundoAmore(opciones: OpcionesMundo = {}) {
  let reloj = opciones.ahora ?? new Date();
  const tablas: TablasEnMemoria = {
    dulabs_servicios: [{ id: SERVICIO_DIPPING.id, id_tenant: T, nombre: SERVICIO_DIPPING.nombre, precio: SERVICIO_DIPPING.precio, duracion_min: SERVICIO_DIPPING.duracion_min, categoria: "Uñas", descripcion: null, activo: true }],
    dulabs_servicio_especialista: PROFESIONALES.map((p) => ({ id_tenant: T, servicio_id: SERVICIO_DIPPING.id, especialista_id: p.id })),
    dulabs_especialistas: PROFESIONALES.map((p) => ({
      id: p.id,
      id_tenant: T,
      nombre: p.nombre,
      activo: true,
      // El valor LEGACY de Meta que tiene AMORE en la base real (nunca el de WhatsApp-QR): es justo lo que el portal viejo guardaba en cada cita.
      phone_number_id: `pendiente-amore-${T.slice(0, 8)}`,
      bloquea_horario: true,
      requiere_aprobacion: opciones.requiereAprobacion ?? false,
      nylas_calendar_id: p.calendario,
      numero_whatsapp: "573000000000",
    })),
    dulabs_horario_especialista: [],
    dulabs_bloqueos: [],
    dulabs_citas_especialista: [],
    dulabs_cita_servicios: [],
    dulabs_idempotencia_reservas: [],
    dulabs_agenda_v2_citas_nylas: [],
    dulabs_clientes_conocidos: [],
  };
  const supabase: SupabaseClient = crearSupabaseEnMemoria(tablas, {
    defaults: {
      dulabs_citas_especialista: () => ({ estado: "pendiente", motivo_rechazo: null, recordatorio_enviado: false, precio_total: null, origen: "manual" }),
      dulabs_idempotencia_reservas: () => ({ resultado_json: null }),
    },
    restricciones: {
      dulabs_citas_especialista: (existentes, c) => (SOLAPE(existentes, c) ? { code: "23P01", message: "conflicting key value violates exclusion constraint" } : null),
      dulabs_idempotencia_reservas: (existentes, c, op) =>
        op === "insert" && existentes.some((f) => f.id_tenant === c.id_tenant && f.idempotency_key === c.idempotency_key) ? { code: "23505", message: "duplicate key value violates unique constraint" } : null,
    },
  });
  const google = crearGoogleCalendarFalso();
  const enlaces = createMemoryEnlacesStore();
  const enviados: { tenantId: string; telefono: string; mensaje: string }[] = [];
  const confirmaciones: { telefono: string; cita: { servicio: string; profesional: string; inicioISO: string; enlaceGestion?: string | null } }[] = [];

  const depsMiCita = (sobre: Partial<DepsMiCita> = {}): DepsMiCita => ({
    supabase,
    store: enlaces,
    nylas: { read: google.read, write: google.write, grantId: google.grantId },
    ahora: () => reloj,
    enviarMensaje: async (p) => {
      enviados.push(p);
      return { ok: true };
    },
    nombresServicios: async () => [],
    log: () => {},
    ...sobre,
  });

  return {
    supabase,
    tablas,
    google,
    enlaces,
    enviados,
    confirmaciones,
    depsMiCita,
    ahora: () => reloj,
    avanzarReloj: (ms: number) => {
      reloj = new Date(reloj.getTime() + ms);
    },
    citas: () => tablas.dulabs_citas_especialista as Fila[],
    /** Una cita existente de la clienta (como la dejaría la reserva) con su evento de Google. */
    sembrarCita(p: { id?: number; especialistaId?: number; inicio: Date; estado?: string; telefono?: string | null; phoneNumberId?: string; conEvento?: boolean }): { citaId: number; eventoId: string | null } {
      const profesional = PROFESIONALES.find((x) => x.id === (p.especialistaId ?? 1263))!;
      const id = p.id ?? 500 + (tablas.dulabs_citas_especialista as Fila[]).length;
      const fin = new Date(p.inicio.getTime() + SERVICIO_DIPPING.duracion_min * 60_000);
      (tablas.dulabs_citas_especialista as Fila[]).push({
        id,
        id_tenant: T,
        especialista_id: profesional.id,
        phone_number_id: p.phoneNumberId ?? `whatsapp-qr:${T}`,
        telefono_cliente: p.telefono === undefined ? TELEFONO_CLIENTA : p.telefono,
        nombre_cliente: "Ana",
        servicio: SERVICIO_DIPPING.nombre,
        servicio_id: SERVICIO_DIPPING.id,
        precio_total: null,
        bloquea_horario: true,
        inicio: p.inicio.toISOString(),
        fin: fin.toISOString(),
        estado: p.estado ?? "confirmada",
        motivo_rechazo: null,
        recordatorio_enviado: false,
        origen: "manual",
      });
      let eventoId: string | null = null;
      if (p.conEvento !== false) {
        eventoId = `evt-previo-${id}`;
        google.eventos.set(eventoId, { id: eventoId, calendarId: profesional.calendario, startUnix: Math.floor(p.inicio.getTime() / 1000), endUnix: Math.floor(fin.getTime() / 1000), title: "AMORE — Dipping (Ana)" });
        (tablas.dulabs_agenda_v2_citas_nylas as Fila[]).push({ cita_id: id, nylas_event_id: eventoId });
      }
      return { citaId: id, eventoId };
    },
  };
}

export type MundoAmore = ReturnType<typeof crearMundoAmore>;
