/**
 * MODO «SALUDO ÚNICO» de AMORE -- el modo POR DEFECTO del asistente (lib/amore-bot-modo.ts) -- sobre el pipeline ÚNICO de producción (lib/whatsapp-qr-pipeline.ts: atención humana
 * -> registro -> compra -> saludo del primer contacto -> Agenda V2 -> entrada AMORE), con TODO el código real: almacenes reales de sesión/estado/clientes sobre una base EN MEMORIA y
 * la cadena real de Agenda V2. Solo se simula lo que vive fuera del código: las respuestas HTTP de Nylas, el envío por WhatsApp (se capturan los mensajes) y el reloj de las sesiones abandonadas.
 *
 * Lo que debe cumplirse (el pedido de AMORE: «que el bot solo mande el primer mensaje»):
 *   - el saludo del primer contacto sale UNA sola vez;
 *   - después el asistente SOLO habla para: dar el enlace de reserva cuando piden una cita, gestionar SU cita (cancelar / cambiar / consultar) y avisar a una persona cuando la
 *     clienta lo pide -- en todo lo demás se CALLA (lo atiende el equipo);
 *   - nunca llama a la IA ni cae al Flow Engine (que conversaría con IA).
 * Cada llamada a `decir` verifica ese último punto, así que ningún escenario puede olvidarlo.
 *
 * El modo «completo» (la reversa, AMORE_BOT_MODO=completo) se prueba en lib/amore-conversacion-matriz.test.ts, lib/amore-entrada-router.test.ts y lib/agenda-v2/router.test.ts.
 */
delete process.env.AMORE_BOT_MODO; // se prueba el valor POR DEFECTO

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { atenderMensajeWhatsAppQR, type DepsPipelineWhatsAppQR } from "@/lib/whatsapp-qr-pipeline";
import { iniciarNuevaSesionAgendaV2, iniciarGestionCitasAgendaV2, type AgendaV2RouterDeps } from "@/lib/agenda-v2/router";
import { crearSesionAgendaV2 } from "@/lib/agenda-v2/sesiones";
import { saludarPrimerContactoAmore } from "@/lib/amore-entrada-router";
import { modoBotAmore } from "@/lib/amore-bot-modo";
import { ultimoSalienteLoEscribioUnaPersona } from "@/lib/chats/ultimo-saliente";
import { AMORE_TENANT_ID, phoneNumberIdWhatsappQr } from "@/lib/nylas/nylas-grant";
import { AMORE_ESCENARIOS_SEED } from "@/lib/bot-escenarios/seed-amore";
import type { EscenarioRow } from "@/lib/bot-escenarios/tipos";
import { MENSAJE_BIENVENIDA_1, MENSAJE_BIENVENIDA_2, MENSAJE_CONSULTA_LA_ATIENDE_UNA_PERSONA, NUMERO_JESSICA } from "@/lib/amore-entrada-gemini";
import { MENSAJE_RESERVA_POR_ENLACE } from "@/lib/mi-cita/mensajes";
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
// Un día de LUNES A VIERNES (jornada completa): el sábado la jornada simulada se recorta y el domingo no se atiende.
const DIA_OBJETIVO = (() => {
  let d = sumarDias(HOY, 2);
  while ([0, 6].includes(new Date(`${d}T12:00:00-05:00`).getDay())) d = sumarDias(d, 1);
  return d;
})();
const NOMBRE_DIA = DIAS[new Date(`${DIA_OBJETIVO}T12:00:00-05:00`).getDay()]!;

function tablasAmore(clienteRegistrado: boolean): TablasEnMemoria {
  return {
    dulabs_servicios: [
      { id: "s-dipping", id_tenant: T, nombre: "Dipping", precio: 60000, duracion_min: 120, categoria: "Uñas", descripcion: null, activo: true },
      { id: "s-presson", id_tenant: T, nombre: "Press On", precio: 80000, duracion_min: 120, categoria: "Uñas", descripcion: null, activo: true },
    ],
    dulabs_servicio_especialista: ["s-dipping", "s-presson"].flatMap((s) => PROFESIONALES.map((p) => ({ id_tenant: T, servicio_id: s, especialista_id: p.id }))),
    dulabs_especialistas: PROFESIONALES.map((p) => ({ id: p.id, id_tenant: T, nombre: p.nombre, activo: true, nylas_calendar_id: calendario(p.id) })),
    dulabs_bot_conocimiento: [],
    dulabs_horario_especialista: [],
    dulabs_bloqueos: [],
    dulabs_citas_especialista: [],
    dulabs_clientes_conocidos: clienteRegistrado
      ? [{ id: 1, phone_number_id: phoneNumberIdWhatsappQr(T), telefono_cliente: TEL, nombre: "Ana", cumple_dia: 5, cumple_mes: 3 }]
      : [],
    dulabs_agenda_v2_sesiones: [],
    dulabs_amore_entrada: [],
    dulabs_chat_conversaciones: [],
    dulabs_chat_mensajes: [],
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

/** Cita REAL futura de la clienta (Cristal, Dipping) para los casos de cancelar / cambiar / consultar. */
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

interface OpcionesBot {
  clienteRegistrado?: boolean;
  conCitaExistente?: boolean;
  /** Enlace personal de la cita («Mi cita») que el bot agrega al gestionarla; sin esto no se agrega nada. */
  enlaceDeCita?: string;
  /** Sobrescribe las dependencias de la capa del saludo (p. ej. para simular que la base de datos falla). */
  saludoInicial?: NonNullable<DepsPipelineWhatsAppQR["saludoInicial"]>;
  /** Sobrescribe las dependencias de la capa de entrada AMORE. */
  entradaAmore?: NonNullable<DepsPipelineWhatsAppQR["entradaAmore"]>;
}

function crearBot(opciones: OpcionesBot = {}) {
  const tablas = tablasAmore(opciones.clienteRegistrado ?? true);
  if (opciones.conCitaExistente) tablas.dulabs_citas_especialista = [citaExistente()];
  const db = crearSupabaseEnMemoria(tablas, { defaults: DEFAULTS });
  const enviados: { telefono: string; mensaje: string; origen?: string }[] = [];
  const reprogramaciones: { citaId: number; nuevoInicio: Date }[] = [];
  const llamadasIA: unknown[] = [];
  const llamadasFlowEngine: unknown[] = [];
  let desfaseRelojMs = 0;

  const comun = {
    adquirirCandadoChat: async () => true,
    liberarCandadoChat: async () => {},
    enviarMensajeWhatsApp: (async (p: { telefono: string; mensaje: string; origen?: string }) => {
      enviados.push({ telefono: p.telefono, mensaje: p.mensaje, origen: p.origen });
      return { ok: true };
    }) as unknown as AgendaV2RouterDeps["enviarMensajeWhatsApp"],
  };
  const agendaV2: AgendaV2RouterDeps = {
    ...comun,
    permitirReservaPorChat: false,
    ahoraMs: () => Date.now() + desfaseRelojMs,
    sufijoEnlaceCita: async () => (opciones.enlaceDeCita ? `\n\nTambién puedes modificarla o cancelarla desde tu enlace personal:\n${opciones.enlaceDeCita}` : ""),
    cargarEscenariosReal: async (_s, t) => AMORE_ESCENARIOS_SEED.map((e, i) => ({ ...e, id: `${t}-e${i}`, tenantId: t }) as EscenarioRow),
    resolverNylasGrantIdParaTenant: () => "grant-prueba",
    resolveNylasApiKeyFromEnv: () => "clave-prueba",
    hoyIsoParaExtraccion: () => HOY,
    createNylasEventsWriteClient: () => ({ createEvent: async () => ({ id: "evt" }), deleteEvent: async () => {} }),
    guardarNylasEventIdDeCita: async () => {},
    obtenerNylasEventIdDeCita: async () => null,
    borrarNylasEventIdDeCita: async () => {},
    actualizarCitaConNylas: (async (_s: unknown, p: { citaId: number; nuevoInicio: Date }) => {
      reprogramaciones.push({ citaId: p.citaId, nuevoInicio: p.nuevoInicio });
      const cita = { ...citaExistente(), inicio: p.nuevoInicio.toISOString() };
      return { ok: true, cita, nylasEventId: "evt", especialista: { id: 1263, nombre: "Cristal" }, servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 } };
    }) as never,
    // La IA que contesta preguntas a mitad de una reserva NO debe usarse nunca en este modo.
    responderConsultaEnReserva: async (p) => {
      llamadasIA.push(p);
      return null;
    },
  };
  const iniciarAgendaV2 = (p: Parameters<typeof iniciarNuevaSesionAgendaV2>[0]) => iniciarNuevaSesionAgendaV2(p, agendaV2);
  const deps: DepsPipelineWhatsAppQR = {
    atencionHumana: { ...comun },
    registroCliente: { ...comun, iniciarAgendaV2 },
    compraProducto: { ...comun, listarProductosActivos: async () => [] },
    saludoInicial: { ...comun, ...opciones.saludoInicial },
    agendaV2,
    entradaAmore: {
      ...comun,
      iniciarAgendaV2,
      iniciarGestionCitasAgendaV2: (p) => iniciarGestionCitasAgendaV2(p, agendaV2),
      obtenerHistorial: async () => [],
      clasificarConGemini: (async (p: unknown) => {
        llamadasIA.push(p);
        throw new Error("la IA no se usa en el modo «saludo único»");
      }) as never,
      ...opciones.entradaAmore,
    },
    ejecutarBot: (async (p: unknown) => {
      llamadasFlowEngine.push(p);
      return { ok: true };
    }) as never,
  };

  let n = 0;
  async function decir(texto: string, wamid?: string) {
    const antes = enviados.length;
    const r = await atenderMensajeWhatsAppQR({ supabase: db, idTenant: T, telefono: TEL, texto, wamid: wamid ?? `w${++n}` }, deps);
    const nuevos = enviados.slice(antes);
    // Invariante del modo: NUNCA IA y NUNCA Flow Engine, diga lo que diga la clienta.
    assert.equal(llamadasIA.length, 0, `se llamó a la IA con «${texto}»`);
    assert.equal(llamadasFlowEngine.length, 0, `el mensaje «${texto}» cayó al Flow Engine`);
    return {
      r,
      respuestas: nuevos.filter((m) => m.telefono === TEL).map((m) => m.mensaje),
      aJessica: nuevos.filter((m) => m.telefono === NUMERO_JESSICA),
      nuevos,
    };
  }
  const sesion = () => (tablas.dulabs_agenda_v2_sesiones ?? []).find((s) => s.activo) ?? null;
  const sesiones = () => tablas.dulabs_agenda_v2_sesiones ?? [];
  const entrada = () => (tablas.dulabs_amore_entrada ?? [])[0] ?? null;
  const citaReal = () => (tablas.dulabs_citas_especialista ?? []).find((c) => c.id === 77) ?? null;
  /** Hace pasar el tiempo para el reloj de las sesiones de Agenda V2 (sin tocar el reloj del sistema). */
  const avanzarReloj = (ms: number) => {
    desfaseRelojMs += ms;
  };
  /** Como si una persona del equipo (o el asistente) le hubiera escrito a la clienta: lo que el worker guarda en Chats. */
  function registrarSaliente(origen: "humano" | "automatico") {
    const conversaciones = (tablas.dulabs_chat_conversaciones ??= []);
    if (!conversaciones.some((c) => c.id === 9)) conversaciones.push({ id: 9, id_tenant: T, telefono: TEL });
    const mensajes = (tablas.dulabs_chat_mensajes ??= []);
    mensajes.push({ id: mensajes.length + 1, id_tenant: T, conversacion_id: 9, direccion: "saliente", origen, texto: "x" });
  }
  return { decir, db, tablas, sesion, sesiones, entrada, citaReal, reprogramaciones, avanzarReloj, registrarSaliente, enviados, llamadasIA, llamadasFlowEngine };
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
// Todos los calendarios vacíos salvo el de Cristal: un "Turno" marcado LIBRE todos los días.
const AGENDA_NORMAL = () => calendarioNylas({ libresEn: ["cal-cristal"] });

describe("A. Primer contacto -- el saludo, UNA sola vez", () => {
  it("A1 'Hola' -> bienvenida + menú de opciones; la conversación queda esperando su elección", async () => {
    const bot = crearBot();
    const { r, respuestas } = await bot.decir("Hola");
    assert.deepEqual(r, { ok: true, manejadoPor: "entrada_amore" });
    assert.deepEqual(respuestas, [MENSAJE_BIENVENIDA_1, MENSAJE_BIENVENIDA_2]);
    assert.match(respuestas[1]!, /1\. Quiero una cita/);
    assert.equal(bot.entrada()!.modo, "inicio");
  });

  it("A2 su primer mensaje es una PREGUNTA ('¿cuánto cuesta el dipping?') -> solo el saludo y el menú: el asistente no la contesta (la atiende el equipo)", async () => {
    const bot = crearBot();
    const { respuestas } = await bot.decir("¿Cuánto cuesta el dipping?");
    assert.deepEqual(respuestas, [MENSAJE_BIENVENIDA_1, MENSAJE_BIENVENIDA_2]);
    assert.doesNotMatch(respuestas.join("\n"), /\$60\.000/);
  });

  it("A3 'Hola, quiero una cita' (primer mensaje) -> saludo + enlace de reserva, sin menú; no se abre ninguna sesión de reserva por chat", async () => {
    const bot = crearBot();
    const { respuestas } = await bot.decir("Hola, quiero una cita");
    assert.deepEqual(respuestas, [MENSAJE_BIENVENIDA_1, MENSAJE_RESERVA_POR_ENLACE]);
    assert.equal(bot.sesion(), null);
    assert.equal(bot.entrada()!.modo, "gemini", "en este modo 'gemini' significa «ya se la saludó»: no hay IA");
  });

  it("A4 pide la cita con palabras que ninguna lista fija trae ('quisiera una cita para el sábado') -> igual: saludo + enlace", async () => {
    const bot = crearBot();
    const { respuestas } = await bot.decir("Buenas tardes, quisiera una cita para el sábado");
    assert.deepEqual(respuestas, [MENSAJE_BIENVENIDA_1, MENSAJE_RESERVA_POR_ENLACE]);
  });

  it("A5 clienta NUEVA (todavía sin registrar) que pide una cita -> saludo + enlace; NO se le pide nombre ni cumpleaños por el chat", async () => {
    const bot = crearBot({ clienteRegistrado: false });
    const { respuestas } = await bot.decir("Hola quiero una cita");
    assert.deepEqual(respuestas, [MENSAJE_BIENVENIDA_1, MENSAJE_RESERVA_POR_ENLACE]);
    assert.equal(bot.entrada()!.modo, "gemini");
    assert.equal(bot.sesion(), null);
  });

  it("A6 primer mensaje 'quiero cancelar mi cita' -> saludo + SU cita real con la confirmación; 'sí' la cancela", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({ conCitaExistente: true });
    const primero = await bot.decir("Hola, quiero cancelar mi cita");
    assert.equal(primero.respuestas[0], MENSAJE_BIENVENIDA_1);
    assert.match(primero.respuestas.slice(1).join("\n"), /Cristal/);
    assert.equal(bot.citaReal()!.estado, "confirmada", "nada se cancela sin confirmar");
    await bot.decir("sí");
    assert.equal(bot.citaReal()!.estado, "cancelada");
  });

  it("A7 primer mensaje 'quiero cambiar mi cita' sin ninguna cita -> saludo + «No encontré citas» con el enlace", async () => {
    const bot = crearBot();
    const { respuestas } = await bot.decir("quiero cambiar mi cita");
    assert.equal(respuestas[0], MENSAJE_BIENVENIDA_1);
    assert.match(respuestas.slice(1).join("\n"), /No encontré citas/);
  });

  it("A8 el saludo sale UNA sola vez: 'Hola' de nuevo, 'buenos días'… no lo repiten", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    for (const t of ["Hola", "Hola otra vez", "buenos días", "Holaaa", "hola 💗"]) {
      const { respuestas } = await bot.decir(t);
      assert.deepEqual(respuestas, [], t);
    }
    assert.equal(bot.enviados.filter((m) => m.mensaje === MENSAJE_BIENVENIDA_1).length, 1);
  });

  it("A9 el worker reenvía el MISMO mensaje (mismo wamid) -> no se duplica el saludo", async () => {
    const bot = crearBot();
    await bot.decir("Hola", "wamid-fijo");
    const reintento = await bot.decir("Hola", "wamid-fijo");
    assert.deepEqual(reintento.respuestas, []);
    assert.equal(bot.enviados.length, 2, "solo la bienvenida y el menú de la primera vez");
  });

  it("A10 todo lo que envía el asistente sale como 'automatico' y solo hacia la clienta", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    await bot.decir("1");
    assert.ok(bot.enviados.length >= 3);
    for (const m of bot.enviados) {
      assert.equal(m.origen, "automatico");
      assert.equal(m.telefono, TEL);
    }
  });
});

describe("B. Después del saludo el asistente se CALLA", () => {
  const CHARLA = [
    "¿Cuánto cuesta el dipping?",
    "gracias",
    "jajaja",
    "💗",
    "ok",
    "perfecto, gracias",
    "buenos días",
    "estoy mirando uñas para una boda",
    "¿tienen parqueadero?",
    "¿dónde quedan?",
    "Quiero saber qué servicios tienen",
    "me recomiendas algo para un matrimonio?",
    "ya llegué",
    "voy en camino",
    "no voy a poder ir",
    "se me complicó el día",
    "x".repeat(400),
  ];

  it("B1 ni preguntas, ni charla, ni emojis, ni mensajes largos reciben respuesta: cero mensajes, cero IA, cero Flow Engine", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    for (const texto of CHARLA) {
      const { respuestas, r } = await bot.decir(texto);
      assert.deepEqual(respuestas, [], texto.slice(0, 40));
      assert.deepEqual(r, { ok: true, manejadoPor: "entrada_amore" }, texto.slice(0, 40));
    }
    assert.equal(bot.enviados.length, 2, "lo único que se envió en toda la charla fue el saludo y el menú");
  });

  it("B2 el menú es de UNA sola vez: tras 'gracias', el '1' ya no es una opción (silencio)", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    await bot.decir("gracias");
    for (const t of ["1", "2", "3"]) {
      const { respuestas, aJessica } = await bot.decir(t);
      assert.deepEqual(respuestas, [], t);
      assert.equal(aJessica.length, 0, t);
    }
  });

  it("B3 después de cualquier texto la conversación pasa de 'inicio' a 'gemini' y no vuelve atrás", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    assert.equal(bot.entrada()!.modo, "inicio");
    await bot.decir("gracias");
    assert.equal(bot.entrada()!.modo, "gemini");
    await bot.decir("¿cuánto cuesta?");
    assert.equal(bot.entrada()!.modo, "gemini");
  });
});

describe("C. Menú de bienvenida (se contesta una sola vez)", () => {
  it("C1 '1' -> el enlace de reserva; y luego, silencio", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    const { respuestas } = await bot.decir("1");
    assert.deepEqual(respuestas, [MENSAJE_RESERVA_POR_ENLACE]);
    assert.equal(bot.sesion(), null);
    assert.equal(bot.entrada()!.modo, "gemini");
    assert.deepEqual((await bot.decir("gracias")).respuestas, []);
    assert.deepEqual((await bot.decir("1")).respuestas, [], "el menú ya se usó");
  });

  it("C2 '2' (consulta) -> un solo aviso de que una persona del equipo responderá; después, silencio", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    const { respuestas } = await bot.decir("2");
    assert.deepEqual(respuestas, [MENSAJE_CONSULTA_LA_ATIENDE_UNA_PERSONA]);
    for (const t of ["¿cuánto cuesta el dipping?", "gracias", "2"]) {
      assert.deepEqual((await bot.decir(t)).respuestas, [], t);
    }
  });

  it("C3 '3' (hablar con una persona) -> avisa a Jessica y le dice a la clienta que ya se avisó; después, silencio total (atención humana)", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    const { respuestas, aJessica } = await bot.decir("3");
    assert.equal(aJessica.length, 1, "se avisó a Jessica");
    assert.match(respuestas.join("\n"), /Jessica/);
    assert.equal(bot.entrada()!.modo, "atencion_humana");
    const despues = await bot.decir("¿hola?");
    assert.deepEqual(despues.r, { ok: true, manejadoPor: "atencion_humana" });
    assert.deepEqual(despues.respuestas, []);
  });

  it("C4 pedir una persona con palabras ('quiero hablar con una persona') -> lo mismo que el '3'", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    await bot.decir("gracias");
    const { aJessica, respuestas } = await bot.decir("quiero hablar con una persona");
    assert.equal(aJessica.length, 1);
    assert.match(respuestas.join("\n"), /Jessica/);
    assert.equal(bot.entrada()!.modo, "atencion_humana");
  });

  it("C5 si una PERSONA del equipo ya le escribió después del menú, los números son de SU conversación: '1' calla y '3' NO avisa a Jessica", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    bot.registrarSaliente("automatico");
    bot.registrarSaliente("humano");
    const uno = await bot.decir("1");
    assert.deepEqual(uno.respuestas, []);
    assert.equal(bot.entrada()!.modo, "gemini", "el menú queda consumido");
    // Y con el '3' en la misma situación (una conversación nueva de prueba):
    const otro = crearBot();
    await otro.decir("Hola");
    otro.registrarSaliente("humano");
    const tres = await otro.decir("3");
    assert.deepEqual(tres.respuestas, []);
    assert.equal(tres.aJessica.length, 0, "no se molesta a Jessica por una respuesta a la pregunta de una compañera");
    assert.notEqual(otro.entrada()!.modo, "atencion_humana");
  });

  it("C6 si lo último que se le escribió lo mandó el asistente (el menú), el '1' sí es la opción 1", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    bot.registrarSaliente("automatico");
    assert.deepEqual((await bot.decir("1")).respuestas, [MENSAJE_RESERVA_POR_ENLACE]);
  });

  for (const respuesta of ["cita", "una cita", "uno", "opción 1", "1️⃣", "la 1", "agendar", "1."]) {
    it(`C7 el menú respondido con palabras u otras formas de escribir el número («${respuesta}») -> enlace de reserva`, async () => {
      const bot = crearBot();
      await bot.decir("Hola");
      assert.deepEqual((await bot.decir(respuesta)).respuestas, [MENSAJE_RESERVA_POR_ENLACE]);
      assert.equal(bot.sesion(), null);
    });
  }

  for (const respuesta of ["consulta", "Quiero hacer una consulta", "opción 2", "dos", "2️⃣"]) {
    it(`C8 la opción 2 escrita de otra forma («${respuesta}») -> el aviso fijo de la consulta`, async () => {
      const bot = crearBot();
      await bot.decir("Hola");
      assert.deepEqual((await bot.decir(respuesta)).respuestas, [MENSAJE_CONSULTA_LA_ATIENDE_UNA_PERSONA]);
    });
  }

  it("C9 la opción 3 escrita de otra forma ('una persona', 'tres') -> avisa a Jessica", async () => {
    for (const respuesta of ["una persona", "tres", "opción 3"]) {
      const bot = crearBot();
      await bot.decir("Hola");
      const { aJessica } = await bot.decir(respuesta);
      assert.equal(aJessica.length, 1, respuesta);
      assert.equal(bot.entrada()!.modo, "atencion_humana", respuesta);
    }
  });

  it("C10 las palabras de las opciones solo valen con el menú pendiente: después de 'gracias', 'cita' y 'consulta' son silencio", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    await bot.decir("gracias");
    for (const t of ["cita", "una cita", "uno", "consulta", "persona"]) {
      const { respuestas, aJessica } = await bot.decir(t);
      assert.deepEqual(respuestas, [], t);
      assert.equal(aJessica.length, 0, t);
    }
  });

  it("C11 una respuesta al menú que NO es ninguna opción ('2 personas', 'a las 3') la consume y se queda en silencio", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    assert.deepEqual((await bot.decir("2 personas")).respuestas, []);
    assert.equal(bot.entrada()!.modo, "gemini");
    assert.deepEqual((await bot.decir("1")).respuestas, [], "el menú ya se consumió");
  });
});

describe("D. El enlace de reserva cuando dicen que quieren una cita", () => {
  const FRASES_QUE_PIDEN_CITA = [
    "quiero una cita",
    "Quisiera una cita",
    "necesito cita",
    "me gustaría agendar una cita",
    "¿tienen citas disponibles?",
    "¿cómo reservo?",
    "quiero agendar para mañana",
    "me agendas por favor",
    "Hola, buenas tardes. Quiero una cita para manos y pies",
    "kiero una cita",
  ];
  const FRASES_QUE_NO_PIDEN_CITA = ["tengo una cita mañana a las 3", "confirmo mi cita", "gracias por la cita", "¿cuánto cuesta una cita?", "ya no quiero cita", "cita para mañana"];

  it("D1 en plena charla, 'quiero una cita' -> el enlace; y se repite cada vez que lo piden", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    await bot.decir("¿cuánto cuesta el dipping?");
    assert.deepEqual((await bot.decir("quiero una cita")).respuestas, [MENSAJE_RESERVA_POR_ENLACE]);
    assert.deepEqual((await bot.decir("gracias")).respuestas, []);
    assert.deepEqual((await bot.decir("quiero otra cita")).respuestas, [MENSAJE_RESERVA_POR_ENLACE]);
  });

  for (const frase of FRASES_QUE_PIDEN_CITA) {
    it(`D2 «${frase}» -> exactamente el enlace de reserva (un solo mensaje, sin sesión de chat)`, async () => {
      const bot = crearBot();
      await bot.decir("Hola");
      await bot.decir("gracias");
      const { respuestas } = await bot.decir(frase);
      assert.deepEqual(respuestas, [MENSAJE_RESERVA_POR_ENLACE]);
      assert.equal(bot.sesion(), null);
    });
  }

  for (const frase of FRASES_QUE_NO_PIDEN_CITA) {
    it(`D3 «${frase}» -> silencio (no pide una cita nueva)`, async () => {
      const bot = crearBot();
      await bot.decir("Hola");
      await bot.decir("gracias");
      assert.deepEqual((await bot.decir(frase)).respuestas, []);
    });
  }

  it("D4 el enlace sale también cuando el menú sigue pendiente ('Hola' -> 'quiero una cita')", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    assert.equal(bot.entrada()!.modo, "inicio");
    assert.deepEqual((await bot.decir("quiero una cita")).respuestas, [MENSAJE_RESERVA_POR_ENLACE]);
    assert.deepEqual((await bot.decir("gracias")).respuestas, []);
  });
});

describe("E. Sus citas existentes: cancelar, cambiar y consultar siguen funcionando", () => {
  it("E1 'quiero cancelar mi cita' -> muestra SU cita real y pide confirmar; 'sí' -> la cancela de verdad", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({ conCitaExistente: true });
    await bot.decir("Hola");
    const pregunta = await bot.decir("quiero cancelar mi cita");
    assert.match(pregunta.respuestas.join("\n"), /Cristal/, "muestra la cita REAL (profesional)");
    assert.equal(bot.citaReal()!.estado, "confirmada", "nada se cancela sin confirmar");
    await bot.decir("sí");
    assert.equal(bot.citaReal()!.estado, "cancelada");
    assert.equal(bot.sesion(), null);
  });

  it("E2 'no gracias' a la pregunta de cancelar -> la cita queda INTACTA y no queda sesión", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({ conCitaExistente: true });
    await bot.decir("Hola");
    await bot.decir("quiero cancelar mi cita");
    await bot.decir("no gracias");
    assert.equal(bot.citaReal()!.estado, "confirmada");
    assert.equal(bot.sesion(), null);
  });

  it("E3 'quiero cambiar mi cita' -> 'sí' -> días REALES de la MISMA profesional -> día -> hora -> 'confirmo' -> se reprograma esa cita", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({ conCitaExistente: true });
    await bot.decir("Hola");
    await bot.decir("quiero cambiar mi cita");
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

  it("E4 '¿a qué hora es mi cita?' -> muestra SU cita real y su enlace personal «Mi cita»", async () => {
    const bot = crearBot({ conCitaExistente: true, enlaceDeCita: "https://www.dulabs.co/mi-cita/token-de-prueba" });
    await bot.decir("Hola");
    const { respuestas } = await bot.decir("¿a qué hora es mi cita?");
    assert.match(respuestas.join("\n"), /Cristal/);
    assert.match(respuestas.join("\n"), /https:\/\/www\.dulabs\.co\/mi-cita\/token-de-prueba/);
    assert.equal(bot.citaReal()!.estado, "confirmada");
  });
});

describe("F. Sesiones que quedaron abiertas (antes contestaban cualquier mensaje suelto)", () => {
  it("F1 una reserva por chat abandonada (la de antes del enlace) -> 'gracias' NO recibe respuesta y la sesión se cierra en silencio", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    await crearSesionAgendaV2(bot.db, { tenantId: T, telefonoCliente: TEL, wamid: "w-viejo" });
    assert.ok(bot.sesion(), "arranca con una sesión abierta");
    const { respuestas } = await bot.decir("gracias");
    assert.deepEqual(respuestas, []);
    assert.equal(bot.sesion(), null, "la sesión quedó cerrada");
  });

  it("F2 la misma sesión abandonada + 'quiero una cita' -> UN solo enlace (ni dos, ni la reserva guiada)", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    await crearSesionAgendaV2(bot.db, { tenantId: T, telefonoCliente: TEL, wamid: "w-viejo" });
    const { respuestas } = await bot.decir("quiero una cita");
    assert.deepEqual(respuestas, [MENSAJE_RESERVA_POR_ENLACE]);
    assert.equal(bot.sesion(), null);
  });

  it("F3 una gestión de cita ABANDONADA (más de 2 h sin respuesta) -> 'gracias' calla, la sesión se cierra y la cita queda intacta", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({ conCitaExistente: true });
    await bot.decir("Hola");
    await bot.decir("quiero cancelar mi cita");
    assert.equal(bot.sesion()!.step, "SG_CANCELAR_CONFIRMAR");
    bot.avanzarReloj(2 * 60 * 60 * 1000 + 60 * 1000);
    const { respuestas } = await bot.decir("gracias");
    assert.deepEqual(respuestas, []);
    assert.equal(bot.sesion(), null);
    assert.equal(bot.citaReal()!.estado, "confirmada", "no se canceló nada por un 'gracias' tardío");
  });

  it("F4 una gestión de cita RECIENTE (1 h 59 min) NO se toca: 'sí' todavía confirma la cancelación", async () => {
    conNylas(AGENDA_NORMAL());
    const bot = crearBot({ conCitaExistente: true });
    await bot.decir("Hola");
    await bot.decir("quiero cancelar mi cita");
    bot.avanzarReloj(2 * 60 * 60 * 1000 - 60 * 1000);
    await bot.decir("sí");
    assert.equal(bot.citaReal()!.estado, "cancelada");
  });
});

describe("G. Las demás capas y los otros negocios quedan intactos", () => {
  it("G1 otro negocio: la capa del saludo no hace NADA (ni mensajes, ni filas)", async () => {
    const bot = crearBot();
    const enviados: unknown[] = [];
    const r = await saludarPrimerContactoAmore(
      { supabase: bot.db, idTenant: "00000000-0000-0000-0000-00000000dead", telefono: TEL, texto: "Hola", wamid: "w1" },
      {
        adquirirCandadoChat: async () => true,
        liberarCandadoChat: async () => {},
        enviarMensajeWhatsApp: (async (p: unknown) => {
          enviados.push(p);
          return { ok: true };
        }) as never,
      },
    );
    assert.deepEqual(r, { manejado: false });
    assert.equal(enviados.length, 0);
    assert.equal(bot.tablas.dulabs_amore_entrada!.length, 0);
  });

  it("G2 con el interruptor en 'completo' (la reversa) la capa del saludo se aparta: no envía nada ni crea filas", async () => {
    const bot = crearBot();
    const enviados: unknown[] = [];
    const r = await saludarPrimerContactoAmore(
      { supabase: bot.db, idTenant: T, telefono: TEL, texto: "Hola", wamid: "w1" },
      {
        modoBot: "completo",
        adquirirCandadoChat: async () => true,
        liberarCandadoChat: async () => {},
        enviarMensajeWhatsApp: (async (p: unknown) => {
          enviados.push(p);
          return { ok: true };
        }) as never,
      },
    );
    assert.deepEqual(r, { manejado: false });
    assert.equal(enviados.length, 0);
    assert.equal(bot.tablas.dulabs_amore_entrada!.length, 0);
  });

  it("G3 con una persona atendiendo (atención humana, 24 h) el asistente guarda silencio total, también ante 'quiero una cita'", async () => {
    const bot = crearBot();
    await bot.decir("Hola");
    await bot.decir("3");
    const { r, respuestas } = await bot.decir("quiero una cita");
    assert.deepEqual(r, { ok: true, manejadoPor: "atencion_humana" });
    assert.deepEqual(respuestas, []);
  });

  it("G4 si la base de datos falla al leer el estado, el asistente se CALLA (no cae a la IA ni al Flow Engine y no saluda dos veces)", async () => {
    const restaurarLogs = silenciarLogs();
    try {
      const falla = async () => {
        throw new Error("base de datos caída");
      };
      const bot = crearBot({ saludoInicial: { buscarEntrada: falla as never }, entradaAmore: { buscarEntrada: falla as never } });
      const { r, respuestas } = await bot.decir("Hola");
      assert.deepEqual(r, { ok: true, manejadoPor: "entrada_amore" });
      assert.deepEqual(respuestas, []);
      assert.equal(bot.tablas.dulabs_amore_entrada!.length, 0);
    } finally {
      restaurarLogs();
    }
  });
});

describe("H. El interruptor AMORE_BOT_MODO", () => {
  it("H1 sin valor, vacío o con cualquier otra cosa -> 'saludo_unico'; solo 'completo' (sin importar mayúsculas ni espacios) activa la reversa", () => {
    assert.equal(modoBotAmore({}), "saludo_unico");
    assert.equal(modoBotAmore({ AMORE_BOT_MODO: "" }), "saludo_unico");
    assert.equal(modoBotAmore({ AMORE_BOT_MODO: "saludo_unico" }), "saludo_unico");
    assert.equal(modoBotAmore({ AMORE_BOT_MODO: "loquesea" }), "saludo_unico");
    assert.equal(modoBotAmore({ AMORE_BOT_MODO: "completo" }), "completo");
    assert.equal(modoBotAmore({ AMORE_BOT_MODO: "  COMPLETO " }), "completo");
  });

  it("H2 en este proceso la variable no está definida, así que el modo vigente es el de saludo único", () => {
    assert.equal(process.env.AMORE_BOT_MODO, undefined);
    assert.equal(modoBotAmore(), "saludo_unico");
  });
});

describe("I. ¿Una persona del equipo fue la última en escribirle? (lib/chats/ultimo-saliente.ts)", () => {
  const conChats = (mensajes: Record<string, unknown>[], conversaciones: Record<string, unknown>[] = [{ id: 9, id_tenant: T, telefono: TEL }]) =>
    crearSupabaseEnMemoria({ dulabs_chat_conversaciones: conversaciones, dulabs_chat_mensajes: mensajes });
  const pregunta = (db: ReturnType<typeof crearSupabaseEnMemoria>) => ultimoSalienteLoEscribioUnaPersona(db, { idTenant: T, telefono: TEL });
  const saliente = (id: number, origen: string) => ({ id, conversacion_id: 9, direccion: "saliente", origen });
  const entrante = (id: number) => ({ id, conversacion_id: 9, direccion: "entrante", origen: "humano" });

  it("I1 el último saliente es 'humano' -> true; es 'automatico' -> false", async () => {
    assert.equal(await pregunta(conChats([saliente(1, "automatico"), saliente(2, "humano")])), true);
    assert.equal(await pregunta(conChats([saliente(1, "humano"), saliente(2, "automatico")])), false);
  });

  it("I2 los mensajes ENTRANTES no cuentan (lo que escribió la clienta nunca es «una persona del equipo»)", async () => {
    assert.equal(await pregunta(conChats([saliente(1, "automatico"), entrante(2), entrante(3)])), false);
    assert.equal(await pregunta(conChats([entrante(1)])), false);
  });

  it("I3 sin conversación, sin mensajes o de otra clienta -> false", async () => {
    assert.equal(await pregunta(conChats([], [])), false);
    assert.equal(await pregunta(conChats([])), false);
    assert.equal(await pregunta(conChats([saliente(1, "humano")], [{ id: 9, id_tenant: T, telefono: "573000000000" }])), false);
    assert.equal(await pregunta(conChats([{ id: 1, conversacion_id: 77, direccion: "saliente", origen: "humano" }])), false);
  });

  it("I4 si la consulta falla responde false (se asume que no hay una persona conversando) y no lanza", async () => {
    const restaurarLogs = silenciarLogs();
    try {
      const roto = { from: () => { throw new Error("sin conexión"); } } as never;
      assert.equal(await ultimoSalienteLoEscribioUnaPersona(roto, { idTenant: T, telefono: TEL }), false);
    } finally {
      restaurarLogs();
    }
  });
});
