import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectarTriggerAgendaDeterminista,
  clasificarMensajeConGemini,
  MENSAJE_BIENVENIDA_1,
  MENSAJE_BIENVENIDA_2,
  MENSAJE_GEMINI_BIENVENIDA,
  MENSAJE_TRANSICION_AGENDA,
  MENSAJE_ERROR_GEMINI,
} from "@/lib/amore-entrada-gemini";
import type { GeminiGenerateContentClient } from "@/lib/flow/gemini/gemini-types";

describe("Textos exactos pedidos", () => {
  it("MENSAJE_BIENVENIDA_1 / MENSAJE_BIENVENIDA_2 (dos mensajes separados)", () => {
    assert.equal(MENSAJE_BIENVENIDA_1, "¡Hola! 💗 Bienvenido/a a AMORE.\n\nEstoy aquí para ayudarte a encontrar el servicio ideal o reservar tu cita.");
    assert.equal(MENSAJE_BIENVENIDA_2, "¿Qué deseas hacer?\n\n1. Quiero una cita\n2. Quiero hacer una consulta");
  });

  it("MENSAJE_GEMINI_BIENVENIDA / MENSAJE_TRANSICION_AGENDA", () => {
    assert.equal(MENSAJE_GEMINI_BIENVENIDA, "Claro 💗 Cuéntame, ¿qué te gustaría saber?");
    assert.equal(MENSAJE_TRANSICION_AGENDA, "Perfecto 💗 Vamos a agendar tu cita.");
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
