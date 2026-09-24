/**
 * Política de runtime en el bridge (mecanismo genérico). Regresión: sin
 * política, el resultado del Flow llega INTACTO al webhook (mismo fallback a
 * LEGACY de siempre para AMORE, Daniela, Solo Talento y cualquier otro).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { aplicarPoliticaAlResultado, type ResultadoIntentoFlow } from "@/lib/flow-runtime-bridge";

const noAtendido: ResultadoIntentoFlow = { handled: false, motivo: "fallback_a_legacy" };
const atendido: ResultadoIntentoFlow = { handled: true, motivo: "processed_ok" };

describe("aplicarPoliticaAlResultado", () => {
  it("sin política (todo flow existente): el resultado no cambia — sigue cayendo a LEGACY cuando corresponde", () => {
    assert.equal(aplicarPoliticaAlResultado({}, noAtendido), noAtendido);
    assert.equal(aplicarPoliticaAlResultado({ restart: { keywords: ["menú"] } }, noAtendido), noAtendido);
    assert.equal(aplicarPoliticaAlResultado({ deterministic: false }, noAtendido), noAtendido);
  });
  it("flow determinista que no atendió: atendido sin respuesta, nunca IA legacy", () => {
    assert.deepEqual(aplicarPoliticaAlResultado({ deterministic: true }, noAtendido), {
      handled: true,
      motivo: "sin_fallback_flow_determinista",
    });
  });
  it("flow determinista que sí atendió: resultado intacto", () => {
    assert.equal(aplicarPoliticaAlResultado({ deterministic: true }, atendido), atendido);
  });
});

describe("bridge — estructura (sin excepciones por negocio)", () => {
  const src = readFileSync(join(__dirname, "flow-runtime-bridge.ts"), "utf8");
  it("los atajos fuera del grafo solo se saltan por la política del flow, nunca por un negocio concreto", () => {
    assert.match(src, /atajosFueraDelGrafo: !politica\.deterministic/);
    assert.ok(!/publibordados/i.test(src), "el bridge no menciona a Publi Bordados");
    assert.ok(!src.includes("1337486632773969"), "ni su número");
  });
});
