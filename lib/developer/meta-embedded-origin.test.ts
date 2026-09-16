/**
 * DuLabs Developer V1 -- Fase 10 (revisión PR #41). La validación de origin
 * del postMessage de Embedded Signup debe ser EXACTA (allowlist), no
 * endsWith/includes -- si no, dominios como evilfacebook.com pasarían.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { esOrigenMetaValido, ORIGENES_META_PERMITIDOS } from "@/lib/developer/meta-embedded-origin";

describe("Developer V1 Fase 10 -- validación exacta de origin de Meta", () => {
  it("origins legítimos de Meta -> se procesan (true)", () => {
    for (const o of ORIGENES_META_PERMITIDOS) assert.equal(esOrigenMetaValido(o), true, o);
    assert.equal(esOrigenMetaValido("https://www.facebook.com"), true);
    assert.equal(esOrigenMetaValido("https://web.facebook.com"), true);
  });

  it("evilfacebook.com -> se ignora (false)", () => {
    assert.equal(esOrigenMetaValido("https://evilfacebook.com"), false);
    assert.equal(esOrigenMetaValido("https://www.evilfacebook.com"), false);
  });

  it("dominios que 'terminan en' facebook.com pero NO son Meta -> se ignoran", () => {
    // Exactamente los casos que endsWith('facebook.com') dejaría pasar.
    assert.equal(esOrigenMetaValido("https://www.facebook.com.evil.com"), false);
    assert.equal(esOrigenMetaValido("https://notfacebook.com"), false);
    assert.equal(esOrigenMetaValido("http://facebook.com"), false); // http, no https
    assert.equal(esOrigenMetaValido("https://facebook.com.attacker.io"), false);
    assert.equal(esOrigenMetaValido("https://m.facebook.com.evil"), false);
  });

  it("cualquier otro origin no autorizado -> se ignora", () => {
    assert.equal(esOrigenMetaValido("https://google.com"), false);
    assert.equal(esOrigenMetaValido("null"), false);
    assert.equal(esOrigenMetaValido(""), false);
    assert.equal(esOrigenMetaValido("https://facebook.evil.com"), false);
  });
});
