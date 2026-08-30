/**
 * Blocker #7 (autorizado) — cierre de los 3 gaps de claims detectados durante
 * el enrutador de intenciones de Daniela:
 *   1. Conjugaciones acentuadas de agendar/reservar/asegurar ("agendé",
 *      "agendó", "reservé") no eran reconocidas por el límite de palabra
 *      ASCII (\w) de JS.
 *   2. "Te esperamos [mañana/hoy/a las N]" no estaba en ninguna lista de
 *      dominio.
 *   3. "tienes/tengo + cita" no activaba el marcador de instancia del
 *      cliente, dejando pasar afirmaciones sin evidencia cuando el mensaje
 *      del usuario no aportaba ya contexto transaccional propio.
 *
 * No se toca ninguna otra regla de clasificación, scoring o negación.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  analyzeTextForExternalClaims,
  extractVerifiedCapabilitiesFromVariables,
  validateTextClaimsAgainstVerified,
} from "@/lib/flow/external-claim-security";

function required(ai: string, user?: string) {
  return analyzeTextForExternalClaims(ai, user ? { userMessage: user } : undefined).requiredCapabilities;
}

function allow(ai: string, user?: string) {
  const check = validateTextClaimsAgainstVerified(ai, extractVerifiedCapabilitiesFromVariables({}), user ? { userMessage: user } : undefined);
  assert.equal(check.ok, true, `expected ALLOW (sin gate): "${ai}"`);
  assert.equal(required(ai, user).length, 0, `expected requiredCapabilities vacío para: "${ai}"`);
}

function requiresEvidence(ai: string, user?: string, cap = "appointment.reserved") {
  const caps = required(ai, user);
  assert.ok(caps.length > 0, `expected requiredCapabilities no vacío para: "${ai}"`);
  assert.ok(caps.includes(cap as never), `expected incluir ${cap}, obtuvo ${caps.join(",")}`);
}

describe("Blocker #7 — gap 1: conjugaciones acentuadas de agendar/reservar", () => {
  it('1. "Te agendé para mañana" sin contexto → antes [] , ahora exige evidencia', () => {
    requiresEvidence("Te agendé para mañana");
  });

  it('2. "Ya te agendó Camila" (variante 3ª persona, mismo bug de acento) → exige evidencia', () => {
    requiresEvidence("Ya te agendó Camila");
  });

  it('3. "Te reservé tu cupo" → exige evidencia', () => {
    requiresEvidence("Te reservé tu cupo");
  });
});

describe("Blocker #7 — gap 2: \"te esperamos\" + referencia temporal (patrón acotado)", () => {
  it('4. "Te esperamos mañana" sin contexto → exige evidencia', () => {
    requiresEvidence("Te esperamos mañana");
  });

  it('5. "Te esperamos mañana a las 5." sin contexto → exige evidencia', () => {
    requiresEvidence("Te esperamos mañana a las 5.");
  });

  it('6. "Esperamos tu respuesta" → NO debe bloquearse (regresión negativa explícita)', () => {
    allow("Esperamos tu respuesta");
  });

  it('7. "Esperamos que te guste el servicio" → NO debe bloquearse', () => {
    allow("Esperamos que te guste el servicio");
  });
});

describe("Blocker #7 — gap 3: tener/tienes + cita, contextual (no vocabulario global)", () => {
  it('8. "Sí, tienes una cita de manos mañana a las 3." sin contexto → hoy [], hueco de seguridad cerrado', () => {
    requiresEvidence("Sí, tienes una cita de manos mañana a las 3.");
  });

  const negativos = [
    "Tengo una pregunta",
    "Tengo disponibilidad",
    "¿Tienes información?",
    "Tengo una duda",
    "No tengo tiempo",
  ];
  for (const [i, texto] of negativos.entries()) {
    it(`9.${i + 1} "${texto}" → NO debe activarse (verbo aislado, sin dominio de cita)`, () => {
      allow(texto);
    });
  }

  it('10. "Tengo una pregunta sobre mi cita" → NO debe activarse (caso límite: "cita" lejana de "tengo")', () => {
    allow("Tengo una pregunta sobre mi cita");
  });
});
