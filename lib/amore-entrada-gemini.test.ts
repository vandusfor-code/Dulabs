import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectarTriggerAgendaDeterminista,
  detectarSolicitudAtencionHumana,
  construirMensajeNotificacionJessica,
  clasificarMensajeConGemini,
  MENSAJE_BIENVENIDA_1,
  MENSAJE_BIENVENIDA_2,
  MENSAJE_MENU_INICIO_INVALIDO,
  MENSAJE_GEMINI_BIENVENIDA,
  MENSAJE_TRANSICION_AGENDA,
  MENSAJE_ERROR_GEMINI,
  MENSAJE_ATENCION_HUMANA_CLIENTE,
  MOTIVO_ATENCION_HUMANA_DEFECTO,
  NUMERO_JESSICA,
} from "@/lib/amore-entrada-gemini";
import type { GeminiGenerateContentClient } from "@/lib/flow/gemini/gemini-types";

describe("Textos exactos pedidos", () => {
  it("MENSAJE_BIENVENIDA_1 / MENSAJE_BIENVENIDA_2 (dos mensajes separados, con opción 3)", () => {
    assert.equal(MENSAJE_BIENVENIDA_1, "¡Hola! 💗 Bienvenido/a a AMORE.\n\nEstoy aquí para ayudarte a encontrar el servicio ideal o reservar tu cita.");
    assert.equal(MENSAJE_BIENVENIDA_2, "¿Qué deseas hacer?\n\n1. Quiero una cita\n2. Quiero hacer una consulta\n3. Hablar con una persona");
  });

  it("MENSAJE_MENU_INICIO_INVALIDO también ofrece la opción 3", () => {
    assert.match(MENSAJE_MENU_INICIO_INVALIDO, /3\. Hablar con una persona/);
  });

  it("MENSAJE_GEMINI_BIENVENIDA / MENSAJE_TRANSICION_AGENDA", () => {
    assert.equal(MENSAJE_GEMINI_BIENVENIDA, "Claro 💗 Cuéntame, ¿qué te gustaría saber?");
    assert.equal(MENSAJE_TRANSICION_AGENDA, "Perfecto 💗 Vamos a agendar tu cita.");
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
});

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
    const resultado = await clasificarMensajeConGemini({ mensaje: "hola" }, { geminiClient: clienteQueLanza, resolveApiKey: () => "fake-key" });
    assert.equal(resultado.intent, "CONSULTA");
    assert.equal(resultado.replyText, MENSAJE_ERROR_GEMINI);
  });

  it("salida fuera del enum ('OTRO') -- nunca se acepta, responde CONSULTA con mensaje de error genérico (fail-safe, nunca dispara Agenda V2 por error)", async () => {
    const resultado = await clasificarMensajeConGemini(
      { mensaje: "hola" },
      { geminiClient: crearFakeGeminiClient({ intent: "OTRO", reply_text: "algo" }), resolveApiKey: () => "fake-key" },
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
    const resultado = await clasificarMensajeConGemini({ mensaje: "hola" }, { geminiClient: clienteMalformado, resolveApiKey: () => "fake-key" });
    assert.equal(resultado.intent, "CONSULTA");
  });

  it("reply_text ausente/no-string -- fuera del schema, responde CONSULTA con mensaje de error genérico", async () => {
    const resultado = await clasificarMensajeConGemini(
      { mensaje: "hola" },
      { geminiClient: crearFakeGeminiClient({ intent: "CONSULTA" }), resolveApiKey: () => "fake-key" },
    );
    assert.equal(resultado.intent, "CONSULTA");
    assert.equal(resultado.replyText, MENSAJE_ERROR_GEMINI);
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
