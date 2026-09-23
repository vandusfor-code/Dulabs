/**
 * MATRIZ DE CONVERSACIÓN de AMORE sobre el pipeline ÚNICO de producción (lib/whatsapp-qr-pipeline.ts: atención humana
 * -> registro -> compra -> Agenda V2 -> entrada AMORE), con TODO el código real: almacenes reales de sesión/estado/
 * clientes sobre una base EN MEMORIA, cadena real de disponibilidad (motor + cliente HTTP de Nylas), catálogo y fichas
 * reales como contexto de la IA. Solo se simula lo que vive fuera del código:
 *   - las respuestas HTTP de Nylas (lib/test-helpers/nylas-falso.ts),
 *   - el envío por WhatsApp (se capturan los mensajes),
 *   - el LLM: un clasificador determinista que responde SOLO con los datos del contexto que recibe (así se verifica que
 *     los datos reales llegan al modelo; la calidad de redacción de Gemini real no se puede medir sin su API key).
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { atenderMensajeWhatsAppQR, type DepsPipelineWhatsAppQR } from "@/lib/whatsapp-qr-pipeline";
import { iniciarNuevaSesionAgendaV2, iniciarGestionCitasAgendaV2, type AgendaV2RouterDeps } from "@/lib/agenda-v2/router";
import { AMORE_TENANT_ID, phoneNumberIdWhatsappQr } from "@/lib/nylas/nylas-grant";
import { AMORE_ESCENARIOS_SEED } from "@/lib/bot-escenarios/seed-amore";
import type { EscenarioRow } from "@/lib/bot-escenarios/tipos";
import { NUMERO_JESSICA, MENSAJE_TRANSFERENCIA_ERROR_TECNICO, type ResultadoClasificacionGemini } from "@/lib/amore-entrada-gemini";
import { crearSupabaseEnMemoria, type TablasEnMemoria } from "@/lib/test-helpers/supabase-en-memoria";
import { instalarNylasFalso, calendarioNylas, type RespuestaNylas } from "@/lib/test-helpers/nylas-falso";
import { fechaColombiaDesdeIso } from "@/lib/timezone-colombia";
import { sumarDias } from "@/lib/parse-fecha-colombia";

const T = AMORE_TENANT_ID;
const TEL = "573148127388";
const PROFESIONALES = [
  { id: 1262, nombre: "Mary" },
  { id: 1263, nombre: "Cristal" },
  { id: 1264, nombre: "Nata" },
  { id: 1265, nombre: "Jessica" },
];
const calendario = (id: number) => `cal-${PROFESIONALES.find((p) => p.id === id)!.nombre.toLowerCase()}`;

const HOY = fechaColombiaDesdeIso(new Date().toISOString());
const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DIA_OBJETIVO = (() => {
  const d = sumarDias(HOY, 2);
  return new Date(`${d}T12:00:00-05:00`).getDay() === 0 ? sumarDias(HOY, 3) : d;
})();
const NOMBRE_DIA = DIAS[new Date(`${DIA_OBJETIVO}T12:00:00-05:00`).getDay()]!;
const unix = (fecha: string, hhmm: string) => Math.floor(new Date(`${fecha}T${hhmm}:00-05:00`).getTime() / 1000);

function tablasAmore(clienteRegistrado: boolean): TablasEnMemoria {
  return {
    dulabs_servicios: [
      { id: "s-dipping", id_tenant: T, nombre: "Dipping", precio: 60000, duracion_min: 120, categoria: "Uñas", descripcion: null, activo: true },
      { id: "s-presson", id_tenant: T, nombre: "Press On", precio: 80000, duracion_min: 120, categoria: "Uñas", descripcion: null, activo: true },
      { id: "s-peinado", id_tenant: T, nombre: "Peinado", precio: 40000, duracion_min: 60, categoria: "Cabello", descripcion: null, activo: true },
    ],
    dulabs_servicio_especialista: [
      ...["s-dipping", "s-presson"].flatMap((s) => PROFESIONALES.map((p) => ({ id_tenant: T, servicio_id: s, especialista_id: p.id }))),
      { id_tenant: T, servicio_id: "s-peinado", especialista_id: 1262 },
      { id_tenant: T, servicio_id: "s-peinado", especialista_id: 1265 },
    ],
    dulabs_especialistas: PROFESIONALES.map((p) => ({ id: p.id, id_tenant: T, nombre: p.nombre, activo: true, nylas_calendar_id: calendario(p.id) })),
    dulabs_bot_conocimiento: [
      { tenant_id: T, servicio_id: "s-dipping", fuente: "conocimiento_general", que_es: "Esmaltado en polvo, resistente.", para_que_sirve: "Uñas duraderas para eventos.", limites: "No afirmar marcas.", activo: true },
    ],
    dulabs_horario_especialista: [],
    dulabs_bloqueos: [],
    dulabs_citas_especialista: [],
    dulabs_clientes_conocidos: clienteRegistrado
      ? [{ id: 1, phone_number_id: phoneNumberIdWhatsappQr(T), telefono_cliente: TEL, nombre: "Ana", cumple_dia: 5, cumple_mes: 3 }]
      : [],
    dulabs_agenda_v2_sesiones: [],
    dulabs_amore_entrada: [],
  };
}

const DEFAULTS = {
  dulabs_agenda_v2_sesiones: {
    activo: true,
    step: "S1_SERVICIO",
    servicio_id: null,
    servicios_ids: null,
    profesional_id: null,
    fecha_iso: null,
    slot_seleccionado: null,
    opciones_mostradas: null,
    ultimo_wamid_procesado: null,
    cita_objetivo_id: null,
    accion_gestion: null,
    intentos_fallidos_consecutivos: 0,
  },
  dulabs_amore_entrada: {
    modo: "inicio",
    ultimo_wamid_procesado: null,
    notificado_a_jessica: false,
    producto_interes_nombre: null,
    atencion_humana_desde: null,
    intentos_fallidos_consecutivos: 0,
  },
};

type Gemini = (p: { mensaje: string; contextoNegocio?: string }) => ResultadoClasificacionGemini;
const consulta = (replyText: string, extra: Partial<ResultadoClasificacionGemini> = {}): ResultadoClasificacionGemini => ({
  intent: "CONSULTA",
  replyText,
  detectedServiceMention: null,
  detectedProfessionalMention: null,
  detectedDateMention: null,
  detectedTimeMention: null,
  ...extra,
});

/** LLM determinista: responde precios/duraciones SOLO con lo que encuentre en el contexto REAL recibido. */
const geminiConDatos: Gemini = ({ mensaje, contextoNegocio }) => {
  const m = mensaje.toLowerCase();
  const lineas = [...(contextoNegocio ?? "").matchAll(/- ([^:\n]+): (\$[\d.]+), (\d+) min/g)];
  const servicio = lineas.find((l) => m.includes(l[1]!.toLowerCase()));
  if (/cu[aá]nto (cuesta|vale)|precio/.test(m)) {
    return consulta(servicio ? `El ${servicio[1]} cuesta ${servicio[2]} 💗 ¿Te ayudo a agendarlo?` : "Ese servicio no aparece en nuestro catálogo 💗 Si quieres, una persona del equipo te confirma.");
  }
  if (/cu[aá]nto (demora|dura)/.test(m)) return consulta(servicio ? `El ${servicio[1]} dura unos ${servicio[3]} minutos 💗` : "¿De qué servicio te gustaría saber? 💗");
  if (/boda|mam[aá]|regal/.test(m)) return consulta("¡Qué lindo! 💗 Para una ocasión especial te pueden gustar el Dipping o el Press On. ¿Te cuento de alguno?");
  if (/no voy a poder ir|me sali[oó] una vuelta/.test(m)) return { ...consulta(""), intent: "CANCELAR_CITA" };
  if (/cambiar(la)? para otro d[ií]a|pasar(la)? para otro d[ií]a/.test(m)) return { ...consulta(""), intent: "REPROGRAMAR_CITA" };
  return consulta("Claro 💗 ¿En qué te puedo ayudar?");
};

/** Cita REAL futura de la clienta (Cristal, Dipping) para los casos de cancelar/reprogramar. */
function citaExistente() {
  return {
    id: 77,
    id_tenant: T,
    phone_number_id: phoneNumberIdWhatsappQr(T),
    telefono_cliente: TEL,
    especialista_id: 1263,
    servicio: "Dipping",
    servicio_id: "s-dipping",
    inicio: new Date(`${DIA_OBJETIVO}T10:00:00-05:00`).toISOString(),
    fin: new Date(`${DIA_OBJETIVO}T12:00:00-05:00`).toISOString(),
    estado: "confirmada",
    bloquea_horario: true,
  };
}

function crearBot(
  opciones: {
    clienteRegistrado?: boolean;
    gemini?: Gemini;
    crearCita?: AgendaV2RouterDeps["crearCitaConNylas"];
    conCitaExistente?: boolean;
  } = {},
) {
  const tablas = tablasAmore(opciones.clienteRegistrado ?? true);
  if (opciones.conCitaExistente) tablas.dulabs_citas_especialista = [citaExistente()];
  const reprogramaciones: { citaId: number; nuevoInicio: Date }[] = [];
  const db = crearSupabaseEnMemoria(tablas, { defaults: DEFAULTS });
  const enviados: { telefono: string; mensaje: string }[] = [];
  const citas: { especialistaId: number; servicioId: string; inicio: Date }[] = [];
  const llamadasGemini: { mensaje: string; contextoNegocio?: string }[] = [];

  const comun = {
    adquirirCandadoChat: async () => true,
    liberarCandadoChat: async () => {},
    enviarMensajeWhatsApp: (async (p: { telefono: string; mensaje: string }) => {
      enviados.push({ telefono: p.telefono, mensaje: p.mensaje });
      return { ok: true };
    }) as unknown as AgendaV2RouterDeps["enviarMensajeWhatsApp"],
  };
  const agendaV2: AgendaV2RouterDeps = {
    ...comun,
    cargarEscenariosReal: async (_s, t) => AMORE_ESCENARIOS_SEED.map((e, i) => ({ ...e, id: `${t}-e${i}`, tenantId: t }) as EscenarioRow),
    resolverNylasGrantIdParaTenant: () => "grant-prueba",
    resolveNylasApiKeyFromEnv: () => "clave-prueba",
    hoyIsoParaExtraccion: () => HOY,
    createNylasEventsWriteClient: () => ({ createEvent: async () => ({ id: "evt" }), deleteEvent: async () => {} }),
    guardarNylasEventIdDeCita: async () => {},
    obtenerNylasEventIdDeCita: async () => null,
    borrarNylasEventIdDeCita: async () => {},
    // Solo la ESCRITURA de la reprogramación se simula (actualizarCitaConNylas tiene su propia suite con revalidación).
    actualizarCitaConNylas: (async (_s: unknown, p: { citaId: number; nuevoInicio: Date }) => {
      reprogramaciones.push({ citaId: p.citaId, nuevoInicio: p.nuevoInicio });
      const cita = { ...citaExistente(), inicio: p.nuevoInicio.toISOString() };
      return { ok: true, cita, nylasEventId: "evt", especialista: { id: 1263, nombre: "Cristal" }, servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 } };
    }) as never,
    // Preguntas a mitad de la reserva que no son de precio/duración: el mismo LLM determinista con el catálogo real.
    responderConsultaEnReserva: async ({ mensaje }) => {
      const r = (opciones.gemini ?? geminiConDatos)({ mensaje, contextoNegocio: "- Dipping: $60.000, 120 min\n- Press On: $80.000, 120 min" });
      return r.intent === "CONSULTA" && r.replyText ? r.replyText : null;
    },
    crearCitaConNylas:
      opciones.crearCita ??
      (async (_s, p) => {
        citas.push({ especialistaId: p.especialistaId, servicioId: p.servicioId, inicio: p.inicio });
        return {
          ok: true,
          cita: { id: 900 + citas.length } as never,
          nylasEventId: "evt",
          especialista: { id: p.especialistaId, nombre: PROFESIONALES.find((x) => x.id === p.especialistaId)!.nombre },
          servicio: { id: p.servicioId, nombre: "Dipping", duracionMin: 120 },
        };
      }),
  };
  const iniciarAgendaV2 = (p: Parameters<typeof iniciarNuevaSesionAgendaV2>[0]) => iniciarNuevaSesionAgendaV2(p, agendaV2);
  const deps: DepsPipelineWhatsAppQR = {
    atencionHumana: { ...comun },
    registroCliente: { ...comun, iniciarAgendaV2 },
    compraProducto: { ...comun, listarProductosActivos: async () => [] },
    agendaV2,
    entradaAmore: {
      ...comun,
      iniciarAgendaV2,
      iniciarGestionCitasAgendaV2: (p) => iniciarGestionCitasAgendaV2(p, agendaV2),
      obtenerHistorial: async () => [],
      clasificarConGemini: (async (p: { mensaje: string; contextoNegocio?: string }) => {
        llamadasGemini.push(p);
        return (opciones.gemini ?? geminiConDatos)(p);
      }) as never,
    },
  };

  let n = 0;
  async function decir(texto: string) {
    const antes = enviados.length;
    const r = await atenderMensajeWhatsAppQR({ supabase: db, idTenant: T, telefono: TEL, texto, wamid: `w${++n}` }, deps);
    const nuevos = enviados.slice(antes);
    return { r, respuestas: nuevos.filter((m) => m.telefono === TEL).map((m) => m.mensaje), aJessica: nuevos.filter((m) => m.telefono === NUMERO_JESSICA) };
  }
  const sesion = () => (tablas.dulabs_agenda_v2_sesiones ?? []).find((s) => s.activo) ?? null;
  const entrada = () => (tablas.dulabs_amore_entrada ?? [])[0] ?? null;
  const citaReal = () => (tablas.dulabs_citas_especialista ?? []).find((c) => c.id === 77) ?? null;
  return { decir, citas, reprogramaciones, llamadasGemini, sesion, entrada, citaReal };
}

let restaurar: () => void = () => {};
const conNylas = (r: RespuestaNylas) => (restaurar = instalarNylasFalso(r));
afterEach(() => restaurar());
const silenciarLogs = () => {
  const e = console.error;
  const i = console.info;
  console.error = () => {};
  console.info = () => {};
  return () => {
    console.error = e;
    console.info = i;
  };
};

// Todos los calendarios vacíos salvo el de Cristal: un "Turno" marcado LIBRE todos los días (el caso real del bug).
const AGENDA_NORMAL = () => calendarioNylas({ libresEn: ["cal-cristal"] });

describe("A. Conversación general", () => {
  it("A1 'Hola' -> bienvenida + menú, y nada se pierde", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    const { respuestas, r } = await bot.decir("Hola");
    assert.deepEqual(r, { ok: true, manejadoPor: "entrada_amore" });
    assert.equal(respuestas.length, 2);
    assert.match(respuestas[1]!, /1\. Quiero una cita/);
  });

  it("A2 primer mensaje con contexto ('Hola hermosa… uñas para una boda jajaja') -> se atiende de inmediato, sin menú", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    const { respuestas } = await bot.decir("Hola hermosa, estoy mirando porque quiero hacerme las uñas para una boda jajaja");
    assert.match(respuestas[0]!, /Bienvenido\/a a AMORE/);
    assert.match(respuestas[1]!, /ocasión especial/);
    assert.doesNotMatch(respuestas.join("\n"), /1\. Quiero una cita/);
  });

  it("A3 'gracias' / 'jajaja' / emoji -> respuestas cordiales, nunca un 'no entendí' ni una transferencia", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    await bot.decir("Hola");
    for (const t of ["jajaja", "💗", "gracias"]) {
      const { respuestas, aJessica } = await bot.decir(t);
      assert.equal(respuestas.length, 1, t);
      assert.equal(aJessica.length, 0, t);
      assert.doesNotMatch(respuestas[0]!, /No reconocí/, t);
    }
    assert.equal(bot.entrada()!.notificado_a_jessica, false);
  });
});

describe("B. Servicios -- precios y duraciones SOLO del catálogo real", () => {
  it("B1 '¿Cuánto cuesta el dipping?' / '¿Cuánto demora el dipping?' -> $60.000 y 120 min del catálogo real", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    await bot.decir("Hola");
    assert.match((await bot.decir("¿Cuánto cuesta el dipping?")).respuestas[0]!, /\$60\.000/);
    assert.match((await bot.decir("¿Cuánto demora el dipping?")).respuestas[0]!, /120 minutos/);
    assert.match(bot.llamadasGemini.at(-1)!.contextoNegocio!, /- Dipping: \$60\.000, 120 min aprox\./, "el modelo recibe el catálogo REAL");
  });

  it("B2 servicio inexistente ('¿cuánto cuesta la keratina?') -> el contexto no lo contiene y dice que es la lista COMPLETA", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    await bot.decir("Hola");
    const { respuestas } = await bot.decir("¿Cuánto cuesta la keratina?");
    assert.match(respuestas[0]!, /no aparece en nuestro catálogo/);
    const ctx = bot.llamadasGemini.at(-1)!.contextoNegocio!;
    assert.doesNotMatch(ctx, /keratina/i);
    assert.match(ctx, /lista COMPLETA/);
  });
});

describe("C-E. Profesionales, disponibilidad y reserva -- de punta a punta, en lenguaje natural", () => {
  it("reserva completa: 'Quiero una cita' -> 'uñas' -> 'el dipping' -> 'Quiero con Cristal' -> día -> 'a las 3' -> 'Sí, perfecto'", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    await bot.decir("Quiero una cita");
    assert.equal(bot.sesion()!.step, "S1_SERVICIO");
    await bot.decir("uñas");
    await bot.decir("el dipping");
    assert.equal(bot.sesion()!.step, "S2_PROFESIONAL");
    const conCristal = await bot.decir("Quiero con Cristal");
    assert.equal(bot.sesion()!.step, "S3_DIA", conCristal.respuestas.join("\n"));
    assert.doesNotMatch(conCristal.respuestas.join("\n"), /No encontramos días/, "el bug real: Cristal SÍ tiene agenda");
    await bot.decir(`el ${NOMBRE_DIA}`);
    assert.equal(bot.sesion()!.step, "S4_HORA");
    const resumen = await bot.decir("a las 3");
    assert.equal(bot.sesion()!.step, "S5_CONFIRMAR");
    assert.match(resumen.respuestas[0]!, /Cristal/);
    assert.match(resumen.respuestas[0]!, /\$60\.000/);
    const fin = await bot.decir("Sí, perfecto 💗");
    assert.equal(bot.citas.length, 1);
    assert.equal(bot.citas[0]!.especialistaId, 1263);
    assert.equal(bot.citas[0]!.inicio.toISOString(), new Date(`${DIA_OBJETIVO}T15:00:00-05:00`).toISOString());
    assert.equal(bot.sesion(), null, "sesión cerrada tras el éxito real");
    assert.match(fin.respuestas[0]!, /Cristal/);
  });

  it("el mismo camino con NÚMEROS (la conversación real del bug: '1' -> '2' -> '1' -> '2') ofrece días de Cristal", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    await bot.decir("Hola");
    await bot.decir("1");
    await bot.decir("2"); // Uñas
    await bot.decir("1"); // Dipping
    const { respuestas } = await bot.decir("2"); // Cristal
    assert.equal(bot.sesion()!.step, "S3_DIA", respuestas.join("\n"));
    assert.equal(bot.sesion()!.profesional_id, 1263);
  });

  it("profesional SIN cupo real (Jessica, agenda llena) -> lo dice con su nombre y ofrece a las demás, sin ella", async () => {
    conNylas(calendarioNylas({ ocupados: { "cal-jessica": Array.from({ length: 16 }, (_, i) => ({ start: unix(sumarDias(HOY, i), "00:00"), end: unix(sumarDias(HOY, i), "23:59") })) } }));
    const bot = crearBot();
    const restaurarLogs = silenciarLogs();
    try {
      await bot.decir("Quiero una cita");
      await bot.decir("uñas");
      await bot.decir("dipping");
      const { respuestas } = await bot.decir("Jessica");
      assert.match(respuestas[0]!, /Jessica no tiene espacios libres/);
      assert.doesNotMatch(respuestas[0]!, /\d\. Jessica/);
      assert.equal(bot.sesion()!.step, "S2_PROFESIONAL");
    } finally {
      restaurarLogs();
    }
  });

  it("calendario de Cristal ILEGIBLE (Nylas 404) -> dice la verdad ('no pude consultar'), nunca 'no hay días'", async () => {
    conNylas((q) => (q.calendarId === "cal-cristal" ? { status: 404, body: { error: { type: "not_found" } } } : AGENDA_NORMAL()(q)));
    const bot = crearBot();
    const restaurarLogs = silenciarLogs();
    try {
      await bot.decir("Quiero una cita");
      await bot.decir("uñas");
      await bot.decir("dipping");
      const { respuestas } = await bot.decir("con Cristal");
      assert.match(respuestas[0]!, /no pude consultar la agenda de Cristal/);
      assert.doesNotMatch(respuestas[0]!, /No encontramos días|no tiene espacios/);
    } finally {
      restaurarLogs();
    }
  });

  it("slot tomado justo antes de confirmar (revalidación real 'ocupado') -> nada se crea, vuelve a horas reales", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({ crearCita: async () => ({ ok: false, motivo: "ocupado", detalle: "Ese horario ya está ocupado." }) });
    await bot.decir("Quiero una cita");
    await bot.decir("uñas");
    await bot.decir("dipping");
    await bot.decir("Mary");
    await bot.decir(`el ${NOMBRE_DIA}`);
    await bot.decir("a las 3");
    await bot.decir("sí");
    assert.equal(bot.citas.length, 0);
    assert.equal(bot.sesion()!.step, "S4_HORA");
  });
});

describe("F. Conversación natural durante la reserva", () => {
  it("'me da igual quién' -> propone a la primera con días reales; 'Ah no, mejor con Cristal' -> cambia a sus días", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    await bot.decir("Quiero una cita");
    await bot.decir("uñas");
    await bot.decir("dipping");
    const propuesta = await bot.decir("me da igual quién");
    assert.match(propuesta.respuestas[0]!, /Te propongo con \*Mary\*/);
    assert.equal(bot.sesion()!.profesional_id, 1262);
    await bot.decir("Ah no, mejor con Cristal");
    assert.equal(bot.sesion()!.profesional_id, 1263);
    assert.equal(bot.sesion()!.step, "S3_DIA");
  });

  it("'¿puede ser después de las 5?' en las horas -> solo horas reales desde las 5 p. m.", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    await bot.decir("Quiero una cita");
    await bot.decir("uñas");
    await bot.decir("dipping");
    await bot.decir("Mary");
    await bot.decir(`el ${NOMBRE_DIA}`);
    await bot.decir("¿puede ser después de las 5?");
    const horas = (bot.sesion()!.opciones_mostradas as { opciones: { hora: string }[] }).opciones.map((o) => o.hora);
    assert.ok(horas.length > 0 && horas.every((h) => h >= "17:00"), JSON.stringify(horas));
  });
});

describe("G. Casos límite", () => {
  it("'cancelar' a mitad de la reserva cierra la sesión; lo siguiente se conversa normalmente", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    await bot.decir("Quiero una cita");
    await bot.decir("uñas");
    await bot.decir("cancelar");
    assert.equal(bot.sesion(), null);
    const { r } = await bot.decir("¿cuánto cuesta el press on?");
    assert.deepEqual(r, { ok: true, manejadoPor: "entrada_amore" });
  });

  it("'quiero hablar con una persona' a mitad de la reserva -> notifica a Jessica y luego silencio total", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    await bot.decir("Quiero una cita");
    await bot.decir("uñas");
    const traspaso = await bot.decir("quiero hablar con una persona");
    assert.equal(traspaso.aJessica.length, 1);
    assert.equal(bot.entrada()!.modo, "atencion_humana");
    const despues = await bot.decir("¿hola?");
    assert.deepEqual(despues.r, { ok: true, manejadoPor: "atencion_humana" });
    assert.equal(despues.respuestas.length, 0);
  });

  it("clienta NUEVA: 'Quiero una cita' -> registro (nombre, día, mes) -> y recién ahí el menú real", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({ clienteRegistrado: false });
    assert.match((await bot.decir("Quiero una cita")).respuestas.join("\n"), /tu nombre/);
    await bot.decir("Ana");
    await bot.decir("5");
    const { respuestas } = await bot.decir("marzo");
    assert.equal(bot.sesion()!.step, "S1_SERVICIO", respuestas.join("\n"));
  });

  it("Gemini caído dos veces seguidas -> pasa a una persona diciendo la verdad (nunca un bucle de 'reformula')", async () => {
    conNylas(AGENDA_NORMAL());
    const restaurarLogs = silenciarLogs();
    try {
      const bot = crearBot({ gemini: () => consulta("Disculpa, tuve un problema entendiendo tu mensaje 💗 ¿Puedes reformularlo?", { errorTecnico: true }) });
      await bot.decir("Hola");
      await bot.decir("¿qué me recomiendas?");
      const segundo = await bot.decir("¿qué me recomiendas para una boda?");
      assert.equal(segundo.respuestas[0], MENSAJE_TRANSFERENCIA_ERROR_TECNICO);
      assert.equal(segundo.aJessica.length, 1);
      assert.equal(bot.entrada()!.modo, "atencion_humana");
    } finally {
      restaurarLogs();
    }
  });
});

describe("H. Citas existentes -- cancelar y reprogramar (siempre con confirmación explícita)", () => {
  it("'ya no voy a poder ir a mi cita' -> muestra SU cita real y pide confirmar; 'sí' -> la cancela de verdad", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({ conCitaExistente: true });
    await bot.decir("Hola");
    const pregunta = await bot.decir("ya no voy a poder ir a mi cita");
    assert.match(pregunta.respuestas.join("\n"), /Cristal/, "muestra la cita REAL (profesional)");
    assert.equal(bot.citaReal()!.estado, "confirmada", "nada se cancela sin confirmar");
    await bot.decir("sí");
    assert.equal(bot.citaReal()!.estado, "cancelada");
  });

  it("'no' a la pregunta de cancelar -> la cita queda INTACTA", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({ conCitaExistente: true });
    await bot.decir("Hola");
    await bot.decir("ya no voy a poder ir a mi cita");
    await bot.decir("no gracias");
    assert.equal(bot.citaReal()!.estado, "confirmada");
    assert.equal(bot.sesion(), null);
  });

  it("'¿puedo cambiarla para otro día?' -> 'sí' -> días REALES de la MISMA profesional -> día -> hora -> 'sí' -> se reprograma esa cita", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({ conCitaExistente: true });
    await bot.decir("Hola");
    await bot.decir("¿puedo cambiarla para otro día?");
    await bot.decir("sí");
    assert.equal(bot.sesion()!.step, "S3_DIA");
    assert.equal(bot.sesion()!.profesional_id, 1263, "una reprogramación nunca cambia de profesional");
    const otroDia = sumarDias(DIA_OBJETIVO, 1);
    const nombreOtroDia = DIAS[new Date(`${otroDia}T12:00:00-05:00`).getDay()]!;
    // Si el día siguiente cae domingo (salón cerrado) se usa el objetivo mismo, a otra hora.
    const dia = nombreOtroDia === "domingo" ? NOMBRE_DIA : nombreOtroDia;
    const fechaElegida = nombreOtroDia === "domingo" ? DIA_OBJETIVO : otroDia;
    await bot.decir(`el ${dia}`);
    assert.equal(bot.sesion()!.step, "S4_HORA");
    await bot.decir("a las 4");
    assert.equal(bot.sesion()!.step, "S5_CONFIRMAR");
    assert.equal(bot.reprogramaciones.length, 0, "nada se mueve sin confirmar");
    await bot.decir("confirmo");
    assert.equal(bot.reprogramaciones.length, 1);
    assert.equal(bot.reprogramaciones[0]!.citaId, 77);
    assert.equal(bot.reprogramaciones[0]!.nuevoInicio.toISOString(), new Date(`${fechaElegida}T16:00:00-05:00`).toISOString());
  });

  it("'mejor con Mary' durante una reprogramación -> NUNCA cambia de profesional", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({ conCitaExistente: true });
    await bot.decir("Hola");
    await bot.decir("¿puedo cambiarla para otro día?");
    await bot.decir("sí");
    await bot.decir("mejor con Mary");
    assert.equal(bot.sesion()!.profesional_id, 1263);
  });
});

describe("I. No repetir información ni caer en 'No reconocí' -- preguntas y datos dichos antes de tiempo", () => {
  const opcionesDe = (sesion: Record<string, unknown> | null) => JSON.stringify(sesion?.opciones_mostradas);

  it("I1 '¿cuánto cuesta el dipping?' eligiendo día -> precio REAL del catálogo, mismo paso y mismas opciones, sin contar como fallo", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    for (const t of ["Quiero una cita", "uñas", "dipping", "con Cristal"]) await bot.decir(t);
    const antes = opcionesDe(bot.sesion());
    const { respuestas } = await bot.decir("¿cuánto cuesta el dipping?");
    assert.match(respuestas[0]!, /Dipping\* cuesta \$60\.000/);
    assert.doesNotMatch(respuestas[0]!, /No reconocí/);
    assert.equal(bot.sesion()!.step, "S3_DIA");
    assert.equal(opcionesDe(bot.sesion()), antes, "el menú de días REALES se conserva tal cual");
    assert.equal(bot.sesion()!.intentos_fallidos_consecutivos, 0);
  });

  it("I2 '¿cuánto demora?' eligiendo hora -> duración del servicio YA elegido (catálogo real)", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    for (const t of ["Quiero una cita", "uñas", "dipping", "Mary", `el ${NOMBRE_DIA}`]) await bot.decir(t);
    const { respuestas } = await bot.decir("¿cuánto demora?");
    assert.match(respuestas[0]!, /Dipping\* dura aproximadamente 120 minutos/);
    assert.equal(bot.sesion()!.step, "S4_HORA");
  });

  it("I3 otra pregunta a mitad de la reserva ('estoy mirando para una boda, ¿qué me recomiendas?') -> la IA responde con datos reales y el menú sigue", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    for (const t of ["Quiero una cita", "uñas", "dipping"]) await bot.decir(t);
    const { respuestas } = await bot.decir("es para una boda, ¿qué me recomiendas?");
    assert.match(respuestas[0]!, /ocasión especial/);
    assert.match(respuestas[0]!, /1\. Mary/);
    assert.equal(bot.sesion()!.step, "S2_PROFESIONAL");
  });

  it("I4 'sí' / 'sí, perfecto' cuando NO se está pidiendo confirmación -> jamás crea una cita ni avanza", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    for (const t of ["Quiero una cita", "uñas", "dipping", "Mary", `el ${NOMBRE_DIA}`]) await bot.decir(t);
    for (const t of ["sí", "sí, perfecto"]) {
      const { respuestas } = await bot.decir(t);
      assert.doesNotMatch(respuestas[0]!, /No reconocí/);
      assert.equal(bot.sesion()!.step, "S4_HORA");
    }
    assert.equal(bot.citas.length, 0);
  });

  it("I5 'quiero con Cristal' ANTES del servicio + 'uñas para el <día>' -> al elegir el servicio va directo a los horarios REALES de Cristal ese día", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot();
    await bot.decir("Quiero una cita");
    const anotado = await bot.decir("quiero con Cristal");
    assert.match(anotado.respuestas[0]!, /Anoto que la quieres con \*Cristal\*/);
    assert.equal(bot.sesion()!.step, "S1_SERVICIO");
    await bot.decir(`uñas para el ${NOMBRE_DIA}`);
    const horas = await bot.decir("dipping");
    assert.equal(bot.sesion()!.step, "S4_HORA", horas.respuestas.join("\n"));
    assert.equal(bot.sesion()!.profesional_id, 1263);
    assert.equal(bot.sesion()!.fecha_iso, DIA_OBJETIVO);
    assert.match(horas.respuestas[0]!, /Con \*Cristal\*/);
  });

  it("I6 primer mensaje '¿tienes disponibilidad el <día>?' (sin servicio) -> se recuerda el día; 'me da igual con quién' -> profesional con ESE día real", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({
      gemini: ({ mensaje }) =>
        /disponibilidad/.test(mensaje) ? { ...consulta(""), intent: "TRIGGER_AGENDA", detectedDateMention: `el ${NOMBRE_DIA}` } : geminiConDatos({ mensaje }),
    });
    const inicio = await bot.decir(`¿tienes disponibilidad el ${NOMBRE_DIA}?`);
    assert.match(inicio.respuestas.join("\n"), /Anoto que la quieres para el/);
    await bot.decir("uñas");
    await bot.decir("dipping");
    assert.equal(bot.sesion()!.step, "S2_PROFESIONAL");
    await bot.decir("me da igual con quién");
    assert.equal(bot.sesion()!.step, "S4_HORA");
    assert.equal(bot.sesion()!.fecha_iso, DIA_OBJETIVO);
  });

  it("I7 día recordado SIN cupo real con la profesional elegida -> lo dice y muestra SUS días reales (nunca lo fuerza)", async () => {
    conNylas(
      calendarioNylas({ libresEn: ["cal-cristal"], ocupados: { "cal-cristal": [{ start: unix(DIA_OBJETIVO, "00:00"), end: unix(DIA_OBJETIVO, "23:59") }] } }),
    );
    const bot = crearBot();
    await bot.decir("Quiero una cita");
    await bot.decir(`uñas para el ${NOMBRE_DIA}`);
    await bot.decir("dipping");
    const { respuestas } = await bot.decir("Cristal");
    assert.equal(bot.sesion()!.step, "S3_DIA");
    assert.match(respuestas[0]!, /no tiene cupo disponible/);
    const ofrecidos = (bot.sesion()!.opciones_mostradas as { opciones: { fechaIso: string }[] }).opciones.map((o) => o.fechaIso);
    assert.ok(!ofrecidos.includes(DIA_OBJETIVO));
  });
});
