/**
 * Reproducción del bug real de AMORE: "No encontramos días disponibles con esa
 * profesional en los próximos días 😔 Elige otra" al elegir a Cristal (opción
 * 2) aunque su agenda SÍ tiene espacio.
 *
 * A diferencia de router.test.ts (que reemplaza el cálculo de días por un
 * fixture), acá corre la cadena REAL completa: procesarMensajeConAgendaV2 ->
 * calcularDiasCandidatosReales -> ventanasLaboralesEspecialista /
 * bloqueosDelDia -> listarHorariosDisponiblesPorServicioConNylas ->
 * resolverEspecialistasElegiblesParaServicio -> calcularHorariosDeEspecialista
 * -> resolverCalendarIdNylasDeEspecialista -> createNylasEventsClient (cliente
 * HTTP real) -> eventosNylasComoVentanas. Lo único simulado es lo que vive
 * FUERA del código: las filas de la base (en memoria) y las respuestas HTTP
 * de la API de Nylas (fetch). Ningún test toca Supabase, Nylas ni WhatsApp
 * reales.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { procesarMensajeConAgendaV2, type AgendaV2RouterDeps } from "@/lib/agenda-v2/router";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import type { SesionAgendaV2, CambiosSesionAgendaV2 } from "@/lib/agenda-v2/sesiones";
import { construirOpcionesProfesional } from "@/lib/agenda-v2/profesionales";
import { crearSupabaseEnMemoria, type TablasEnMemoria } from "@/lib/test-helpers/supabase-en-memoria";

const TENANT = AMORE_TENANT_ID;
const DIPPING = "s-dipping-real";
const TELEFONO = "573148127388";

const PROFESIONALES = [
  { id: 1262, nombre: "Mary", calendario: "cal-mary" },
  { id: 1263, nombre: "Cristal", calendario: "cal-cristal" },
  { id: 1264, nombre: "Nata", calendario: "cal-nata" },
  { id: 1265, nombre: "Jessica", calendario: "cal-jessica" },
];

function tablasAmore(): TablasEnMemoria {
  return {
    dulabs_servicios: [{ id: DIPPING, id_tenant: TENANT, nombre: "Dipping", duracion_min: 120, activo: true, categoria: "Uñas" }],
    dulabs_servicio_especialista: PROFESIONALES.map((p) => ({ id_tenant: TENANT, servicio_id: DIPPING, especialista_id: p.id })),
    dulabs_especialistas: PROFESIONALES.map((p) => ({ id: p.id, id_tenant: TENANT, nombre: p.nombre, activo: true, nylas_calendar_id: p.calendario })),
    // Sin horario propio -> respaldo real al horario general del salón (L-V 9-19, S 9-18), igual que en producción.
    dulabs_horario_especialista: [],
    dulabs_bloqueos: [],
    dulabs_citas_especialista: [],
  };
}

type RespuestaNylas = (q: { calendarId: string; start: number; end: number }) => { status: number; body: unknown };

/** Sustituye fetch SOLO para la API de Nylas -- cualquier otra URL falla ruidosamente (ningún test sale a la red). */
function instalarNylasFalso(responder: RespuestaNylas): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== "api.us.nylas.com") throw new Error(`fetch inesperado a ${url.hostname}`);
    const { status, body } = responder({
      calendarId: url.searchParams.get("calendar_id") ?? "",
      start: Number(url.searchParams.get("start")),
      end: Number(url.searchParams.get("end")),
    });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function sesionEnPasoProfesional(): SesionAgendaV2 {
  return {
    id: 1,
    tenantId: TENANT,
    telefonoCliente: TELEFONO,
    activo: true,
    step: "S2_PROFESIONAL",
    servicioId: DIPPING,
    serviciosIds: null,
    profesionalId: null,
    fechaIso: null,
    slotSeleccionado: null,
    opcionesMostradas: construirOpcionesProfesional(PROFESIONALES.map((p) => ({ especialistaId: p.id, nombre: p.nombre }))),
    ultimoWamidProcesado: "wamid-previo",
    citaObjetivoId: null,
    accionGestion: null,
    intentosFallidosConsecutivos: 0,
    createdAt: "2026-09-23T00:00:00Z",
    updatedAt: "2026-09-23T00:00:00Z",
  };
}

function escenario() {
  let sesion: SesionAgendaV2 | null = sesionEnPasoProfesional();
  const enviados: string[] = [];
  const deps: AgendaV2RouterDeps = {
    adquirirCandadoChat: async () => true,
    liberarCandadoChat: async () => {},
    cargarEscenariosReal: async () => [],
    resolverNylasGrantIdParaTenant: () => "grant-amore-prueba",
    resolveNylasApiKeyFromEnv: () => "clave-prueba",
    buscarSesionActiva: async () => sesion,
    actualizarSesion: async (_s, _id, cambios: CambiosSesionAgendaV2) => {
      sesion = { ...sesion!, ...cambios } as SesionAgendaV2;
    },
    cerrarSesion: async () => {
      sesion = null;
    },
    enviarMensajeWhatsApp: (async (p: { mensaje: string }) => {
      enviados.push(p.mensaje);
      return { ok: true };
    }) as unknown as AgendaV2RouterDeps["enviarMensajeWhatsApp"],
  };
  return { deps, enviados, sesion: () => sesion };
}

async function elegirOpcion(texto: string, deps: AgendaV2RouterDeps) {
  return procesarMensajeConAgendaV2({ supabase: crearSupabaseEnMemoria(tablasAmore()), idTenant: TENANT, telefono: TELEFONO, texto, wamid: `wamid-${texto}` }, deps);
}

describe("Cadena real de disponibilidad -- elegir profesional (bug 'No encontramos días disponibles')", () => {
  let restaurarFetch: () => void = () => {};
  let erroresOriginal: typeof console.error;
  let errores: string[] = [];

  beforeEach(() => {
    errores = [];
    erroresOriginal = console.error;
    console.error = (...args: unknown[]) => {
      errores.push(args.map(String).join(" "));
    };
  });
  afterEach(() => {
    restaurarFetch();
    console.error = erroresOriginal;
  });

  it("control: profesional con calendario vacío -> ofrece días reales (avanza a S3_DIA)", async () => {
    restaurarFetch = instalarNylasFalso(() => ({ status: 200, body: { data: [] } }));
    const e = escenario();
    await elegirOpcion("1", e.deps); // Mary
    assert.equal(e.sesion()!.step, "S3_DIA");
    assert.equal(e.sesion()!.profesionalId, 1262);
    assert.match(e.enviados.at(-1)!, /¿Qué día/i);
  });

  it("CAUSA B: un evento marcado 'Libre' (busy:false) en Google Calendar NO debe bloquear la agenda de Cristal", async () => {
    // Caso real frecuente: la profesional marca su jornada ("Disponible", "Turno Cristal") como evento LIBRE en su calendario.
    restaurarFetch = instalarNylasFalso(({ calendarId, start, end }) => ({
      status: 200,
      body: {
        data:
          calendarId === "cal-cristal"
            ? [{ id: "evt-turno", status: "confirmed", busy: false, when: { object: "timespan", start_time: start, end_time: end } }]
            : [],
      },
    }));
    const e = escenario();
    await elegirOpcion("2", e.deps); // Cristal
    assert.doesNotMatch(e.enviados.at(-1)!, /No encontramos días disponibles/, "un evento LIBRE nunca ocupa horario");
    assert.equal(e.sesion()!.step, "S3_DIA");
    assert.equal(e.sesion()!.profesionalId, 1263);
  });

  it("CAUSA B': un evento de día completo marcado 'Libre' (cumpleaños, recordatorio) NO debe bloquear el día", async () => {
    restaurarFetch = instalarNylasFalso(({ calendarId, start }) => {
      const fecha = new Date(start * 1000 - 5 * 3600 * 1000).toISOString().slice(0, 10);
      return {
        status: 200,
        body: { data: calendarId === "cal-cristal" ? [{ id: "evt-recordatorio", status: "confirmed", busy: false, when: { object: "date", date: fecha } }] : [] },
      };
    });
    const e = escenario();
    await elegirOpcion("2", e.deps);
    assert.equal(e.sesion()!.step, "S3_DIA");
  });

  it("un evento OCUPADO (busy:true) sí bloquea: si ocupa toda la jornada todos los días, no se inventan días", async () => {
    restaurarFetch = instalarNylasFalso(({ calendarId, start, end }) => ({
      status: 200,
      body: {
        data: calendarId === "cal-cristal" ? [{ id: "evt-ocupado", status: "confirmed", busy: true, when: { object: "timespan", start_time: start, end_time: end } }] : [],
      },
    }));
    const e = escenario();
    await elegirOpcion("2", e.deps);
    assert.equal(e.sesion()!.step, "S2_PROFESIONAL", "sin cupo real, nunca avanza a elegir día");
    assert.notEqual(e.sesion()!.profesionalId, 1263);
  });

  it("CAUSA A: si Nylas FALLA al leer el calendario de Cristal, el bot NO debe afirmar que no tiene días y debe dejar rastro en logs", async () => {
    // Caso real: calendario no compartido con la cuenta conectada / calendar_id incorrecto -> 404/403 en cada consulta.
    restaurarFetch = instalarNylasFalso(({ calendarId }) =>
      calendarId === "cal-cristal" ? { status: 404, body: { error: { type: "not_found", message: "Calendar not found" } } } : { status: 200, body: { data: [] } },
    );
    const e = escenario();
    await elegirOpcion("2", e.deps);
    const respuesta = e.enviados.at(-1)!;
    assert.doesNotMatch(respuesta, /No encontramos días disponibles/, "un error técnico nunca se presenta como 'sin disponibilidad'");
    assert.match(respuesta, /Cristal/, "la clienta sabe con quién hubo el problema");
    assert.ok(
      errores.some((l) => l.includes("no_confirmado") && l.includes("1263")),
      `debe quedar un log accionable (profesional + motivo). Logs: ${JSON.stringify(errores)}`,
    );
  });
});
