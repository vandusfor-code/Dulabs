/**
 * DuLabs Developer V1 -- Fase 13. Unit de la proyección SEGURA hacia el
 * Developer: redacción de claves sensibles y que la proyección nunca exponga
 * columnas internas (published_at, intentos_publicacion, request_id).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactarPayloadEvento, proyectarEventoSeguro, type EventoFila } from "@/lib/developer/events-store";

describe("Fase 13 -- redacción de payload", () => {
  it("redacta claves sensibles en cualquier profundidad, conserva el resto", () => {
    const entrada = {
      texto: "hola",
      token: "abc123",
      api_key: "k",
      nested: { authorization: "Bearer x", ok: 1, mas: { secret: "s", value: 2 } },
      lista: [{ password: "p", nombre: "n" }],
    };
    const r = redactarPayloadEvento(entrada) as Record<string, unknown>;
    assert.equal(r.texto, "hola");
    assert.equal(r.token, "[redactado]");
    assert.equal(r.api_key, "[redactado]");
    const nested = r.nested as Record<string, unknown>;
    assert.equal(nested.authorization, "[redactado]");
    assert.equal(nested.ok, 1);
    assert.equal((nested.mas as Record<string, unknown>).secret, "[redactado]");
    assert.equal((nested.mas as Record<string, unknown>).value, 2);
    const lista = r.lista as Record<string, unknown>[];
    assert.equal(lista[0].password, "[redactado]");
    assert.equal(lista[0].nombre, "n");
    // No muta el original
    assert.equal(entrada.token, "abc123");
  });
});

describe("Fase 13 -- proyección segura", () => {
  const base: EventoFila = {
    id: 42,
    event_id: "evt_1",
    workspace_id: "ws_1",
    job_id: "job_1",
    request_id: "req_secreto",
    correlation_id: "corr_1",
    tipo: "received",
    created_at: "2026-09-17T00:00:00Z",
    published_at: "2026-09-17T00:00:01Z",
    intentos_publicacion: 3,
    payload: { token: "x", texto: "y" },
    procesado_en: "2026-09-17T00:00:02Z",
    entrega_estado: "dlq",
    entrega_intentos: 5,
    entrega_next_attempt_at: null,
    entrega_ultimo_error: "max_intentos:HTTP 500",
  };

  it("no expone columnas internas y redacta el payload", () => {
    const p = proyectarEventoSeguro(base) as unknown as Record<string, unknown>;
    assert.equal(p.id, 42);
    assert.equal(p.eventId, "evt_1");
    assert.equal("request_id" in p, false);
    assert.equal("published_at" in p, false);
    assert.equal("intentos_publicacion" in p, false);
    assert.equal((p.payload as Record<string, unknown>).token, "[redactado]");
    assert.equal((p.payload as Record<string, unknown>).texto, "y");
  });

  it("marca replayable solo para dlq/fallido", () => {
    assert.equal(proyectarEventoSeguro({ ...base, entrega_estado: "dlq" }).delivery.replayable, true);
    assert.equal(proyectarEventoSeguro({ ...base, entrega_estado: "fallido" }).delivery.replayable, true);
    assert.equal(proyectarEventoSeguro({ ...base, entrega_estado: "entregado" }).delivery.replayable, false);
    assert.equal(proyectarEventoSeguro({ ...base, entrega_estado: "pendiente" }).delivery.replayable, false);
    assert.equal(proyectarEventoSeguro({ ...base, entrega_estado: "entregando" }).delivery.replayable, false);
  });

  it("entregadoEn solo cuando entregado", () => {
    assert.equal(proyectarEventoSeguro({ ...base, entrega_estado: "entregado" }).delivery.entregadoEn, base.procesado_en);
    assert.equal(proyectarEventoSeguro({ ...base, entrega_estado: "dlq" }).delivery.entregadoEn, null);
  });
});
