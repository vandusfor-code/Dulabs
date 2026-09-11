/**
 * Contratos Nylas (PILOTO AMORE, autorizado) — boundary inyectable, mismo
 * patrón ya usado para Gemini (lib/flow/gemini/gemini-types.ts): un cliente
 * real basado en fetch (nylas-client.ts) y una interfaz que los tests pueden
 * mockear sin tocar la red real.
 */

export type NylasEventWhen =
  | { object: "timespan"; start_time: number; end_time: number }
  | { object: "datespan"; start_date: string; end_date: string }
  | { object: "date"; date: string };

export interface NylasEvent {
  id: string;
  when: NylasEventWhen;
  /** "confirmed" | "cancelled" | "tentative" -- eventos cancelados nunca ocupan horario. */
  status?: string;
}

export interface NylasListEventsParams {
  grantId: string;
  calendarId: string;
  /** Unix seconds (inclusive), igual que la API real de Nylas. */
  startUnix: number;
  endUnix: number;
}

/** Boundary inyectable -- los tests mockean esto, nunca la red real. */
export interface NylasEventsClient {
  listEvents(params: NylasListEventsParams, signal?: AbortSignal): Promise<NylasEvent[]>;
}

/**
 * FASE C (autorizado) — boundary de ESCRITURA, separado a propósito de
 * NylasEventsClient (solo lectura, FASE B): así ningún mock existente de
 * FASE B necesita implementar createEvent/deleteEvent, y ningún caller de
 * solo-disponibilidad puede crear/borrar un evento por accidente.
 */
export interface NylasCreateEventParams {
  grantId: string;
  calendarId: string;
  title: string;
  description?: string;
  /** Unix seconds. */
  startUnix: number;
  endUnix: number;
  /** IANA, ej. "America/Bogota". */
  timezone: string;
  /** Invitados reales del evento (autorizado) -- Google Calendar les manda una invitación real por correo. Omitido = comportamiento idéntico al de siempre (ningún invitado). */
  participants?: { email: string; name?: string }[];
}

export interface NylasCreatedEvent {
  id: string;
}

export interface NylasDeleteEventParams {
  grantId: string;
  calendarId: string;
  eventId: string;
}

export interface NylasEventsWriteClient {
  createEvent(params: NylasCreateEventParams, signal?: AbortSignal): Promise<NylasCreatedEvent>;
  deleteEvent(params: NylasDeleteEventParams, signal?: AbortSignal): Promise<void>;
}
