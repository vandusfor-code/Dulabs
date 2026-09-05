import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password";

describe("lib/auth/password — hashing real con scrypt", () => {
  it("una contraseña correcta verifica true contra su propio hash", async () => {
    const hash = await hashPassword("Amore.J2026");
    assert.equal(await verifyPassword("Amore.J2026", hash), true);
  });

  it("una contraseña incorrecta verifica false", async () => {
    const hash = await hashPassword("Amore.J2026");
    assert.equal(await verifyPassword("otra-contraseña", hash), false);
  });

  it("el hash nunca contiene la contraseña en texto plano", async () => {
    const hash = await hashPassword("Amore.J2026");
    assert.ok(!hash.includes("Amore.J2026"));
  });

  it("dos hashes de la MISMA contraseña son distintos (salt aleatorio)", async () => {
    const a = await hashPassword("Amore.J2026");
    const b = await hashPassword("Amore.J2026");
    assert.notEqual(a, b);
  });

  it("un hash malformado (formato inesperado) nunca lanza, verifica false", async () => {
    assert.equal(await verifyPassword("cualquiera", "no-es-un-hash-valido"), false);
    assert.equal(await verifyPassword("cualquiera", ""), false);
    assert.equal(await verifyPassword("cualquiera", "scrypt:solo-dos-partes"), false);
  });
});
