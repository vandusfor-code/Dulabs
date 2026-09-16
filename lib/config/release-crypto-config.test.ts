/**
 * Guard de release -- configuración criptográfica por producto (protección del
 * incidente de Fase 10). Verifica que la validación distinga correctamente
 * Business (TOKEN_ENCRYPTION_KEY) de Developer (DEVELOPER_TOKEN_ENCRYPTION_KEY
 * | KMS_KEY_NAME) y que nunca marque como OK un producto sin su configuración.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  estadoCriptoBusiness,
  estadoCriptoDeveloper,
  validarConfigCriptograficaDeRelease,
} from "@/lib/config/release-crypto-config";

const VARS = ["TOKEN_ENCRYPTION_KEY", "DEVELOPER_TOKEN_ENCRYPTION_KEY", "KMS_KEY_NAME"] as const;

describe("release-crypto-config -- validación de cifrado por producto", () => {
  let originales: Record<string, string | undefined>;

  beforeEach(() => {
    originales = {};
    for (const v of VARS) {
      originales[v] = process.env[v];
      delete process.env[v];
    }
  });
  afterEach(() => {
    for (const v of VARS) {
      if (originales[v] === undefined) delete process.env[v];
      else process.env[v] = originales[v];
    }
  });

  it("Developer con DEVELOPER_TOKEN_ENCRYPTION_KEY -> ok, mecanismo static", () => {
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = "x".repeat(44); // presencia; el valor no se valida aquí
    const e = estadoCriptoDeveloper();
    assert.equal(e.ok, true);
    assert.equal(e.mecanismo, "static");
    assert.equal(e.faltante, null);
  });

  it("Developer con KMS_KEY_NAME -> ok, mecanismo kms (prioriza KMS)", () => {
    process.env.KMS_KEY_NAME = "projects/p/locations/l/keyRings/r/cryptoKeys/k";
    const e = estadoCriptoDeveloper();
    assert.equal(e.ok, true);
    assert.equal(e.mecanismo, "kms");
  });

  it("Developer sin ninguna clave -> !ok, mecanismo none, mensaje accionable", () => {
    const e = estadoCriptoDeveloper();
    assert.equal(e.ok, false);
    assert.equal(e.mecanismo, "none");
    assert.match(e.faltante ?? "", /DEVELOPER_TOKEN_ENCRYPTION_KEY|KMS_KEY_NAME/);
    assert.match(e.faltante ?? "", /encryption_unavailable/);
  });

  it("Business depende de TOKEN_ENCRYPTION_KEY, NO de las claves de Developer", () => {
    // Solo Developer configurado: Business debe seguir marcando falta.
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = "x".repeat(44);
    assert.equal(estadoCriptoBusiness().ok, false);
    process.env.TOKEN_ENCRYPTION_KEY = "y".repeat(44);
    assert.equal(estadoCriptoBusiness().ok, true);
  });

  it("producción con Developer sin clave -> release NO ok y lo señala como faltante", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "y".repeat(44); // Business ok
    const r = validarConfigCriptograficaDeRelease({ entorno: "production" });
    assert.equal(r.ok, false);
    assert.equal(r.faltantes.length, 1);
    assert.equal(r.faltantes[0]!.producto, "developer");
  });

  it("ambos productos configurados -> release ok", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "y".repeat(44);
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = "x".repeat(44);
    const r = validarConfigCriptograficaDeRelease({ entorno: "production" });
    assert.equal(r.ok, true);
    assert.equal(r.faltantes.length, 0);
  });

  it("solo se validan los productos pedidos (productos: ['developer'])", () => {
    // Sin TOKEN_ENCRYPTION_KEY, pero pidiendo solo developer con su clave -> ok.
    process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = "x".repeat(44);
    const r = validarConfigCriptograficaDeRelease({ productos: ["developer"] });
    assert.equal(r.estados.length, 1);
    assert.equal(r.estados[0]!.producto, "developer");
    assert.equal(r.ok, true);
  });
});
