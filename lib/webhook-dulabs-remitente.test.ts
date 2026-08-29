import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advertirMensajeSinRemitente,
  numeroWhatsappParaEnvio,
  resolverTelefonoRemitenteMeta,
  soloDigitos,
} from "@/lib/webhook-meta-remitente";

describe("soloDigitos", () => {
  it("mantiene comportamiento con string válido", () => {
    assert.equal(soloDigitos("+57 300 123 4567"), "573001234567");
    assert.equal(soloDigitos("573001234567"), "573001234567");
  });

  it("no lanza con null ni undefined", () => {
    assert.equal(soloDigitos(null), "");
    assert.equal(soloDigitos(undefined), "");
  });
});

describe("resolverTelefonoRemitenteMeta", () => {
  it("usa from cuando existe", () => {
    assert.equal(
      resolverTelefonoRemitenteMeta({ from: "573001234567", id: "w1", type: "text" }, []),
      "573001234567",
    );
  });

  it("usa contacts[0].wa_id cuando from falta y hay un solo contacto", () => {
    assert.equal(
      resolverTelefonoRemitenteMeta(
        { id: "w2", type: "unsupported" },
        [{ wa_id: "573009998877" }],
      ),
      "573009998877",
    );
  });

  it("devuelve null si no hay from ni contacto único válido", () => {
    assert.equal(resolverTelefonoRemitenteMeta({ id: "w3", type: "text" }), null);
    assert.equal(
      resolverTelefonoRemitenteMeta({ id: "w4", type: "text" }, [{ wa_id: "1" }, { wa_id: "2" }]),
      null,
    );
    assert.equal(
      resolverTelefonoRemitenteMeta({ id: "w5", type: "text" }, [{ wa_id: "" }]),
      null,
    );
  });
});

describe("numeroWhatsappParaEnvio", () => {
  it("prefiere from crudo para envío", () => {
    assert.equal(numeroWhatsappParaEnvio({ from: "573001234567" }, "573001234567"), "573001234567");
    assert.equal(numeroWhatsappParaEnvio({}, "573009998877"), "573009998877");
  });
});

describe("simulación registro sync (sin lanzar)", () => {
  it("payload messages[] sin from no lanza TypeError", () => {
    const value = {
      metadata: { display_phone_number: "573148127388" },
      messages: [{ id: "wamid.partial", type: "text", text: { body: "hola" } }],
    };
    const displayPhone = soloDigitos(value.metadata.display_phone_number);

    assert.doesNotThrow(() => {
      for (const mensaje of value.messages) {
        const telefonoRemitente = resolverTelefonoRemitenteMeta(mensaje, undefined);
        if (!telefonoRemitente) {
          advertirMensajeSinRemitente(mensaje);
          continue;
        }
        if (telefonoRemitente === displayPhone) continue;
        soloDigitos(telefonoRemitente);
      }
    });
  });

  it("payload normal con from conserva remitente", () => {
    const value = {
      metadata: { display_phone_number: "573148127388" },
      contacts: [{ wa_id: "573001112233" }],
      messages: [{ from: "573001112233", id: "wamid.ok", type: "text", text: { body: "hola" } }],
    };
    const telefono = resolverTelefonoRemitenteMeta(value.messages[0]!, value.contacts);
    assert.equal(telefono, "573001112233");
  });

  it("payload solo statuses no itera messages", () => {
    const value = {
      metadata: { phone_number_id: "123" },
      statuses: [{ id: "wamid.status", status: "delivered" as const }],
    };
    const messages = (value as { messages?: unknown[] }).messages ?? [];
    assert.equal(messages.length, 0);
  });
});
