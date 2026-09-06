/**
 * PILOTO AMORE + Nylas (autorizado) — convierte eventos reales de Nylas
 * (Google Calendar) al MISMO tipo `VentanaHoraria` que ya usa todo el motor
 * de disponibilidad de DuLabs (lib/especialistas.ts), para que
 * generarHorariosLibres/restarBloqueos los traten exactamente igual que una
 * cita o un bloqueo internos -- ningún cálculo nuevo, solo una fuente de
 * ocupación adicional.
 */
import type { VentanaHoraria } from "@/lib/especialistas";
import type { NylasEvent, NylasEventsClient } from "@/lib/nylas/nylas-types";

export type ResultadoEventosOcupadosNylas = { ok: true; ocupadas: VentanaHoraria[] } | { ok: false; motivo: "error" | "timeout" };

function bloqueDiaCompleto(fechaISO: string): VentanaHoraria {
  // Mismo huso fijo America/Bogota (-05:00) que ya usa todo el motor
  // (ventanaAtencion/horaEnFecha en lib/especialistas.ts) -- un evento de
  // día completo bloquea TODO el día local, sin asumir dónde empieza/termina
  // la jornada real de esta profesional ese día.
  return {
    apertura: new Date(`${fechaISO}T00:00:00-05:00`),
    cierre: new Date(`${fechaISO}T23:59:59.999-05:00`),
  };
}

/**
 * Nunca inventa ocupación que Nylas no reportó, y nunca trata un evento
 * cancelado como si ocupara. `datespan`/`date` (eventos de día completo) se
 * traducen a "todo el día local" SOLO si la fecha consultada cae dentro de
 * su rango -- `end_date` de un datespan es EXCLUSIVO (convención real de
 * Google/Microsoft que Nylas expone tal cual, ver docs), así que se compara
 * con `<`, nunca `<=`.
 */
export function eventosNylasComoVentanas(eventos: NylasEvent[], fechaISO: string): VentanaHoraria[] {
  const ocupadas: VentanaHoraria[] = [];
  for (const evento of eventos) {
    if (evento.status === "cancelled") continue;
    switch (evento.when.object) {
      case "timespan":
        ocupadas.push({
          apertura: new Date(evento.when.start_time * 1000),
          cierre: new Date(evento.when.end_time * 1000),
        });
        break;
      case "date":
        if (evento.when.date === fechaISO) ocupadas.push(bloqueDiaCompleto(fechaISO));
        break;
      case "datespan":
        if (evento.when.start_date <= fechaISO && fechaISO < evento.when.end_date) {
          ocupadas.push(bloqueDiaCompleto(fechaISO));
        }
        break;
    }
  }
  return ocupadas;
}

/**
 * Consulta real (SOLO LECTURA) de eventos ocupados de UN calendario de
 * Nylas para una profesional puntual, ya convertidos a VentanaHoraria.
 *
 * Regla explícita del piloto: si Nylas falla, hace timeout, o el calendario
 * no existe/no es accesible, esta función NUNCA devuelve `ok:true` con una
 * lista vacía (que el caller podría confundir con "de verdad no tiene nada
 * ocupado") -- devuelve `ok:false` explícito, para que el caller trate a
 * esa profesional como disponibilidad NO CONFIRMADA, nunca como libre.
 */
export async function consultarEventosOcupadosNylas(
  client: NylasEventsClient,
  params: { grantId: string; calendarId: string; fechaISO: string; desde: Date; hasta: Date },
  signal?: AbortSignal,
): Promise<ResultadoEventosOcupadosNylas> {
  try {
    const eventos = await client.listEvents(
      {
        grantId: params.grantId,
        calendarId: params.calendarId,
        startUnix: Math.floor(params.desde.getTime() / 1000),
        endUnix: Math.ceil(params.hasta.getTime() / 1000),
      },
      signal,
    );
    return { ok: true, ocupadas: eventosNylasComoVentanas(eventos, params.fechaISO) };
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
      return { ok: false, motivo: "timeout" };
    }
    return { ok: false, motivo: "error" };
  }
}
