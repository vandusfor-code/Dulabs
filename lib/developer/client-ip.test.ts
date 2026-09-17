/**
 * DuLabs Developer V1 -- Fase 17 (17.2). Tests del extractor de IP resistente a
 * spoofing de X-Forwarded-For: el cliente NO puede fijar su IP anteponiendo
 * `X-Forwarded-For: 1.2.3.4`; la IP se toma desde la derecha (infra confiable).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extraerIpConfiable } from "./client-ip";

describe("Fase 17.2 -- extraerIpConfiable (anti-spoof XFF)", () => {
  it("ignora el spoof leftmost: con trusted=0 toma el ÚLTIMO token (infra)", () => {
    // El cliente antepone 1.2.3.4; la infra anexa la IP real 203.0.113.9.
    assert.equal(extraerIpConfiable({ xff: "1.2.3.4, 203.0.113.9", trustedProxies: 0 }), "203.0.113.9");
  });

  it("un solo valor spoofeado + infra: toma el de la infra", () => {
    // Cliente manda solo "1.2.3.4"; infra anexa la real -> "1.2.3.4, <real>".
    assert.equal(extraerIpConfiable({ xff: "1.2.3.4, 198.51.100.7", trustedProxies: 0 }), "198.51.100.7");
  });

  it("con trusted=1 (un hop extra confiable) toma el penúltimo", () => {
    assert.equal(extraerIpConfiable({ xff: "9.9.9.9, 203.0.113.9, 130.211.0.1", trustedProxies: 1 }), "203.0.113.9");
  });

  it("sin XFF cae al socket", () => {
    assert.equal(extraerIpConfiable({ xff: undefined, socketAddr: "10.0.0.2" }), "10.0.0.2");
  });

  it("XFF vacío o solo comas cae al socket", () => {
    assert.equal(extraerIpConfiable({ xff: "  , ,", socketAddr: "10.0.0.3" }), "10.0.0.3");
  });

  it("cadena más corta que los hops confiables -> no devuelve un valor de cliente, cae al socket", () => {
    assert.equal(extraerIpConfiable({ xff: "1.2.3.4", trustedProxies: 2, socketAddr: "10.0.0.9" }), "10.0.0.9");
  });

  it("soporta header como array (varios X-Forwarded-For)", () => {
    assert.equal(extraerIpConfiable({ xff: ["1.2.3.4", "203.0.113.9"], trustedProxies: 0 }), "203.0.113.9");
  });

  it("lee GATEWAY_TRUSTED_PROXIES del entorno cuando no se pasa explícito", () => {
    const previo = process.env.GATEWAY_TRUSTED_PROXIES;
    process.env.GATEWAY_TRUSTED_PROXIES = "1";
    try {
      assert.equal(extraerIpConfiable({ xff: "9.9.9.9, 203.0.113.9, 130.211.0.1" }), "203.0.113.9");
    } finally {
      if (previo === undefined) delete process.env.GATEWAY_TRUSTED_PROXIES;
      else process.env.GATEWAY_TRUSTED_PROXIES = previo;
    }
  });
});
