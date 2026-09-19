/**
 * Agent Compiler (Fase 1) — Step 4: BusinessAgentSpec.
 * Tests obligatorios (1..12). Sin servicios externos: validación pura (Zod +
 * refinements) y helpers de versionado.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateBusinessAgentSpec } from "@/lib/agent-compiler/spec/validate";
import { bumpSpec, marcarPublicada, nuevaSpecMetadata } from "@/lib/agent-compiler/spec/version";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";

const NOW = "2026-09-18T00:00:00.000Z";

function specValido(): BusinessAgentSpec {
  return {
    schemaVersion: "1.0.0",
    identity: { businessName: "Estudio Foto X", agentName: "Ana", language: "es-CO", timezone: "America/Bogota" },
    personality: { primary: "professional", verbosity: "balanced", emojiPolicy: "limited", formality: "neutral" },
    capabilities: { faq: true, sales: true, catalog: true, leadCapture: true, scheduling: true, orders: false, payments: false, humanHandoff: true },
    catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false },
    policies: {
      prohibitions: [
        { id: "p1", description: "No mascotas en estudio", scope: "contextual", action: "BLOCK", priority: 10, response: "En estudio no se permiten mascotas.", condition: { match: "all", rules: [{ field: "session_type", operator: "equals", value: "estudio" }, { field: "message", operator: "contains", value: "mascota" }] } },
        { id: "p2", description: "No descuentos por chat", scope: "business", action: "FIXED_RESPONSE", response: "Los descuentos los maneja un asesor.", priority: 5 },
      ],
      rules: [
        { id: "r1", description: "Llegar 15 minutos antes", kind: "reminder", priority: 1 },
        { id: "r2", description: "Traer documento de identidad", kind: "requirement", priority: 2 },
      ],
    },
    handoff: {
      rules: [
        { id: "h1", description: "Pide hablar con Daniel", trigger: { kind: "agent_request" }, action: "TRANSFER_HUMAN", pauseHours: 2 },
        { id: "h2", description: "Queja", trigger: { kind: "complaint" }, action: "FIXED_RESPONSE_THEN_PAUSE", response: "Lamentamos lo ocurrido, te comunico con una persona.", pauseHours: 1 },
      ],
      defaultPauseHours: 1,
    },
    scheduling: {
      enabled: true,
      provider: "internal",
      timezone: "America/Bogota",
      minNoticeMinutes: 60,
      cancellation: { allowed: true, minNoticeHours: 24 },
      confirmation: { required: true, hoursBefore: 24 },
      resources: [{ kind: "specialist", label: "Fotógrafo", required: true }],
    },
    knowledge: { authority: "secondary", documents: [{ id: "d1", filename: "catalogo.pdf", uploadedAt: NOW }] },
    metadata: nuevaSpecMetadata(NOW),
  };
}

/** Copia profunda para variar sin mutar el válido. */
function clon(spec: BusinessAgentSpec): BusinessAgentSpec {
  return structuredClone(spec);
}

describe("BusinessAgentSpec — validación y versionado", () => {
  it("1. crea un BusinessAgentSpec válido", () => {
    const r = validateBusinessAgentSpec(specValido());
    assert.equal(r.valid, true, JSON.stringify(r.issues));
    assert.equal(r.issues.length, 0);
  });

  it("2. rechaza configuración inválida (campo faltante / enum inválido)", () => {
    const s = clon(specValido()) as unknown as Record<string, unknown>;
    delete (s.identity as Record<string, unknown>).businessName;
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "SPEC_SCHEMA_INVALID"));
  });

  it("3. capabilities tipadas: habilitar una sin herramienta real se rechaza", () => {
    const s = clon(specValido());
    s.capabilities.payments = true;
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "CAPABILITY_UNAVAILABLE" && i.evidence === "payments"));
  });

  it("4. personalidad estructurada: enum inválido se rechaza", () => {
    const s = clon(specValido()) as unknown as { personality: Record<string, string> };
    s.personality.emojiPolicy = "expressive";
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "SPEC_SCHEMA_INVALID"));
  });

  it("5. prohibiciones estructuradas: contextual sin condición se rechaza", () => {
    const s = clon(specValido());
    delete s.policies.prohibitions[0]!.condition; // p1 es contextual
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "SPEC_SCHEMA_INVALID"));
  });

  it("6. reglas estructuradas: kind inválido se rechaza; válidas pasan", () => {
    const ok = validateBusinessAgentSpec(specValido());
    assert.equal(ok.valid, true);
    const s = clon(specValido()) as unknown as { policies: { rules: Record<string, string>[] } };
    s.policies.rules[0]!.kind = "urgente";
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "SPEC_SCHEMA_INVALID"));
  });

  it("7. human handoff: transferencia con humanHandoff deshabilitada se rechaza", () => {
    const s = clon(specValido());
    s.capabilities.humanHandoff = false;
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "SPEC_REFERENCE_INVALID"));
  });

  it("8. scheduling: enabled sin capability scheduling se rechaza", () => {
    const s = clon(specValido());
    s.scheduling.enabled = true;
    s.capabilities.scheduling = false;
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "CAPABILITY_INCOMPATIBLE"));
  });

  it("9. versionado: bump incrementa y NO muta; publicada coexiste", () => {
    const v1 = marcarPublicada(specValido(), NOW); // publicada, v1
    const v2 = bumpSpec(v1, { catalog: { source: "structured", useServices: true, useProducts: true, quoteBeforeQualification: false } }, NOW);
    assert.equal(v1.metadata.specVersion, 1);
    assert.equal(v1.metadata.status, "published", "la publicada no cambió");
    assert.equal(v2.metadata.specVersion, 2);
    assert.equal(v2.metadata.status, "draft");
    assert.notEqual(v1, v2);
    assert.equal(v1.catalog.useProducts, false, "el original no fue mutado");
    assert.equal(v2.catalog.useProducts, true);
    assert.equal(validateBusinessAgentSpec(v2).valid, true);
  });

  it("10. tenant isolation: un tenantId/id_tenant inyectado se rechaza", () => {
    const s = clon(specValido()) as unknown as Record<string, unknown>;
    (s.identity as Record<string, unknown>).id_tenant = "22222222-2222-2222-2222-222222222222";
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "SPEC_TENANT_INJECTION"));
  });

  it("11. compatibilidad futura: schemaVersion no soportado se rechaza; 1.0.0 pasa", () => {
    const s = clon(specValido()) as unknown as { schemaVersion: string };
    s.schemaVersion = "2.0.0";
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "SPEC_SCHEMA_INVALID"));
  });

  it("12. referencias inválidas: sales sin catalog y prioridades duplicadas se rechazan", () => {
    const s1 = clon(specValido());
    s1.capabilities.catalog = false; // sales requiere catalog
    s1.catalog.useServices = false;
    const r1 = validateBusinessAgentSpec(s1);
    assert.equal(r1.valid, false);
    assert.ok(r1.issues.some((i) => i.code === "CAPABILITY_INCOMPATIBLE"));

    const s2 = clon(specValido());
    s2.policies.prohibitions[1]!.priority = 10; // duplica la prioridad de p1
    const r2 = validateBusinessAgentSpec(s2);
    assert.equal(r2.valid, false);
    assert.ok(r2.issues.some((i) => i.code === "SPEC_REFERENCE_INVALID"));
  });

  // Bloque 18 (hardening de payload/costo): topes de tamaño en strings y arrays.
  it("13. hardening: un string por encima del tope (description) se rechaza", () => {
    const s = clon(specValido());
    s.identity.description = "x".repeat(4001); // > MAX_TEXTO_LARGO
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "SPEC_SCHEMA_INVALID"));
  });

  it("14. hardening: un array por encima del tope (resources) se rechaza", () => {
    const s = clon(specValido());
    s.scheduling.resources = Array.from({ length: 51 }, (_, i) => ({ kind: "specialist", label: `R${i}`, required: false }));
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "SPEC_SCHEMA_INVALID"));
  });

  it("15. hardening: contenido dentro de los topes generosos sigue siendo válido (no rechaza Specs reales)", () => {
    const s = clon(specValido());
    s.identity.description = "x".repeat(4000); // == MAX_TEXTO_LARGO
    s.identity.businessName = "y".repeat(2000); // == MAX_TEXTO
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, true, JSON.stringify(r.issues));
  });

  // Tipo de negocio (dropdown + "Otro"). businessType es opcional en el contrato
  // (compatibilidad con Specs previos, ver test 1 que no lo trae).
  it("16. tipo de negocio: una opción normal es válida", () => {
    const s = clon(specValido());
    s.identity.businessType = "Salón de belleza / Uñas";
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, true, JSON.stringify(r.issues));
  });

  it("17. tipo de negocio: 'Otro' sin texto libre se rechaza", () => {
    const s = clon(specValido());
    s.identity.businessType = "Otro";
    s.identity.businessTypeCustom = ""; // vacío == no especificado
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "SPEC_SCHEMA_INVALID"));
  });

  it("18. tipo de negocio: 'Otro' con texto libre es válido", () => {
    const s = clon(specValido());
    s.identity.businessType = "Otro";
    s.identity.businessTypeCustom = "Taller de reparación de celulares";
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, true, JSON.stringify(r.issues));
  });

  // Rebanada 2: agendamiento con calendario (nylas) exige horario de atención.
  it("19. agendamiento nylas SIN horario de atención => inválido", () => {
    const s = clon(specValido());
    s.scheduling.provider = "nylas";
    delete s.scheduling.businessHours;
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "SPEC_REFERENCE_INVALID" && /horario/i.test(i.message)));
  });

  it("20. agendamiento nylas CON horario de atención => válido", () => {
    const s = clon(specValido());
    s.scheduling.provider = "nylas";
    s.scheduling.businessHours = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "09:00", close: "18:00" }] })), exceptions: [] };
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, true, JSON.stringify(r.issues));
  });

  it("21. agendamiento 'internal' NO exige businessHours (usa horarios de especialistas)", () => {
    const s = clon(specValido()); // provider internal por defecto, sin businessHours
    const r = validateBusinessAgentSpec(s);
    assert.equal(r.valid, true, JSON.stringify(r.issues));
  });
});
