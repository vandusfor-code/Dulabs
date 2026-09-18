import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  qstashDisponible,
  encolarWhatsappDeveloper,
  dedupIdDeJob,
  scopeYclaveJob,
  esFalloTransitorio,
} from "@/lib/developer/whatsapp-jobs";

describe("whatsapp-jobs -- publisher QStash + helpers puros", () => {
  const orig = process.env.QSTASH_TOKEN;
  beforeEach(() => { delete process.env.QSTASH_TOKEN; });
  afterEach(() => { if (orig === undefined) delete process.env.QSTASH_TOKEN; else process.env.QSTASH_TOKEN = orig; });

  it("qstashDisponible refleja la presencia de QSTASH_TOKEN", () => {
    assert.equal(qstashDisponible(), false);
    process.env.QSTASH_TOKEN = "qstash_x";
    assert.equal(qstashDisponible(), true);
  });

  it("encolar sin QSTASH_TOKEN -> encolado:false motivo sin_qstash_token (habilita fallback inline)", async () => {
    const r = await encolarWhatsappDeveloper({ tipo: "bienvenida", workspaceId: "ws1", userId: "u1" });
    assert.deepEqual(r, { encolado: false, motivo: "sin_qstash_token" });
  });

  it("dedupIdDeJob es estable por evento", () => {
    assert.equal(dedupIdDeJob({ tipo: "bienvenida", workspaceId: "ws1", userId: "u1" }), "wa-bienvenida-ws1");
    assert.equal(dedupIdDeJob({ tipo: "pago", accountId: "acc1", planCodigo: "AGENCY", transactionId: "tx9" }), "wa-pago-tx9");
  });

  it("scopeYclaveJob deriva scope + clave de idempotencia", () => {
    assert.deepEqual(scopeYclaveJob({ tipo: "bienvenida", workspaceId: "ws1", userId: "u1" }), { workspaceId: "ws1", idempotencyKey: "wa-bienvenida" });
    assert.deepEqual(scopeYclaveJob({ tipo: "pago", accountId: "acc1", planCodigo: "AGENCY", transactionId: "tx9" }), { workspaceId: "acc1", idempotencyKey: "wa-pago-tx9" });
  });

  it("esFalloTransitorio: 5xx/red = reintentar; 4xx/permanentes = no reintentar", () => {
    assert.equal(esFalloTransitorio({ enviado: false, motivo: "error_envio", detalle: "Meta respondió 500: x" }), true);
    assert.equal(esFalloTransitorio({ enviado: false, motivo: "error_envio", detalle: "Meta respondió 400: (#100) Invalid parameter" }), false);
    assert.equal(esFalloTransitorio({ enviado: false, motivo: "error_envio" }), true, "sin status legible (red/timeout) -> reintentar");
    assert.equal(esFalloTransitorio({ enviado: false, motivo: "plantilla_no_aprobada" }), false);
    assert.equal(esFalloTransitorio({ enviado: false, motivo: "sin_whatsapp" }), false);
    assert.equal(esFalloTransitorio({ enviado: false, motivo: "motivo_desconocido" }), true);
  });
});
