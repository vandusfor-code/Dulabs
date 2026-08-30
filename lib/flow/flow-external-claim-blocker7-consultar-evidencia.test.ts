/**
 * Blocker #7 (autorizado) — evidencia real para CONSULTAR CITA.
 *
 * consultar_citas_activas_especialista ahora aparece en SOURCE_TO_ACTION
 * (external-claim-security.ts) y declara verifiesOnSuccess: ["appointment.reserved"]
 * en action-capabilities.ts (gateado por outputVariables: ["cantidadCitas"]).
 * La capability se otorga por ÉXITO DE LA LECTURA, no por su contenido — la
 * corrección de datos la garantiza el propio grafo del flow
 * (cond-tiene-citas-router exige cantidadCitas > 0 antes del nodo AI), no
 * esta capability.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VERIFIED_RESULTS_VARIABLE_KEY } from "@/lib/flow/ai-runtime/verified-results";
import {
  extractVerifiedCapabilitiesFromVariables,
  validateTextClaimsAgainstVerified,
} from "@/lib/flow/external-claim-security";

const RESPUESTA = "Sí, tienes una cita de manos mañana a las 3.";
const USER_TRANSACCIONAL = "¿Tengo cita mañana?";

describe("Blocker #7 — evidencia real desde consultar_citas_activas_especialista", () => {
  it("11. lectura real verificada (cantidadCitas > 0) → ALLOW para la respuesta verdadera", () => {
    const variables = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        {
          verified: true,
          source: "consultar_citas_activas_especialista",
          data: { cantidadCitas: 1, citasActivas: [{ id: "c1", servicio: "manos", inicio: "2026-08-30T15:00:00Z" }] },
        },
      ],
    };
    const check = validateTextClaimsAgainstVerified(
      RESPUESTA,
      extractVerifiedCapabilitiesFromVariables(variables),
      { userMessage: USER_TRANSACCIONAL },
    );
    assert.equal(check.ok, true, "una lectura real verificada debe habilitar la respuesta verdadera");
  });

  it("12. verified result de OTRA capability (payment.completed) no debe \"contaminar\" appointment.reserved", () => {
    const variables = {
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "consultar_pago", data: { paymentStatus: "ok" } },
      ],
    };
    const check = validateTextClaimsAgainstVerified(
      RESPUESTA,
      extractVerifiedCapabilitiesFromVariables(variables),
      { userMessage: USER_TRANSACCIONAL },
    );
    assert.equal(check.ok, false, "una capability de otro dominio no debe habilitar una afirmación de cita");
  });

  it("13. sin ningún verified result → sigue BLOCK (no regresión del gate)", () => {
    const check = validateTextClaimsAgainstVerified(
      RESPUESTA,
      extractVerifiedCapabilitiesFromVariables({}),
      { userMessage: USER_TRANSACCIONAL },
    );
    assert.equal(check.ok, false, "sin evidencia verificada, la afirmación debe seguir bloqueada");
  });

  it("14. GAP CONOCIDO, NO RESUELTO EN ESTE BLOCKER: \"No tienes ninguna cita\" con contexto transaccional sigue exigiendo evidencia (isPropositionDirectNegativeState no reconoce \"no tienes\"). Documentado, no corregido — fuera de alcance de los 3 gaps autorizados.", () => {
    const check = validateTextClaimsAgainstVerified(
      "No tienes ninguna cita activa por ahora.",
      extractVerifiedCapabilitiesFromVariables({}),
      { userMessage: USER_TRANSACCIONAL },
    );
    assert.equal(
      check.ok,
      false,
      "comportamiento actual documentado: una negación legítima también exige evidencia hoy (gap preexistente, no introducido por este blocker, no resuelto aquí)",
    );
  });
});
