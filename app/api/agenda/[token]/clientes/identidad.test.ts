/**
 * Identidad de cliente (autorizado) -- pruebas puras. resolverPhoneNumberIdCliente
 * es la MISMA regla que ya usa el registro real por WhatsApp (lib/agenda-v2/router.ts,
 * lib/reserva-servicio-nylas.ts): AMORE siempre usa el prefijo sintético
 * "whatsapp-qr:<tenant>", nunca el phone_number_id legacy de Meta.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolverPhoneNumberIdCliente, validarCumpleanos } from "./identidad";

const AMORE_TENANT_ID = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";

describe("resolverPhoneNumberIdCliente", () => {
  it("AMORE -> siempre 'whatsapp-qr:<tenant>', nunca el phone_number_id legacy de Meta", () => {
    const resultado = resolverPhoneNumberIdCliente({ idTenant: AMORE_TENANT_ID, phoneNumberId: "pendiente-amore-legacy" });
    assert.equal(resultado, `whatsapp-qr:${AMORE_TENANT_ID}`);
  });

  it("cualquier otro tenant -> su propio phoneNumberId real, sin cambios", () => {
    const otroTenant = "11ccf0a3-726b-4d4b-9f7d-2deb8441d6a9";
    const resultado = resolverPhoneNumberIdCliente({ idTenant: otroTenant, phoneNumberId: "wa-real-del-tenant" });
    assert.equal(resultado, "wa-real-del-tenant");
  });
});

describe("validarCumpleanos", () => {
  it("día y mes válidos -> ok", () => {
    assert.deepEqual(validarCumpleanos(15, 6), { ok: true });
  });

  it("ambos undefined (no se está editando cumpleaños) -> ok", () => {
    assert.deepEqual(validarCumpleanos(undefined, undefined), { ok: true });
  });

  it("ambos null (borrar cumpleaños) -> ok", () => {
    assert.deepEqual(validarCumpleanos(null, null), { ok: true });
  });

  it("día 0 -> inválido", () => {
    assert.equal(validarCumpleanos(0, 6).ok, false);
  });

  it("día 32 -> inválido", () => {
    assert.equal(validarCumpleanos(32, 6).ok, false);
  });

  it("mes 0 -> inválido", () => {
    assert.equal(validarCumpleanos(15, 0).ok, false);
  });

  it("mes 13 -> inválido", () => {
    assert.equal(validarCumpleanos(15, 13).ok, false);
  });

  it("valores no numéricos -> inválido", () => {
    assert.equal(validarCumpleanos("quince", 6).ok, false);
  });
});
