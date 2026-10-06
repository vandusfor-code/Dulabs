import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectarTriggerAgendaDeterminista,
  detectarSolicitudAtencionHumana,
  detectarDespedida,
  detectarNoEntendiRepetir,
  construirMensajeNotificacionJessica,
  clasificarMensajeConGemini,
  MODELO_RESPALDO,
  MODELO_RESPALDO_LITE,
  MENSAJE_PEDIR_PERSONA_EN_RESERVA,
  respuestaDeConsultaEnReserva,
  MAX_TOKENS_SALIDA,
  PLAN_DE_INTENTOS,
  MENSAJE_BIENVENIDA_1,
  MENSAJE_BIENVENIDA_2,
  MENSAJE_MENU_INICIO_INVALIDO,
  MENSAJE_GEMINI_BIENVENIDA,
  MENSAJE_TRANSICION_AGENDA,
  MENSAJE_ERROR_GEMINI,
  MENSAJE_ATENCION_HUMANA_CLIENTE,
  MOTIVO_ATENCION_HUMANA_DEFECTO,
  MENSAJE_DESPEDIDA,
  MENSAJE_NO_ENTENDI_REPETIR,
  NUMERO_JESSICA,
  MENSAJE_MENU_INICIO_ORIENTACION,
  MENSAJE_TRANSFERENCIA_MENU_IGNORADO_CLIENTE,
} from "@/lib/amore-entrada-gemini";
import { GEMINI_DEFAULT_MODEL } from "@/lib/flow/gemini/gemini-client";
import type { GeminiGenerateContentClient, GeminiGenerateContentParams } from "@/lib/flow/gemini/gemini-types";

describe("Textos exactos pedidos", () => {
  it("MENSAJE_BIENVENIDA_1 / MENSAJE_BIENVENIDA_2 (dos mensajes separados, con opción 3)", () => {
    assert.equal(MENSAJE_BIENVENIDA_1, "¡Hola! 💗 Bienvenido/a a AMORE.\n\nEstoy aquí para ayudarte a encontrar el servicio ideal o reservar tu cita.");
    assert.equal(MENSAJE_BIENVENIDA_2, "¿Qué deseas hacer?\n\n1. Quiero una cita\n2. Quiero hacer una consulta\n3. Hablar con una persona");
  });

  it("MENSAJE_MENU_INICIO_INVALIDO también ofrece la opción 3", () => {
    assert.match(MENSAJE_MENU_INICIO_INVALIDO, /3\. Hablar con una persona/);
  });

  it("Protección contra ciclo (autorizado) -- MENSAJE_MENU_INICIO_ORIENTACION mantiene la MISMA numeración 1/2/3 y ofrece el atajo humano", () => {
    assert.match(MENSAJE_MENU_INICIO_ORIENTACION, /1\. Quiero una cita/);
    assert.match(MENSAJE_MENU_INICIO_ORIENTACION, /2\. Quiero hacer una consulta/);
    assert.match(MENSAJE_MENU_INICIO_ORIENTACION, /3\. Hablar con una persona/);
    assert.match(MENSAJE_MENU_INICIO_ORIENTACION, /también puedo comunicarte directamente con alguien/);
  });

  it("Protección contra ciclo (autorizado) -- MENSAJE_TRANSFERENCIA_MENU_IGNORADO_CLIENTE es distinto de MENSAJE_ATENCION_HUMANA_CLIENTE", () => {
    assert.notEqual(MENSAJE_TRANSFERENCIA_MENU_IGNORADO_CLIENTE, MENSAJE_ATENCION_HUMANA_CLIENTE);
    assert.match(MENSAJE_TRANSFERENCIA_MENU_IGNORADO_CLIENTE, /comunicar con alguien de nuestro equipo/);
  });

  it("MENSAJE_GEMINI_BIENVENIDA / MENSAJE_TRANSICION_AGENDA", () => {
    assert.equal(MENSAJE_GEMINI_BIENVENIDA, "Claro 💗 Cuéntame, ¿qué te gustaría saber?");
    assert.equal(MENSAJE_TRANSICION_AGENDA, "Perfecto 💗 Vamos a agendar tu cita."); // constante conservada; ya no se envía (la reserva por chat se retiró)
  });

  it("MENSAJE_ATENCION_HUMANA_CLIENTE -- texto exacto pedido", () => {
    assert.equal(
      MENSAJE_ATENCION_HUMANA_CLIENTE,
      "Entiendo que quieres hablar directamente con Jessica. 💗\nYa le notifiqué que deseas comunicarte con ella. En un momento te responderá directamente.",
    );
  });

  it("NUMERO_JESSICA -- normalizado con indicativo de país (57), nunca el número corto dado", () => {
    assert.equal(NUMERO_JESSICA, "573227298600");
  });
});

describe("Detección determinística de atención humana -- detectarSolicitudAtencionHumana", () => {
  it("reconoce las frases explícitas reales del pedido", () => {
    const frases = [
      "quiero hablar con jessica",
      "me gustaría hablar con Jessica",
      "necesito hablar con Jessica",
      "pásame con Jessica",
      "quiero hablar con una persona",
      "necesito hablar con alguien",
      "quiero hablar con alguien de AMORE",
      "prefiero hablar con una persona",
      "necesito que Jessica me atienda",
      "quiero hablar directamente con alguien",
      "quiero hablar directamente con Jessica",
    ];
    for (const frase of frases) {
      assert.equal(detectarSolicitudAtencionHumana(frase), true, `"${frase}" debía activar atención humana`);
    }
  });

  it("NUNCA activa por menciones/preguntas que no piden hablar con alguien", () => {
    for (const frase of ["¿Jessica hace maquillaje?", "¿Qué profesionales tienen?", "Jessica es muy buena", "Quiero una cita", "Hola"]) {
      assert.equal(detectarSolicitudAtencionHumana(frase), false, `"${frase}" NUNCA debía activar atención humana`);
    }
  });

  it("Corrección post-deploy (auditoría real) -- reconoce las formas cortas SIN verbo inicial, tal como las escribe un cliente real", () => {
    const positivos = [
      "Hablar con Jessica",
      "quiero hablar con Jessica",
      "Hablar con una persona",
      "quiero hablar con una persona",
      "Hablar con alguien",
      "Necesito hablar con alguien",
      "Hablar con alguien de AMORE",
    ];
    for (const frase of positivos) {
      assert.equal(detectarSolicitudAtencionHumana(frase), true, `"${frase}" debía activar atención humana`);
    }
  });

  it("Corrección post-deploy (auditoría real) -- los negativos importantes siguen sin activar atención humana", () => {
    const negativos = [
      "¿Jessica hace maquillaje?",
      "¿Qué profesionales tienen?",
      "¿Jessica atiende uñas?",
      "¿Tienen a Jessica disponible?",
      "Quiero información sobre Jessica",
    ];
    for (const frase of negativos) {
      assert.equal(detectarSolicitudAtencionHumana(frase), false, `"${frase}" NUNCA debía activar atención humana`);
    }
  });

  it("Hallazgo con Gemini real -- variantes «hablar con un/una …» (asesor, humano, agente) también activan la atención humana; las menciones sueltas NO", () => {
    const si = [
      "necesito hablar con un asesor humano",
      "quiero hablar con un asesor",
      "Hablar con una asesora",
      "quiero hablar con un humano",
      "¿puedo hablar con un agente?",
      "pásame con un agente humano",
      "quiero una persona de verdad",
    ];
    for (const frase of si) assert.equal(detectarSolicitudAtencionHumana(frase), true, `"${frase}" debía activar atención humana`);
    const no = ["¿tienen asesor de imagen?", "Mary es muy buena asesora", "¿el agente de ventas de Jessica?", "me atendió un humano muy amable ayer, gracias", "¿qué es un humectante?"];
    for (const frase of no) assert.equal(detectarSolicitudAtencionHumana(frase), false, `"${frase}" NUNCA debía activar atención humana`);
  });

  it("Glosario de intenciones AMORE (autorizado) -- nuevas frases reales de HABLAR_CON_ASESOR", () => {
    const frases = [
      "quiero atención humana",
      "necesito una asesora",
      "puedo hablar con alguien",
      "comuníquenme con alguien",
      "pásame con una persona",
      "no quiero hablar con el bot",
      "no quiero hablar con un robot",
      "quiero hablar con la encargada",
      "quiero hablar con recepción",
      "quiero servicio al cliente",
    ];
    for (const frase of frases) {
      assert.equal(detectarSolicitudAtencionHumana(frase), true, `"${frase}" debía activar atención humana`);
    }
  });
});

describe("construirMensajeNotificacionJessica", () => {
  it("formato exacto con nombre y teléfono reales", () => {
    const mensaje = construirMensajeNotificacionJessica({ nombre: "María", telefono: "573148127388" });
    assert.equal(
      mensaje,
      "AMORE – Cliente requiere atención\n\nCliente: María\nWhatsApp: 573148127388\nMotivo: Solicita atención directa.\n\nLa clienta solicita atención directa. Por favor, revisa la conversación.",
    );
  });

  it("nombre null -- usa 'Cliente Nuevo', nunca inventa un nombre", () => {
    const mensaje = construirMensajeNotificacionJessica({ nombre: null, telefono: "573148127388" });
    assert.match(mensaje, /Cliente: Cliente Nuevo/);
  });

  it("motivo por defecto cuando no se pasa uno -- nunca se llama a Gemini para resumirlo", () => {
    const mensaje = construirMensajeNotificacionJessica({ nombre: "María", telefono: "573148127388" });
    assert.match(mensaje, new RegExp(`Motivo: ${MOTIVO_ATENCION_HUMANA_DEFECTO}`));
  });
});

describe("FAST TRACK DETERMINISTA -- detectarTriggerAgendaDeterminista", () => {
  it("Test 5/6/7/8 -- reconoce las frases inequívocas reales del pedido", () => {
    for (const frase of ["quiero una cita", "quiero agendar", "quiero reservar", "quiero apartar una cita", "me puedes agendar", "quiero reservarlo", "quiero agendarlo"]) {
      assert.equal(detectarTriggerAgendaDeterminista(frase), true, `"${frase}" debía disparar TRIGGER_AGENDA determinista`);
    }
  });

  it("coincide en medio de una frase real (contains), insensible a mayúsculas/acentos", () => {
    assert.equal(detectarTriggerAgendaDeterminista("Hola, quiero agendar por favor"), true);
    assert.equal(detectarTriggerAgendaDeterminista("ME INTERESA, QUIERO AGENDARLO YA"), true);
  });

  it("Test 9/10/11 -- NUNCA activa por la palabra 'cita' sola -- estos siguen siendo CONSULTA", () => {
    for (const frase of ["¿Cuánto cuesta una cita?", "¿Qué horarios tienen para citas?", "¿Atienden citas los sábados?", "Hola", "¿qué servicios tienen?"]) {
      assert.equal(detectarTriggerAgendaDeterminista(frase), false, `"${frase}" NUNCA debía disparar el fast track`);
    }
  });

  it("Glosario de intenciones AMORE (autorizado) -- nuevas frases reales de RESERVAR_CITA, incluidos errores/abreviaciones", () => {
    const frases = [
      "quiero sacar una cita",
      "quiero pedir cita",
      "necesito una cita",
      "me gustaría tener una cita",
      "quisiera reservar una cita",
      "me ayudas a sacar una cita",
      "me colaboras con una cita",
      "me pueden agendar",
      "qiero una cita",
      "kiero agendar",
      "quiero agendar una sita",
    ];
    for (const frase of frases) {
      assert.equal(detectarTriggerAgendaDeterminista(frase), true, `"${frase}" debía disparar TRIGGER_AGENDA determinista`);
    }
  });
});

describe("NUEVA FASE (autorizado) -- detectarDespedida / detectarNoEntendiRepetir (glosario AMORE, secciones 19/20)", () => {
  it("MENSAJE_DESPEDIDA / MENSAJE_NO_ENTENDI_REPETIR son cordiales y nunca vacíos", () => {
    assert.match(MENSAJE_DESPEDIDA, /💗/);
    assert.match(MENSAJE_NO_ENTENDI_REPETIR, /💗/);
  });

  it("detectarDespedida reconoce frases reales del glosario, insensible a mayúsculas/acentos/signos", () => {
    const frases = [
      "gracias",
      "Gracias",
      "GRACIAS!",
      "muchas gracias",
      "mil gracias",
      "te agradezco",
      "gracias por todo",
      "eso era todo",
      "listo gracias",
      "hasta luego",
      "hasta pronto",
      "chao",
      "chau",
      "nos vemos",
      "feliz día",
      "bendiciones",
      "¡Dios les bendiga!",
    ];
    for (const frase of frases) {
      assert.equal(detectarDespedida(frase), true, `"${frase}" debía reconocerse como DESPEDIDA`);
    }
  });

  it("detectarDespedida exige el mensaje COMPLETO -- nunca 'contains' -- para evitar falsos positivos con otra intención real", () => {
    const frases = [
      "gracias, ¿cuánto cuesta el manicure?",
      "gracias, pero antes quiero saber los horarios",
      "hola",
      "quiero agendar una cita",
      "listo, quiero una cita para mañana",
      "",
      "   ",
    ];
    for (const frase of frases) {
      assert.equal(detectarDespedida(frase), false, `"${frase}" NUNCA debía reconocerse como DESPEDIDA`);
    }
  });

  it("detectarNoEntendiRepetir reconoce frases reales del glosario, insensible a mayúsculas/acentos/signos", () => {
    const frases = ["no entendí", "No Entiendo", "¿Cómo así?", "que?", "como", "explícame", "no comprendí", "no me quedó claro", "otra vez", "de nuevo", "¿repíteme?"];
    for (const frase of frases) {
      assert.equal(detectarNoEntendiRepetir(frase), true, `"${frase}" debía reconocerse como NO_ENTENDI_REPETIR`);
    }
  });

  it("detectarNoEntendiRepetir exige el mensaje COMPLETO -- nunca 'contains' -- para evitar falsos positivos con otra intención real", () => {
    const frases = [
      "¿qué precio tiene el manicure?",
      "¿cómo puedo pagar?",
      "hola, ¿qué servicios tienen?",
      "quiero agendar",
      "",
      "   ",
    ];
    for (const frase of frases) {
      assert.equal(detectarNoEntendiRepetir(frase), false, `"${frase}" NUNCA debía reconocerse como NO_ENTENDI_REPETIR`);
    }
  });
});

const sinEspera = async () => {};

function crearFakeGeminiClient(respuesta: unknown): GeminiGenerateContentClient {
  return {
    async generateContent() {
      return { text: JSON.stringify(respuesta) };
    },
  };
}

describe("clasificarMensajeConGemini -- salida estructurada, nunca crea/modifica/cancela citas", () => {
  it("intent=CONSULTA devuelve el reply_text real de Gemini", async () => {
    const resultado = await clasificarMensajeConGemini(
      { mensaje: "¿Cuánto cuesta el sombreado?" },
      { geminiClient: crearFakeGeminiClient({ intent: "CONSULTA", reply_text: "El sombreado tiene distintos precios según...", detected_service_mention: "sombreado" }), resolveApiKey: () => "fake-key" },
    );
    assert.equal(resultado.intent, "CONSULTA");
    assert.equal(resultado.replyText, "El sombreado tiene distintos precios según...");
    assert.equal(resultado.detectedServiceMention, "sombreado");
  });

  it("Test 12 -- intent=TRIGGER_AGENDA cuando el cliente confirma que sí quiere agendar", async () => {
    const resultado = await clasificarMensajeConGemini(
      { mensaje: "Sí", historial: [{ role: "model", text: "¿Quieres agendar?" }] },
      { geminiClient: crearFakeGeminiClient({ intent: "TRIGGER_AGENDA", reply_text: "texto ignorado", detected_service_mention: null }), resolveApiKey: () => "fake-key" },
    );
    assert.equal(resultado.intent, "TRIGGER_AGENDA");
  });

  it("detected_service_mention ausente/null se resuelve como null, nunca inventado", async () => {
    const resultado = await clasificarMensajeConGemini(
      { mensaje: "¿Qué servicios tienen?" },
      { geminiClient: crearFakeGeminiClient({ intent: "CONSULTA", reply_text: "Tenemos varios servicios..." }), resolveApiKey: () => "fake-key" },
    );
    assert.equal(resultado.detectedServiceMention, null);
  });

  it("sin GEMINI_KEY configurada -- nunca lanza, responde CONSULTA con mensaje de error genérico (fail-safe)", async () => {
    const resultado = await clasificarMensajeConGemini({ mensaje: "hola" }, { resolveApiKey: () => null });
    assert.equal(resultado.intent, "CONSULTA");
    assert.equal(resultado.replyText, MENSAJE_ERROR_GEMINI);
  });

  it("Gemini lanza una excepción real (red/HTTP) -- nunca se propaga, responde CONSULTA con mensaje de error genérico", async () => {
    const clienteQueLanza: GeminiGenerateContentClient = {
      async generateContent() {
        throw new Error("gemini_http_500");
      },
    };
    const resultado = await clasificarMensajeConGemini({ mensaje: "hola" }, { geminiClient: clienteQueLanza, resolveApiKey: () => "fake-key", esperar: sinEspera });
    assert.equal(resultado.intent, "CONSULTA");
    assert.equal(resultado.replyText, MENSAJE_ERROR_GEMINI);
  });

  it("salida fuera del enum ('OTRO') -- nunca se acepta, responde CONSULTA con mensaje de error genérico (fail-safe, nunca dispara Agenda V2 por error)", async () => {
    const resultado = await clasificarMensajeConGemini(
      { mensaje: "hola" },
      { geminiClient: crearFakeGeminiClient({ intent: "OTRO", reply_text: "algo" }), resolveApiKey: () => "fake-key", esperar: sinEspera },
    );
    assert.equal(resultado.intent, "CONSULTA");
    assert.equal(resultado.replyText, MENSAJE_ERROR_GEMINI);
  });

  it("JSON malformado -- nunca lanza, responde CONSULTA con mensaje de error genérico", async () => {
    const clienteMalformado: GeminiGenerateContentClient = {
      async generateContent() {
        return { text: "esto no es JSON" };
      },
    };
    const resultado = await clasificarMensajeConGemini({ mensaje: "hola" }, { geminiClient: clienteMalformado, resolveApiKey: () => "fake-key", esperar: sinEspera });
    assert.equal(resultado.intent, "CONSULTA");
  });

  it("reply_text ausente/no-string -- fuera del schema, responde CONSULTA con mensaje de error genérico", async () => {
    const resultado = await clasificarMensajeConGemini(
      { mensaje: "hola" },
      { geminiClient: crearFakeGeminiClient({ intent: "CONSULTA" }), resolveApiKey: () => "fake-key", esperar: sinEspera },
    );
    assert.equal(resultado.intent, "CONSULTA");
    assert.equal(resultado.replyText, MENSAJE_ERROR_GEMINI);
  });

  // NUEVA FASE (autorizado, reconocimiento semántico/contextual de
  // CANCELAR_CITA/REPROGRAMAR_CITA) -- clasificarMensajeConGemini es un
  // boundary puro (parsea/valida lo que Gemini responda); el razonamiento
  // semántico real ("¿propone otra fecha o no?") lo hace el modelo, no
  // testeable sin red real. Acá se prueba que el CONTRATO (enum, parseo,
  // fail-safe) acepta las 2 categorías nuevas igual que ya hacía con
  // TRIGGER_AGENDA, y que el prompt real que se envía SÍ documenta la regla
  // de ambigüedad del pedido (ver también los tests de router/entrada-router
  // para la integración end-to-end con fakes deterministas).
  it("intent=CANCELAR_CITA se acepta y se devuelve tal cual (Gemini detectó una variante ambigua/indirecta)", async () => {
    const resultado = await clasificarMensajeConGemini(
      { mensaje: "vea que no alcanzo a llegar" },
      { geminiClient: crearFakeGeminiClient({ intent: "CANCELAR_CITA", reply_text: "texto ignorado" }), resolveApiKey: () => "fake-key" },
    );
    assert.equal(resultado.intent, "CANCELAR_CITA");
  });

  it("intent=REPROGRAMAR_CITA se acepta y se devuelve tal cual (Gemini detectó que SÍ propone otra fecha/hora)", async () => {
    const resultado = await clasificarMensajeConGemini(
      { mensaje: "no puedo ir mañana, ¿la pasamos para el viernes?" },
      { geminiClient: crearFakeGeminiClient({ intent: "REPROGRAMAR_CITA", reply_text: "texto ignorado" }), resolveApiKey: () => "fake-key" },
    );
    assert.equal(resultado.intent, "REPROGRAMAR_CITA");
  });

  it("intent=ATENCION_HUMANA se acepta (Gemini detectó que la clienta pide o acepta hablar con una persona) y se devuelve tal cual", async () => {
    const resultado = await clasificarMensajeConGemini(
      { mensaje: "¿me puede atender alguien del salón?" },
      { geminiClient: crearFakeGeminiClient({ intent: "ATENCION_HUMANA", reply_text: "ignorado" }), resolveApiKey: () => "fake-key" },
    );
    assert.equal(resultado.intent, "ATENCION_HUMANA");
    assert.equal(resultado.errorTecnico, undefined);
  });

  it("el system prompt real prohíbe PROMETER contacto humano (solo sucede con intent=ATENCION_HUMANA), no negar lo que no sabe y no saludar en cada mensaje", async () => {
    let sistema = "";
    const cliente: GeminiGenerateContentClient = {
      async generateContent(req) {
        sistema = req.systemInstruction;
        return { text: JSON.stringify({ intent: "CONSULTA", reply_text: "ok" }) };
      },
    };
    await clasificarMensajeConGemini({ mensaje: "hola" }, { geminiClient: cliente, resolveApiKey: () => "fake-key" });
    assert.match(sistema, /ATENCION_HUMANA: la clienta pide hablar con una persona/);
    assert.match(sistema, /NUNCA digas ni insinúes que una persona se va a comunicar con ella/);
    assert.match(sistema, /NO digas que no existe ni que no hay/);
    assert.match(sistema, /NO empieces tus mensajes con «¡Hola!»/);
    assert.match(sistema, /una de estas cinco categorías/);
  });

  it("el system prompt real enviado a Gemini documenta la regla de ambigüedad cancelar vs reprogramar", async () => {
    let systemInstructionRecibido: string | undefined;
    const cliente: GeminiGenerateContentClient = {
      async generateContent(req) {
        systemInstructionRecibido = req.systemInstruction;
        return { text: JSON.stringify({ intent: "CONSULTA", reply_text: "ok" }) };
      },
    };
    await clasificarMensajeConGemini({ mensaje: "no puedo ir" }, { geminiClient: cliente, resolveApiKey: () => "fake-key" });
    assert.match(systemInstructionRecibido ?? "", /CANCELAR_CITA/);
    assert.match(systemInstructionRecibido ?? "", /REPROGRAMAR_CITA/);
    assert.match(systemInstructionRecibido ?? "", /¿Quieres cancelar tu cita o prefieres cambiarla para otro día\?/);
  });
});

describe("Fase 1 (autorizado) -- el historial real llega tal cual a Gemini (contents), nunca se recorta ni se reordena en este boundary", () => {
  it("el historial pasado se manda en el mismo orden dentro de contents, antes del mensaje actual", async () => {
    let contenidosRecibidos: unknown;
    const cliente: GeminiGenerateContentClient = {
      async generateContent(req) {
        contenidosRecibidos = req.contents;
        return { text: JSON.stringify({ intent: "CONSULTA", reply_text: "ok", detected_service_mention: null }) };
      },
    };
    const historial = [
      { role: "user" as const, text: "Hola, me gustaría averiguar por un maquillaje y peinado" },
      { role: "model" as const, text: "¿Tienes alguna fecha o evento especial en mente?" },
      { role: "user" as const, text: "Si me graduó el 20 de septiembre" },
      { role: "model" as const, text: "¿Te gustaría conocer nuestras opciones o recomendaciones para tu evento?" },
    ];
    await clasificarMensajeConGemini({ mensaje: "Si porfa", historial }, { geminiClient: cliente, resolveApiKey: () => "fake-key" });
    assert.deepEqual(contenidosRecibidos, [...historial, { role: "user", text: "Si porfa" }]);
  });

  it("Test 21-A -- 'Sí porfa' tras una pregunta informativa se resuelve CONSULTA (simulando el criterio real del prompt endurecido)", async () => {
    // No se puede probar el razonamiento real de Gemini sin llamarlo de
    // verdad -- se prueba el boundary honestamente: dado que el prompt YA
    // exige mirar el último turno del historial, un fake que representa la
    // respuesta correcta esperada para este caso real confirma que el
    // resultado se propaga tal cual, sin que este archivo le agregue ni le
    // quite nada.
    const resultado = await clasificarMensajeConGemini(
      {
        mensaje: "Si porfa",
        historial: [{ role: "model", text: "¿Te gustaría conocer nuestras opciones o recomendaciones para tu evento?" }],
      },
      { geminiClient: crearFakeGeminiClient({ intent: "CONSULTA", reply_text: "Claro, te cuento nuestras opciones...", detected_service_mention: null }), resolveApiKey: () => "fake-key" },
    );
    assert.equal(resultado.intent, "CONSULTA");
  });

  it("Test 21-A -- 'Sí por favor' tras '¿Quieres que te ayude a reservar?' se resuelve TRIGGER_AGENDA", async () => {
    const resultado = await clasificarMensajeConGemini(
      { mensaje: "Sí por favor", historial: [{ role: "model", text: "¿Quieres que te ayude a reservar una cita?" }] },
      { geminiClient: crearFakeGeminiClient({ intent: "TRIGGER_AGENDA", reply_text: "ignorado", detected_service_mention: null }), resolveApiKey: () => "fake-key" },
    );
    assert.equal(resultado.intent, "TRIGGER_AGENDA");
  });

  it("historial vacío/ausente no rompe la clasificación", async () => {
    const resultado = await clasificarMensajeConGemini(
      { mensaje: "¿Cuánto cuesta?" },
      { geminiClient: crearFakeGeminiClient({ intent: "CONSULTA", reply_text: "Depende del servicio...", detected_service_mention: null }), resolveApiKey: () => "fake-key" },
    );
    assert.equal(resultado.intent, "CONSULTA");
  });
});

describe("Resiliencia ante el proveedor -- causa raíz de los «problema técnico» medidos con Gemini real (503, JSON cortado por el tope de tokens, latencia)", () => {
  const RESPUESTA_OK = JSON.stringify({ intent: "CONSULTA", reply_text: "El dipping cuesta $60.000 💗", detected_service_mention: "dipping" });
  const error = (status: number) => Object.assign(new Error(`gemini_http_${status}: UNAVAILABLE`), { status });
  type Paso = "ok" | "cortado" | "vacio" | "colgado" | number | Error;

  /** Cliente que responde según un guion (un elemento por llamada) y registra con qué parámetros se le llamó y si la llamada fue cancelada. */
  function clienteConGuion(guion: Paso[]) {
    const llamadas: Array<{ params: GeminiGenerateContentParams; signal?: AbortSignal }> = [];
    const cliente: GeminiGenerateContentClient = {
      generateContent(params, signal) {
        llamadas.push({ params, signal });
        const paso = guion[llamadas.length - 1] ?? "ok";
        if (paso === "ok") return Promise.resolve({ text: RESPUESTA_OK, finishReason: "STOP" });
        if (paso === "cortado") return Promise.resolve({ text: '{\n  "intent": "CONSULTA",\n  "reply_te', finishReason: "MAX_TOKENS" });
        if (paso === "vacio") return Promise.resolve({ text: null });
        if (paso === "colgado") {
          // No responde nunca por sí sola: solo termina cuando la cancelan (por ganador o por tiempo máximo).
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
          });
        }
        return Promise.reject(typeof paso === "number" ? error(paso) : paso);
      },
    };
    return { cliente, llamadas };
  }
  /** Sin esperas ni refuerzo en paralelo (determinista): los intentos corren uno tras otro, solo cuando el anterior falla. */
  const dependencias = (cliente: GeminiGenerateContentClient, extra: Record<string, unknown> = {}) => ({
    geminiClient: cliente,
    resolveApiKey: () => "fake-key",
    esperar: sinEspera,
    refuerzoMs: Infinity,
    ...extra,
  });

  it("camino feliz: UNA sola llamada, al modelo principal, con pensamiento mínimo, tope de tokens holgado y un tiempo máximo", async () => {
    const { cliente, llamadas } = clienteConGuion(["ok"]);
    const r = await clasificarMensajeConGemini({ mensaje: "¿cuánto cuesta el dipping?" }, dependencias(cliente));
    assert.equal(r.errorTecnico, undefined);
    assert.equal(r.replyText, "El dipping cuesta $60.000 💗");
    assert.equal(llamadas.length, 1);
    const p = llamadas[0]!.params;
    assert.equal(p.model, GEMINI_DEFAULT_MODEL);
    assert.equal(p.thinkingLevel, "minimal", "clasificar y redactar 2 líneas no necesita razonar: 12-14 s -> 1,5 s medido");
    assert.ok(p.maxOutputTokens >= 2048, `el tope (${p.maxOutputTokens}) debe cubrir el JSON aunque el modelo piense: con 500 el JSON salía cortado`);
    assert.equal(p.maxOutputTokens, MAX_TOKENS_SALIDA);
    assert.ok(llamadas[0]!.signal instanceof AbortSignal, "cada intento tiene un tiempo máximo");
  });

  it("503 «high demand» del modelo principal -> se atiende con el modelo de respaldo, la clienta nunca ve el error", async () => {
    const { cliente, llamadas } = clienteConGuion([503, "ok"]);
    const r = await clasificarMensajeConGemini({ mensaje: "¿cuánto cuesta el dipping?" }, dependencias(cliente));
    assert.equal(r.errorTecnico, undefined);
    assert.equal(r.replyText, "El dipping cuesta $60.000 💗");
    assert.deepEqual(llamadas.map((l) => l.params.model), [GEMINI_DEFAULT_MODEL, MODELO_RESPALDO]);
    assert.equal(llamadas[1]!.params.thinkingLevel, undefined, "gemini-2.5 NO admite thinkingLevel (lo rechazaría con 400)");
    assert.equal(llamadas[1]!.params.maxOutputTokens, MAX_TOKENS_SALIDA);
  });

  it("JSON cortado por el tope de tokens (finishReason=MAX_TOKENS) -> se reintenta en vez de mandarle a la clienta «problema técnico»", async () => {
    const { cliente, llamadas } = clienteConGuion(["cortado", "ok"]);
    const r = await clasificarMensajeConGemini({ mensaje: "tengo una boda, ¿qué me recomiendas?" }, dependencias(cliente));
    assert.equal(r.errorTecnico, undefined);
    assert.equal(llamadas.length, 2);
  });

  it("respuesta vacía, error de red y 429 también pasan al siguiente intento", async () => {
    for (const fallo of ["vacio", new TypeError("fetch failed"), 429] as const) {
      const { cliente, llamadas } = clienteConGuion([fallo, "ok"]);
      const r = await clasificarMensajeConGemini({ mensaje: "hola" }, dependencias(cliente));
      assert.equal(r.errorTecnico, undefined, String(fallo));
      assert.deepEqual(llamadas.map((l) => l.params.model), [GEMINI_DEFAULT_MODEL, MODELO_RESPALDO]);
    }
  });

  it("el plan recorre modelos DISTINTOS (principal -> respaldo estable -> otra familia -> principal) y todos devuelven la misma clasificación válida", async () => {
    const { cliente, llamadas } = clienteConGuion([503, 503, 503, "ok"]);
    const r = await clasificarMensajeConGemini({ mensaje: "hola" }, dependencias(cliente));
    assert.equal(r.errorTecnico, undefined);
    assert.deepEqual(llamadas.map((l) => l.params.model), [GEMINI_DEFAULT_MODEL, MODELO_RESPALDO, MODELO_RESPALDO_LITE, GEMINI_DEFAULT_MODEL]);
    assert.deepEqual(PLAN_DE_INTENTOS.map((i) => i.model), [GEMINI_DEFAULT_MODEL, MODELO_RESPALDO, MODELO_RESPALDO_LITE, GEMINI_DEFAULT_MODEL]);
    assert.equal(new Set(PLAN_DE_INTENTOS.slice(0, 3).map((i) => i.model)).size, 3, "los 3 primeros intentos usan modelos distintos (no comparten saturación)");
    const { cliente: c3, llamadas: l3 } = clienteConGuion([503, 503, "ok"]);
    const r3 = await clasificarMensajeConGemini({ mensaje: "hola" }, dependencias(c3));
    assert.equal(r3.errorTecnico, undefined);
    assert.equal(l3[2]!.params.model, MODELO_RESPALDO_LITE);
    assert.equal(l3[2]!.params.thinkingLevel, undefined, "solo el principal lleva thinkingLevel");
  });

  it("si TODOS los intentos fallan -> mensaje genérico marcado como error técnico (así el router escala a una persona al segundo seguido), y nunca más de 4 llamadas", async () => {
    const { cliente, llamadas } = clienteConGuion([503, 503, 503, 503, 503, 503]);
    const r = await clasificarMensajeConGemini({ mensaje: "hola" }, dependencias(cliente));
    assert.equal(r.errorTecnico, true);
    assert.equal(r.intent, "CONSULTA");
    assert.equal(r.replyText, MENSAJE_ERROR_GEMINI);
    assert.equal(llamadas.length, PLAN_DE_INTENTOS.length);
    assert.equal(llamadas.length, 4);
  });

  it("un 401/403 de UN modelo (p. ej. la clave no tiene permiso para el modelo de respaldo) NO corta el plan: el siguiente intento sigue y puede atender a la clienta", async () => {
    for (const fallo of [error(403), error(401), new Error("gemini_http_404: models/gemini-3.1-flash-lite is not found")]) {
      const { cliente, llamadas } = clienteConGuion([503, fallo, "ok"]);
      const r = await clasificarMensajeConGemini({ mensaje: "hola" }, dependencias(cliente));
      assert.equal(r.errorTecnico, undefined, fallo.message);
      assert.equal(llamadas.length, 3, fallo.message);
      assert.equal(r.replyText, "El dipping cuesta $60.000 💗");
    }
  });

  it("clave realmente inválida (todos los intentos fallan con 401/400 «API key not valid») -> mensaje genérico de error técnico tras el plan completo, rápido y sin colgarse", async () => {
    const invalida = new Error("gemini_http_400: API key not valid. Please pass a valid API key.");
    const { cliente, llamadas } = clienteConGuion([invalida, invalida, invalida, invalida, invalida]);
    const t0 = Date.now();
    const r = await clasificarMensajeConGemini({ mensaje: "hola" }, dependencias(cliente));
    assert.equal(r.errorTecnico, true);
    assert.equal(llamadas.length, PLAN_DE_INTENTOS.length);
    assert.ok(Date.now() - t0 < 2_000, "con la espera inyectada no se demora");
  });

  it("espera corta entre intentos solo cuando el anterior FALLÓ (300 / 500 / 1000 ms) y ninguna en el camino feliz", async () => {
    const esperas: number[] = [];
    const { cliente } = clienteConGuion([503, 503, 503, 503]);
    await clasificarMensajeConGemini({ mensaje: "hola" }, dependencias(cliente, { esperar: async (ms: number) => void esperas.push(ms) }));
    assert.deepEqual(esperas, [300, 500, 1000]);
    const sinFallo = clienteConGuion(["ok"]);
    esperas.length = 0;
    await clasificarMensajeConGemini({ mensaje: "hola" }, dependencias(sinFallo.cliente, { esperar: async (ms: number) => void esperas.push(ms) }));
    assert.deepEqual(esperas, [], "el camino feliz no espera nada");
  });

  it("el tiempo máximo por intento corta una llamada colgada (la señal se aborta) y se sigue con el respaldo", async () => {
    const { cliente, llamadas } = clienteConGuion(["colgado", "ok"]);
    const r = await clasificarMensajeConGemini({ mensaje: "hola" }, dependencias(cliente, { timeoutPorIntentoMs: 20 }));
    assert.equal(r.errorTecnico, undefined);
    assert.equal(llamadas.length, 2);
    assert.deepEqual(llamadas.map((l) => l.params.model), [GEMINI_DEFAULT_MODEL, MODELO_RESPALDO]);
  });

  it("REFUERZO EN PARALELO: si el intento en curso no responde a tiempo, se lanza el siguiente sin esperar su tiempo máximo; gana el que responde y el lento se cancela", async () => {
    const esperas: number[] = [];
    const { cliente, llamadas } = clienteConGuion(["colgado", "ok"]);
    const t0 = Date.now();
    const r = await clasificarMensajeConGemini(
      { mensaje: "hola" },
      dependencias(cliente, { refuerzoMs: 15, timeoutPorIntentoMs: 60_000, esperar: async (ms: number) => void esperas.push(ms) }),
    );
    assert.ok(Date.now() - t0 < 5_000, "no esperó el tiempo máximo (60 s) del intento colgado");
    assert.equal(r.errorTecnico, undefined);
    assert.equal(r.replyText, "El dipping cuesta $60.000 💗");
    assert.deepEqual(llamadas.map((l) => l.params.model), [GEMINI_DEFAULT_MODEL, MODELO_RESPALDO]);
    assert.equal(llamadas[0]!.signal!.aborted, true, "el intento lento se canceló al haber ganador");
    assert.deepEqual(esperas, [], "el refuerzo no aplica la espera de «el anterior falló»: el anterior sigue vivo");
  });

  it("REFUERZO EN PARALELO: si el primer intento acaba respondiendo antes que el refuerzo, gana el primero (no se descarta una respuesta buena)", async () => {
    const llamadas: string[] = [];
    const cliente: GeminiGenerateContentClient = {
      generateContent(params) {
        llamadas.push(params.model);
        const lento = params.model === GEMINI_DEFAULT_MODEL;
        return new Promise((resolve) => setTimeout(() => resolve({ text: JSON.stringify({ intent: "CONSULTA", reply_text: lento ? "respuesta del principal" : "respuesta del respaldo" }) }), lento ? 60 : 400));
      },
    };
    const r = await clasificarMensajeConGemini({ mensaje: "hola" }, dependencias(cliente, { refuerzoMs: 25 }));
    assert.equal(r.replyText, "respuesta del principal");
    assert.equal(llamadas[0], GEMINI_DEFAULT_MODEL);
    assert.ok(llamadas.length >= 2, "el refuerzo sí se lanzó (el principal tardó más que el refuerzo), pero ganó el principal");
  });

  it("REFUERZO EN PARALELO: nunca más de una salida (no se manda doble respuesta) aunque dos intentos acaben válidos casi a la vez", async () => {
    const cliente: GeminiGenerateContentClient = {
      generateContent(params) {
        return new Promise((resolve) => setTimeout(() => resolve({ text: JSON.stringify({ intent: "CONSULTA", reply_text: `respuesta ${params.model}` }) }), 30));
      },
    };
    const r = await clasificarMensajeConGemini({ mensaje: "hola" }, dependencias(cliente, { refuerzoMs: 10 }));
    assert.equal(typeof r.replyText, "string");
    assert.match(r.replyText, /^respuesta gemini/);
    assert.equal(r.errorTecnico, undefined);
  });

  it("los mismos datos (instrucción, historial, mensaje) viajan en TODOS los intentos: el respaldo contesta con la misma información real", async () => {
    const { cliente, llamadas } = clienteConGuion([503, "ok"]);
    const historial = [{ role: "user" as const, text: "hola" }, { role: "model" as const, text: "¡Hola! 💗" }];
    await clasificarMensajeConGemini({ mensaje: "¿y el precio?", historial, contextoNegocio: "SERVICIOS REALES: Dipping $60.000" }, dependencias(cliente));
    assert.equal(llamadas.length, 2);
    assert.equal(llamadas[0]!.params.systemInstruction, llamadas[1]!.params.systemInstruction);
    assert.match(llamadas[1]!.params.systemInstruction, /Dipping \$60\.000/);
    assert.deepEqual(llamadas[0]!.params.contents, llamadas[1]!.params.contents);
    assert.deepEqual(llamadas[1]!.params.contents, [...historial, { role: "user", text: "¿y el precio?" }]);
  });
});

describe("respuestaDeConsultaEnReserva -- qué se le responde a una pregunta hecha a mitad de una reserva abierta", () => {
  const base = { detectedServiceMention: null, detectedProfessionalMention: null, detectedDateMention: null, detectedTimeMention: null };

  it("una consulta normal (sin fallo técnico) -> el texto de la IA, sin espacios sobrantes", () => {
    assert.equal(respuestaDeConsultaEnReserva({ ...base, intent: "CONSULTA", replyText: "  El dipping cuesta $60.000 💗 " }), "El dipping cuesta $60.000 💗");
  });

  it("pide a una persona con palabras que el detector fijo no cubre (ATENCION_HUMANA) -> le dice la frase exacta, que SÍ activa el aviso real; nunca «No reconocí esa opción»", () => {
    const texto = respuestaDeConsultaEnReserva({ ...base, intent: "ATENCION_HUMANA", replyText: "una persona te contactará (no debe usarse)" });
    assert.equal(texto, MENSAJE_PEDIR_PERSONA_EN_RESERVA);
    assert.match(texto!, /hablar con una persona/);
    assert.equal(detectarSolicitudAtencionHumana("hablar con una persona"), true, "la frase que se le indica activa de verdad la atención humana");
    assert.doesNotMatch(texto!, /ya le notifiqué|se pondrá en contacto|te contactará/i, "no promete lo que todavía no ocurrió");
  });

  it("fallo técnico, texto vacío o cualquier otra intención -> null (se repite el menú de siempre)", () => {
    assert.equal(respuestaDeConsultaEnReserva({ ...base, intent: "CONSULTA", replyText: MENSAJE_ERROR_GEMINI, errorTecnico: true }), null);
    assert.equal(respuestaDeConsultaEnReserva({ ...base, intent: "CONSULTA", replyText: "   " }), null);
    for (const intent of ["TRIGGER_AGENDA", "CANCELAR_CITA", "REPROGRAMAR_CITA"] as const) {
      assert.equal(respuestaDeConsultaEnReserva({ ...base, intent, replyText: "no debía usarse" }), null, intent);
    }
    assert.equal(respuestaDeConsultaEnReserva({ ...base, intent: "ATENCION_HUMANA", replyText: "x", errorTecnico: true }), null, "con fallo técnico no se da instrucciones sobre una salida dudosa");
  });
});
