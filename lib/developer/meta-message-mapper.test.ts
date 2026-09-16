import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapearPayloadAMeta, extraerWamid } from "./meta-message-mapper";

describe("DuLabs Developer V1 — meta-message-mapper (Fase 5, decisión D2)", () => {
  it("mapearPayloadAMeta produce EXACTAMENTE el shape real de Meta -- messaging_product presente, whatsappNumberId ausente", () => {
    const resultado = mapearPayloadAMeta({ whatsappNumberId: "un-uuid-interno", to: "573000000000", type: "text", text: { body: "hola" } });
    assert.deepEqual(resultado, { messaging_product: "whatsapp", to: "573000000000", type: "text", text: { body: "hola" } });
    assert.equal((resultado as Record<string, unknown>).whatsappNumberId, undefined);
  });

  it("extraerWamid: respuesta real y válida de Meta -> wamid extraído", () => {
    const resultado = extraerWamid({ messaging_product: "whatsapp", messages: [{ id: "wamid.HBgLNTczMDAwMDAwMDAVAgAR" }] });
    assert.equal(resultado.valido, true);
    if (resultado.valido) assert.equal(resultado.wamid, "wamid.HBgLNTczMDAwMDAwMDAVAgAR");
  });

  it("extraerWamid: respuesta sin 'messages' -> inválido, nunca inventa un id", () => {
    const resultado = extraerWamid({ messaging_product: "whatsapp" });
    assert.equal(resultado.valido, false);
    if (!resultado.valido) assert.equal(resultado.motivo, "sin_array_messages");
  });

  it("extraerWamid: 'messages' vacío -> inválido", () => {
    const resultado = extraerWamid({ messages: [] });
    assert.equal(resultado.valido, false);
  });

  it("extraerWamid: id sin el prefijo real 'wamid.' -> inválido, nunca se acepta como si fuera válido", () => {
    const resultado = extraerWamid({ messages: [{ id: "no-es-un-wamid-real" }] });
    assert.equal(resultado.valido, false);
    if (!resultado.valido) assert.equal(resultado.motivo, "id_con_formato_invalido");
  });

  it("extraerWamid: id demasiado corto -> inválido", () => {
    const resultado = extraerWamid({ messages: [{ id: "wamid.x" }] });
    assert.equal(resultado.valido, false);
  });

  it("extraerWamid: cuerpo null / no objeto -> inválido, sin lanzar", () => {
    assert.equal(extraerWamid(null).valido, false);
    assert.equal(extraerWamid("texto plano").valido, false);
    assert.equal(extraerWamid(undefined).valido, false);
  });

  it("extraerWamid: messages[0] sin campo 'id' -> inválido", () => {
    const resultado = extraerWamid({ messages: [{ message_status: "accepted" }] });
    assert.equal(resultado.valido, false);
  });
});
