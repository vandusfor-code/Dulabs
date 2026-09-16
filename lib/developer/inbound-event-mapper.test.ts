import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clasificarWebhookMeta, extraerPhoneNumberIdMeta, extraerStatusMeta, normalizarEventoInbound, tipoEventoDeWebhook, rankStatus } from "./inbound-event-mapper";

const MSG = {
  entry: [{ changes: [{ value: {
    metadata: { display_phone_number: "1555", phone_number_id: "105550002055" },
    contacts: [{ profile: { name: "Cliente" }, wa_id: "573148127388" }],
    messages: [{ from: "573148127388", id: "wamid.INBOUNDxxxxxxxxxxxxxxxx", timestamp: "1789500000", type: "text", text: { body: "hola" } }],
  } }] }],
};

const STATUS_DELIVERED = {
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: "105550002055" },
    statuses: [{ id: "wamid.OUTBOUNDxxxxxxxxxxxxxxx", status: "delivered", timestamp: "1789500100", recipient_id: "573148127388" }],
  } }] }],
};

describe("DuLabs Developer V1 — inbound-event-mapper (Fase 6, D1/D3)", () => {
  it("clasifica message entrante vs status vs other", () => {
    assert.equal(clasificarWebhookMeta(MSG), "message");
    assert.equal(clasificarWebhookMeta(STATUS_DELIVERED), "status");
    assert.equal(clasificarWebhookMeta({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "x" } } }] }] }), "other");
    assert.equal(clasificarWebhookMeta(null), "other");
  });

  it("extrae phone_number_id de metadata (igual para message y status)", () => {
    assert.equal(extraerPhoneNumberIdMeta(MSG), "105550002055");
    assert.equal(extraerPhoneNumberIdMeta(STATUS_DELIVERED), "105550002055");
    assert.equal(extraerPhoneNumberIdMeta({}), null);
  });

  it("normaliza un mensaje entrante: event_type message.received + campos + raw preservado", () => {
    const ev = normalizarEventoInbound({ payload: MSG, eventId: "ev1", workspaceId: "ws1", whatsappNumberId: "num-uuid" });
    assert.ok(ev);
    assert.equal(ev!.event_type, "message.received");
    assert.equal(ev!.wamid, "wamid.INBOUNDxxxxxxxxxxxxxxxx");
    assert.equal(ev!.from, "573148127388");
    assert.equal(ev!.message_type, "text");
    assert.equal(ev!.text, "hola");
    assert.equal(ev!.status, null);
    assert.equal(ev!.whatsapp_number_id, "num-uuid");
    assert.equal(ev!.workspace_id, "ws1");
    assert.deepEqual(ev!.raw, MSG, "raw crudo de Meta debe preservarse para trazabilidad");
  });

  it("normaliza un status: event_type message.status + status + wamid del mensaje outbound", () => {
    const ev = normalizarEventoInbound({ payload: STATUS_DELIVERED, eventId: "ev2", workspaceId: "ws1", whatsappNumberId: "num-uuid" });
    assert.ok(ev);
    assert.equal(ev!.event_type, "message.status");
    assert.equal(ev!.status, "delivered");
    assert.equal(ev!.wamid, "wamid.OUTBOUNDxxxxxxxxxxxxxxx");
    assert.equal(ev!.from, "573148127388", "recipient_id del status se expone como from");
    assert.equal(ev!.text, null);
    assert.equal(ev!.message_type, null);
  });

  it("extraerStatusMeta: solo status conocidos; ignora status desconocido/ausente", () => {
    assert.equal(extraerStatusMeta(MSG), null);
    assert.equal(extraerStatusMeta({ entry: [{ changes: [{ value: { statuses: [{ id: "w", status: "inventado" }] } }] }] }), null);
    const st = extraerStatusMeta(STATUS_DELIVERED);
    assert.equal(st?.status, "delivered");
  });

  it("clase 'other' -> normalizarEventoInbound devuelve null (nada que entregar)", () => {
    assert.equal(normalizarEventoInbound({ payload: {}, eventId: "e", workspaceId: "w", whatsappNumberId: "n" }), null);
  });

  it("tipoEventoDeWebhook mapea al enum de eventos (received / sent / delivered / read / failed)", () => {
    assert.equal(tipoEventoDeWebhook(MSG), "received");
    assert.equal(tipoEventoDeWebhook(STATUS_DELIVERED), "delivered");
    assert.equal(tipoEventoDeWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: "w", status: "read" }] } }] }] }), "read");
    assert.equal(tipoEventoDeWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: "w", status: "failed" }] } }] }] }), "failed");
  });

  it("rankStatus es estrictamente creciente sent<delivered<read y failed es el mayor", () => {
    assert.ok(rankStatus("sent") < rankStatus("delivered"));
    assert.ok(rankStatus("delivered") < rankStatus("read"));
    assert.equal(rankStatus("failed"), 4);
  });
});
