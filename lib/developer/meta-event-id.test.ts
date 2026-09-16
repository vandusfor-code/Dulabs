import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calcularEventIdWebhookMeta } from "@/lib/developer/meta-event-id";

describe("DuLabs Developer V1 — event_id de webhooks de Meta (Fase 3)", () => {
  const payloadSent = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "123" },
              statuses: [{ id: "wamid.ABC", status: "sent", timestamp: "1000" }],
            },
          },
        ],
      },
    ],
  };

  it("el mismo payload (misma reentrega de Meta) produce SIEMPRE el mismo event_id", () => {
    const a = calcularEventIdWebhookMeta(payloadSent);
    const b = calcularEventIdWebhookMeta(payloadSent);
    assert.equal(a, b);
  });

  it("el mismo payload con las claves de los objetos en OTRO orden produce el mismo event_id (canonicalización real, no hash de bytes crudos)", () => {
    const reordenado = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ timestamp: "1000", status: "sent", id: "wamid.ABC" }],
                metadata: { phone_number_id: "123" },
              },
              field: "messages",
            },
          ],
          id: "waba-1",
        },
      ],
      object: "whatsapp_business_account",
    };
    assert.equal(calcularEventIdWebhookMeta(payloadSent), calcularEventIdWebhookMeta(reordenado));
  });

  it("el orden de los elementos DENTRO de un array SÍ importa (no se reordena, es contenido semántico)", () => {
    const conDosStatuses = {
      ...payloadSent,
      entry: [{ ...payloadSent.entry[0], changes: [{ ...payloadSent.entry[0].changes[0], value: { ...payloadSent.entry[0].changes[0].value, statuses: [{ id: "wamid.A" }, { id: "wamid.B" }] } }] }],
    };
    const invertido = {
      ...payloadSent,
      entry: [{ ...payloadSent.entry[0], changes: [{ ...payloadSent.entry[0].changes[0], value: { ...payloadSent.entry[0].changes[0].value, statuses: [{ id: "wamid.B" }, { id: "wamid.A" }] } }] }],
    };
    assert.notEqual(calcularEventIdWebhookMeta(conDosStatuses), calcularEventIdWebhookMeta(invertido));
  });

  it("REQUISITO CRÍTICO: sent, delivered y read del MISMO wamid producen event_id DIFERENTES (nunca usar wamid solo)", () => {
    const sent = payloadSent;
    const delivered = JSON.parse(JSON.stringify(payloadSent));
    delivered.entry[0].changes[0].value.statuses[0].status = "delivered";
    delivered.entry[0].changes[0].value.statuses[0].timestamp = "1001";
    const read = JSON.parse(JSON.stringify(payloadSent));
    read.entry[0].changes[0].value.statuses[0].status = "read";
    read.entry[0].changes[0].value.statuses[0].timestamp = "1002";

    const idSent = calcularEventIdWebhookMeta(sent);
    const idDelivered = calcularEventIdWebhookMeta(delivered);
    const idRead = calcularEventIdWebhookMeta(read);

    assert.notEqual(idSent, idDelivered);
    assert.notEqual(idDelivered, idRead);
    assert.notEqual(idSent, idRead);
  });

  it("payloads con contenido realmente distinto (distinto wamid) producen event_id distinto", () => {
    const otro = JSON.parse(JSON.stringify(payloadSent));
    otro.entry[0].changes[0].value.statuses[0].id = "wamid.OTRO";
    assert.notEqual(calcularEventIdWebhookMeta(payloadSent), calcularEventIdWebhookMeta(otro));
  });

  it("produce un hash hexadecimal de 64 caracteres (SHA-256)", () => {
    assert.match(calcularEventIdWebhookMeta(payloadSent), /^[0-9a-f]{64}$/);
  });
});
