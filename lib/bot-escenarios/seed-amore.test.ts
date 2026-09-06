/**
 * Valida el banco REAL de escenarios de AMORE (seed-amore.ts) ANTES de que
 * pueda sembrarse -- integridad estructural + Claim Security real
 * (validateTextClaimsAgainstVerified, SIN capabilities verificadas: exactamente
 * la situación real de un mensaje enviado por resolver_escenario, que nunca
 * declara ninguna capability propia). Mismo criterio ya probado este mismo
 * día para el portal (ver historial de _actualizar-flow-amore.mts).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateTextClaimsAgainstVerified } from "@/lib/flow/external-claim-security";
import { AMORE_ESCENARIOS_SEED, AMORE_PORTAL_URL } from "@/lib/bot-escenarios/seed-amore";
import { CODIGO_ESCENARIO_FALLBACK, CODIGO_ESCENARIO_PORTAL } from "@/lib/bot-escenarios/tipos";

describe("AMORE_ESCENARIOS_SEED — integridad estructural", () => {
  it("códigos únicos", () => {
    const codigos = AMORE_ESCENARIOS_SEED.map((e) => e.codigo);
    assert.equal(new Set(codigos).size, codigos.length);
  });

  it("incluye los 2 códigos reservados que el resolver requiere (fallback + portal)", () => {
    const codigos = new Set(AMORE_ESCENARIOS_SEED.map((e) => e.codigo));
    assert.ok(codigos.has(CODIGO_ESCENARIO_FALLBACK));
    assert.ok(codigos.has(CODIGO_ESCENARIO_PORTAL));
  });

  it("el fallback nunca tiene variantes propias (solo se llega por código reservado)", () => {
    const fallback = AMORE_ESCENARIOS_SEED.find((e) => e.codigo === CODIGO_ESCENARIO_FALLBACK)!;
    assert.deepEqual(fallback.variantes, []);
  });

  it("modo=ai nunca trae `respuestas` estáticas (su texto SIEMPRE lo genera Claude)", () => {
    for (const e of AMORE_ESCENARIOS_SEED.filter((e) => e.modo === "ai")) {
      assert.deepEqual(e.respuestas, [], `${e.codigo} es modo=ai y no debería tener respuestas estáticas`);
      assert.ok(e.config.instruccionIA?.trim(), `${e.codigo} es modo=ai y necesita instruccionIA`);
    }
  });

  it("todo escenario que NO es modo=ai trae al menos una respuesta (o un respuestaSinServicio en modo=catalog)", () => {
    for (const e of AMORE_ESCENARIOS_SEED.filter((e) => e.modo !== "ai")) {
      const tieneAlgo = e.respuestas.length > 0 || Boolean(e.config.respuestaSinServicio);
      assert.ok(tieneAlgo, `${e.codigo} no tiene ninguna respuesta configurada`);
    }
  });

  it("el escenario de portal usa la URL real del portal de AMORE, nunca un placeholder", () => {
    const portal = AMORE_ESCENARIOS_SEED.find((e) => e.codigo === CODIGO_ESCENARIO_PORTAL)!;
    for (const r of portal.respuestas) assert.match(r, new RegExp(AMORE_PORTAL_URL.replace(/[/.]/g, "\\$&")));
  });
});

describe("AMORE_ESCENARIOS_SEED — Claim Security real (nunca bloqueado al enviarse)", () => {
  for (const escenario of AMORE_ESCENARIOS_SEED) {
    for (const [i, texto] of escenario.respuestas.entries()) {
      it(`${escenario.codigo} respuesta[${i}] pasa validateTextClaimsAgainstVerified sin ninguna capability verificada`, () => {
        const check = validateTextClaimsAgainstVerified(texto, new Set(), { source: "ai_response" });
        assert.ok(check.ok, `BLOQUEADO (${escenario.codigo}): "${texto.slice(0, 80)}" -- faltan: ${!check.ok ? check.missing.join(",") : ""}`);
      });
    }
    if (escenario.config.respuestaSinServicio) {
      it(`${escenario.codigo} respuestaSinServicio pasa validateTextClaimsAgainstVerified`, () => {
        const check = validateTextClaimsAgainstVerified(escenario.config.respuestaSinServicio!, new Set(), { source: "ai_response" });
        assert.ok(check.ok, `BLOQUEADO (${escenario.codigo} respuestaSinServicio): "${escenario.config.respuestaSinServicio}"`);
      });
    }
  }
});
