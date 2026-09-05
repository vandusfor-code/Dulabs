import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requireRole, requireSpecialistScope } from "./authz";
import type { UsuarioSesion } from "./session";

function sesion(overrides: Partial<UsuarioSesion>): UsuarioSesion {
  return {
    usuarioId: 1,
    idTenant: "t1",
    especialistaId: 10,
    rol: "colaboradora",
    nombre: "Prueba",
    username: "prueba",
    activo: true,
    ...overrides,
  };
}

describe("lib/auth/authz — requireRole (puro)", () => {
  it("sesion=null (tenant sin login) siempre pasa como administrador", () => {
    assert.equal(requireRole(null, "administrador").ok, true);
    assert.equal(requireRole(null, "colaboradora").ok, false);
  });

  it("un administrador pasa requireRole('administrador')", () => {
    assert.equal(requireRole(sesion({ rol: "administrador" }), "administrador").ok, true);
  });

  it("una colaboradora NO pasa requireRole('administrador') -- 403", () => {
    const resultado = requireRole(sesion({ rol: "colaboradora" }), "administrador");
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.status, 403);
  });
});

describe("lib/auth/authz — requireSpecialistScope (puro)", () => {
  it("sesion=null (tenant legacy) nunca restringe", () => {
    assert.equal(requireSpecialistScope(null, 999).ok, true);
  });

  it("un administrador puede operar sobre CUALQUIER especialista", () => {
    assert.equal(requireSpecialistScope(sesion({ rol: "administrador", especialistaId: 1 }), 999).ok, true);
  });

  it("una colaboradora puede operar sobre SU PROPIA especialista", () => {
    assert.equal(requireSpecialistScope(sesion({ rol: "colaboradora", especialistaId: 10 }), 10).ok, true);
  });

  it("una colaboradora NO puede operar sobre la especialista de otra -- 403", () => {
    const resultado = requireSpecialistScope(sesion({ rol: "colaboradora", especialistaId: 10 }), 20);
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.status, 403);
  });
});
