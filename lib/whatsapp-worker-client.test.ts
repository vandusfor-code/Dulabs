/**
 * WhatsApp Worker client (autorizado) — pruebas puras con `fetch` global
 * mockeado (nunca una llamada de red real, nunca el worker real). Verifica
 * específicamente el parámetro `?slot` (WhatsApp multi-cuenta, autorizado):
 * por defecto 1 ("WhatsApp principal", EXACTO comportamiento de siempre
 * para todo llamador que nunca lo pase), y que cada función lo propaga a la
 * URL real que se le pide al worker.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import {
  consultarEstadoWorker,
  iniciarConexionWorker,
  desconectarWorker,
  enviarMensajeWhatsApp,
  enviarAudioWhatsApp,
  resolverSlotDesdeQuery,
} from "./whatsapp-worker-client";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

function mockFetch(respuesta: unknown = {}) {
  const llamadas: { url: string; init: RequestInit | undefined }[] = [];
  global.fetch = (async (url: string, init?: RequestInit) => {
    llamadas.push({ url: String(url), init });
    return { ok: true, json: async () => respuesta } as Response;
  }) as typeof fetch;
  return llamadas;
}

describe("whatsapp-worker-client -- parámetro ?slot (WhatsApp multi-cuenta, autorizado)", () => {
  beforeEach(() => {
    process.env.WHATSAPP_WORKER_URL = "https://worker.prueba.local";
    process.env.WHATSAPP_WORKER_SECRET = "secreto-de-prueba";
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  it("consultarEstadoWorker sin slot -> ?slot=1 (compatibilidad total con todo llamador existente)", async () => {
    const llamadas = mockFetch();
    await consultarEstadoWorker("tenant-1");
    assert.match(llamadas[0]!.url, /\/tenants\/tenant-1\/estado\?slot=1$/);
  });

  it("consultarEstadoWorker con slot=2 -> ?slot=2", async () => {
    const llamadas = mockFetch();
    await consultarEstadoWorker("tenant-1", 2);
    assert.match(llamadas[0]!.url, /\/tenants\/tenant-1\/estado\?slot=2$/);
  });

  it("iniciarConexionWorker sin opciones -> slot=1, sin cuerpo (modo QR de siempre)", async () => {
    const llamadas = mockFetch();
    await iniciarConexionWorker("tenant-1");
    assert.match(llamadas[0]!.url, /\/tenants\/tenant-1\/iniciar\?slot=1$/);
    assert.equal(llamadas[0]!.init?.body, undefined);
  });

  it("iniciarConexionWorker con slot:2 -> ?slot=2, y el teléfono se sigue pasando igual", async () => {
    const llamadas = mockFetch();
    await iniciarConexionWorker("tenant-1", { telefono: "573001112233", slot: 2 });
    assert.match(llamadas[0]!.url, /\/tenants\/tenant-1\/iniciar\?slot=2$/);
    assert.deepEqual(JSON.parse(llamadas[0]!.init!.body as string), { telefono: "573001112233" });
  });

  it("desconectarWorker sin slot -> slot=1; con slot=2 -> slot=2", async () => {
    const llamadas = mockFetch();
    await desconectarWorker("tenant-1");
    await desconectarWorker("tenant-1", 2);
    assert.match(llamadas[0]!.url, /\/desconectar\?slot=1$/);
    assert.match(llamadas[1]!.url, /\/desconectar\?slot=2$/);
  });

  it("enviarMensajeWhatsApp sin slot -> slot=1 (recordatorios/cumpleaños/bot actuales, sin cambios)", async () => {
    const llamadas = mockFetch({ ok: true });
    await enviarMensajeWhatsApp({ tenantId: "tenant-1", telefono: "573001112233", mensaje: "Hola" });
    assert.match(llamadas[0]!.url, /\/enviar\?slot=1$/);
  });

  it("enviarMensajeWhatsApp con slot:2 -> slot=2, resto del cuerpo intacto", async () => {
    const llamadas = mockFetch({ ok: true });
    await enviarMensajeWhatsApp({ tenantId: "tenant-1", telefono: "573001112233", mensaje: "Hola", origen: "automatico", slot: 2 });
    assert.match(llamadas[0]!.url, /\/enviar\?slot=2$/);
    assert.deepEqual(JSON.parse(llamadas[0]!.init!.body as string), { telefono: "573001112233", mensaje: "Hola", origen: "automatico" });
  });

  it("enviarAudioWhatsApp propaga slot igual que enviarMensajeWhatsApp", async () => {
    const llamadas = mockFetch({ ok: true });
    await enviarAudioWhatsApp({ tenantId: "tenant-1", telefono: "573001112233", audioBase64: "AAAA", mimeType: "audio/ogg", slot: 2 });
    assert.match(llamadas[0]!.url, /\/enviar-audio\?slot=2$/);
  });

  it("sin WHATSAPP_WORKER_URL/SECRET configurados -> error controlado 503, nunca intenta la llamada real", async () => {
    delete process.env.WHATSAPP_WORKER_URL;
    delete process.env.WHATSAPP_WORKER_SECRET;
    const llamadas = mockFetch();
    const resultado = await consultarEstadoWorker("tenant-1");
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.status, 503);
    assert.equal(llamadas.length, 0);
  });
});

function requestConUrl(url: string): NextRequest {
  return { url } as NextRequest;
}

describe("resolverSlotDesdeQuery -- WhatsApp multi-cuenta (autorizado)", () => {
  it("sin ?slot -> 1 (compatibilidad total con toda ruta que nunca lo reciba)", () => {
    assert.equal(resolverSlotDesdeQuery(requestConUrl("https://app.local/api/whatsapp-qr")), 1);
  });

  it("?slot=1 -> 1", () => {
    assert.equal(resolverSlotDesdeQuery(requestConUrl("https://app.local/api/whatsapp-qr?slot=1")), 1);
  });

  it("?slot=2 -> 2", () => {
    assert.equal(resolverSlotDesdeQuery(requestConUrl("https://app.local/api/whatsapp-qr?slot=2")), 2);
  });

  it("cualquier otro valor (incluida una 3ra cuenta) -> null, nunca se asume un slot por defecto", () => {
    assert.equal(resolverSlotDesdeQuery(requestConUrl("https://app.local/api/whatsapp-qr?slot=3")), null);
    assert.equal(resolverSlotDesdeQuery(requestConUrl("https://app.local/api/whatsapp-qr?slot=0")), null);
    assert.equal(resolverSlotDesdeQuery(requestConUrl("https://app.local/api/whatsapp-qr?slot=abc")), null);
  });
});
