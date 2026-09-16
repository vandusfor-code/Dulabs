import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generarApiKey, hashearApiKey, verificarApiKey, tieneFormaDeApiKey } from "@/lib/developer/api-keys";

describe("DuLabs Developer V1 — API keys (Fase 1, sección 2.2)", () => {
  it("genera una clave con el prefijo público y un hash de 64 hex chars (SHA-256)", () => {
    const { claveEnClaro, hash } = generarApiKey();
    assert.match(claveEnClaro, /^dl_live_[0-9A-Za-z]{32,}$/);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("dos claves generadas nunca son iguales (entropía real, no determinística)", () => {
    const a = generarApiKey();
    const b = generarApiKey();
    assert.notEqual(a.claveEnClaro, b.claveEnClaro);
    assert.notEqual(a.hash, b.hash);
  });

  it("hashearApiKey es determinístico: la misma clave siempre produce el mismo hash", () => {
    const { claveEnClaro, hash } = generarApiKey();
    assert.equal(hashearApiKey(claveEnClaro), hash);
  });

  it("verificarApiKey acepta la clave correcta contra su propio hash", () => {
    const { claveEnClaro, hash } = generarApiKey();
    assert.equal(verificarApiKey(claveEnClaro, hash), true);
  });

  it("verificarApiKey rechaza una clave incorrecta", () => {
    const { hash } = generarApiKey();
    const otra = generarApiKey();
    assert.equal(verificarApiKey(otra.claveEnClaro, hash), false);
  });

  it("verificarApiKey rechaza strings vacíos/undefined sin lanzar", () => {
    assert.equal(verificarApiKey("", "algo"), false);
    assert.equal(verificarApiKey("algo", ""), false);
  });

  it("tieneFormaDeApiKey distingue una key real de basura obvia", () => {
    const { claveEnClaro } = generarApiKey();
    assert.equal(tieneFormaDeApiKey(claveEnClaro), true);
    assert.equal(tieneFormaDeApiKey("Bearer abc"), false);
    assert.equal(tieneFormaDeApiKey("dl_live_x"), false); // demasiado corta
  });
});
