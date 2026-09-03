/**
 * Corrección Claim Security (autorizada, PARCIALMENTE REVERTIDA) — intento
 * original: que un texto sin ningún dominio de negocio reconocido no cayera
 * en el fallback fail-closed "exige TODAS las capabilities"
 * (requiredCapabilitiesForIntent, rama completion_signal). REVERTIDO tras
 * comprobar con la suite existente (flow-external-claim-failclosed.test.ts,
 * lista MANDATORY_BLOCKED/GENERIC_COMPLETIONS) que ese fallback protege
 * deliberadamente frases de completitud genéricas y ambiguas ("Ya quedó.",
 * "Perfecto, está confirmado.", "Ya te transferimos."...) que tampoco
 * mencionan un dominio explícito -- quitarlo rompió 19 tests preexistentes.
 * requiredCapabilitiesForIntent quedó EXACTAMENTE como estaba antes de esta
 * fase (fallback a ALL_ASSERTION_CAPABILITIES intacto). El mensaje original
 * del laboratorio ("👋 Hola. La prueba del Trigger Router...") SIGUE
 * bloqueado -- ver el reporte de esta fase para el análisis completo.
 *
 * Lo único que SÍ queda vigente de este intento es la ampliación de
 * DOMAIN_CAPABILITY_RULES (independiente del fallback, puramente aditiva,
 * no revertida): reconoce "recepción/toma de un caso" como
 * support.transferred sin las palabras literales soporte/humano/agente/asesor.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectDomainCapabilities,
  validateTextClaimsAgainstVerified,
} from "@/lib/flow/external-claim-security";

const SOURCE = { source: "message_resolved" as const };

describe("Mensajes genéricos sin dominio -- estado ACTUAL tras revertir el fallback (bug SIN resolver)", () => {
  it("1. mensaje del laboratorio Trigger Router -> SIGUE BLOQUEADO (fallback revertido, bug abierto)", () => {
    const texto = "👋 Hola. La prueba del Trigger Router de DuLabs está funcionando correctamente.";
    const check = validateTextClaimsAgainstVerified(texto, new Set(), SOURCE);
    assert.equal(check.ok, false, "documenta el estado actual real -- este es el bug pendiente de resolver, NO el objetivo deseado");
  });

  it("2. bienvenida genérica -> permitido (nunca dependió del fallback removido/revertido)", () => {
    const texto = "¡Bienvenido a SOLOTALENTO SAS!";
    assert.deepEqual(validateTextClaimsAgainstVerified(texto, new Set(), SOURCE), { ok: true });
  });

  it("2b. mensaje de cortesía -> permitido (nunca dependió del fallback removido/revertido)", () => {
    const texto = "Es un gusto tenerte por aquí.";
    assert.deepEqual(validateTextClaimsAgainstVerified(texto, new Set(), SOURCE), { ok: true });
  });

  it("3. pregunta informativa genérica -> permitido (nunca dependió del fallback removido/revertido)", () => {
    const texto = "¿En qué podemos ayudarte?";
    assert.deepEqual(validateTextClaimsAgainstVerified(texto, new Set(), SOURCE), { ok: true });
  });

  it("3b. 'Perfecto, hemos identificado lo que necesitas.' -> SIGUE BLOQUEADO (mismo bug abierto que #1)", () => {
    const texto = "Perfecto, hemos identificado lo que necesitas.";
    const check = validateTextClaimsAgainstVerified(texto, new Set(), SOURCE);
    assert.equal(check.ok, false, "documenta el estado actual real -- bug pendiente, mismo que #1");
  });
});

describe("Frontera de seguridad: claims de dominio real siguen bloqueados exactamente igual", () => {
  it("4. cita confirmada -> BLOQUEADO, missing=[appointment.reserved]", () => {
    const texto = "Tu cita fue confirmada.";
    const check = validateTextClaimsAgainstVerified(texto, new Set(), SOURCE);
    assert.equal(check.ok, false);
    if (!check.ok) assert.deepEqual(check.missing, ["appointment.reserved"]);
  });

  it("5. pago procesado -> BLOQUEADO, missing=[payment.completed]", () => {
    const texto = "Tu pago fue procesado.";
    const check = validateTextClaimsAgainstVerified(texto, new Set(), SOURCE);
    assert.equal(check.ok, false);
    if (!check.ok) assert.deepEqual(check.missing, ["payment.completed"]);
  });

  it("6. lead registrado -> BLOQUEADO, missing=[lead.created]", () => {
    const texto = "Tu solicitud fue registrada como lead.";
    const check = validateTextClaimsAgainstVerified(texto, new Set(), SOURCE);
    assert.equal(check.ok, false);
    if (!check.ok) assert.deepEqual(check.missing, ["lead.created"]);
  });

  it("7. 'Nuestro equipo ya recibió tu caso.' -> BLOQUEADO por dominio real support.transferred, NO por el fallback de todas las capabilities", () => {
    const texto = "Nuestro equipo ya recibió tu caso.";
    assert.deepEqual(
      detectDomainCapabilities(texto),
      ["support.transferred"],
      "el nuevo patrón de DOMAIN_CAPABILITY_RULES debe reconocer esto como dominio real",
    );
    const check = validateTextClaimsAgainstVerified(texto, new Set(), SOURCE);
    assert.equal(check.ok, false);
    if (!check.ok) {
      assert.deepEqual(
        check.missing,
        ["support.transferred"],
        "debe exigir SOLO support.transferred, nunca las 7 capabilities del fallback antiguo",
      );
    }
  });

  it("8. claim con capability YA verificada -> PERMITIDO", () => {
    const texto = "Tu cita fue confirmada.";
    const check = validateTextClaimsAgainstVerified(texto, new Set(["appointment.reserved"]), SOURCE);
    assert.deepEqual(check, { ok: true });
  });
});

describe("DOMAIN_CAPABILITY_RULES — nuevo patrón de recepción/toma de caso (positivos/negativos)", () => {
  it("positivo: 'Un agente recibió tu caso.' -> support.transferred", () => {
    assert.deepEqual(detectDomainCapabilities("Un agente recibió tu caso."), ["support.transferred"]);
  });

  it("positivo: 'Un asesor tomó tu caso.' -> support.transferred", () => {
    assert.deepEqual(detectDomainCapabilities("Un asesor tomó tu caso."), ["support.transferred"]);
  });

  it("positivo: 'Recibimos tu caso.' -> support.transferred", () => {
    assert.deepEqual(detectDomainCapabilities("Recibimos tu caso."), ["support.transferred"]);
  });

  it("'Recibimos tu solicitud.' -> support.transferred (nuevo) + lead.created (regla ya existente, sin relación con este cambio)", () => {
    assert.deepEqual(detectDomainCapabilities("Recibimos tu solicitud."), ["lead.created", "support.transferred"]);
  });

  it("positivo (transferencia explícita, patrón ya existente): 'Te hemos transferido con un asesor.' -> support.transferred", () => {
    assert.deepEqual(detectDomainCapabilities("Te hemos transferido con un asesor."), ["support.transferred"]);
  });

  it("negativo: 'Nuestro equipo está disponible.' -> el nuevo patrón NO agrega support.transferred (matchea appointment.available por la regla preexistente de 'disponible', sin relación con este cambio)", () => {
    const caps = detectDomainCapabilities("Nuestro equipo está disponible.");
    assert.ok(!caps.includes("support.transferred"), `no debe incluir support.transferred, obtuvo ${JSON.stringify(caps)}`);
  });

  it("negativo: 'Nuestro equipo puede ayudarte.' -> sin dominio", () => {
    assert.deepEqual(detectDomainCapabilities("Nuestro equipo puede ayudarte."), []);
  });

  it("negativo: 'Cuéntanos tu caso.' -> sin dominio", () => {
    assert.deepEqual(detectDomainCapabilities("Cuéntanos tu caso."), []);
  });

  it("negativo: 'Tenemos un equipo especializado.' -> sin dominio", () => {
    assert.deepEqual(detectDomainCapabilities("Tenemos un equipo especializado."), []);
  });

  it("palabras sueltas NO disparan support.transferred por separado", () => {
    assert.deepEqual(detectDomainCapabilities("equipo"), []);
    assert.deepEqual(detectDomainCapabilities("caso"), []);
    assert.deepEqual(detectDomainCapabilities("solicitud"), ["lead.created"], "ya cubierto por la regla existente de lead, sin relación con este cambio");
  });
});
