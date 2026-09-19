/**
 * Wizard/formulario — toggleCapability (transición pura del estado del form).
 *
 * Cubre el bug real del checkbox "Agendar citas" (paso Capacidades): activar
 * scheduling DEBE cambiar capabilities.scheduling Y scheduling.enabled a la vez.
 * Antes el handler hacía dos update() encadenados sobre el mismo `form` y el
 * segundo pisaba al primero, así que capabilities.scheduling nunca cambiaba y el
 * checkbox parecía "congelado". Estos tests prueban que el estado cambia de
 * verdad y que llega hasta el Spec y el compiler (crear_cita_nylas_generico).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blankBusinessHours, blankSpecForm, toggleCapability } from "@/lib/business-agent-form";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { nuevaSpecMetadata } from "@/lib/agent-compiler/spec/version";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";

const NOW = "2026-09-19T00:00:00.000Z";
const CTX = { tenantId: "11111111-1111-4111-8111-111111111111" };

describe("Wizard form — toggleCapability (fix checkbox 'Agendar citas')", () => {
  it("1. activar 'scheduling' marca capabilities.scheduling Y scheduling.enabled a la vez", () => {
    const before = blankSpecForm();
    assert.equal(before.capabilities.scheduling, false);
    assert.equal(before.scheduling.enabled, false);
    const after = toggleCapability(before, "scheduling", true);
    assert.equal(after.capabilities.scheduling, true, "la capacidad debe quedar activa (este era el bug)");
    assert.equal(after.scheduling.enabled, true, "scheduling.enabled queda sincronizado");
    // Transición pura: no muta el original.
    assert.equal(before.capabilities.scheduling, false);
    assert.equal(before.scheduling.enabled, false);
  });

  it("2. activar 'scheduling' sin proveedor usa 'internal'; desactivar apaga ambos", () => {
    const on = toggleCapability(blankSpecForm(), "scheduling", true);
    assert.equal(on.scheduling.provider, "internal");
    const off = toggleCapability(on, "scheduling", false);
    assert.equal(off.capabilities.scheduling, false);
    assert.equal(off.scheduling.enabled, false);
  });

  it("3. re-activar 'scheduling' NO pisa un proveedor ya elegido (p.ej. nylas)", () => {
    let f = toggleCapability(blankSpecForm(), "scheduling", true);
    f = { ...f, scheduling: { ...f.scheduling, provider: "nylas" } };
    const reon = toggleCapability({ ...f, scheduling: { ...f.scheduling, enabled: false } }, "scheduling", true);
    assert.equal(reon.scheduling.provider, "nylas", "no fuerza 'internal' si ya hay un proveedor real");
  });

  it("4. alternar otra capacidad NO toca scheduling", () => {
    const withSched = toggleCapability(blankSpecForm(), "scheduling", true);
    const after = toggleCapability(withSched, "leadCapture", true);
    assert.equal(after.capabilities.leadCapture, true);
    assert.equal(after.capabilities.scheduling, true, "scheduling intacto");
    assert.equal(after.scheduling.enabled, true);
  });

  it("5. el estado activado llega al Spec y el compiler genera crear_cita_nylas_generico (provider nylas)", () => {
    let form = blankSpecForm();
    form = { ...form, identity: { ...form.identity, businessName: "Barbería X", agentName: "Ana", businessType: "Barbería / Peluquería" } };
    form = toggleCapability(form, "scheduling", true); // enabled + provider internal
    // el usuario elige Nylas + configura horario (rebanada 2: nylas lo exige)
    form = { ...form, scheduling: { ...form.scheduling, provider: "nylas", businessHours: blankBusinessHours() } };

    const spec: BusinessAgentSpec = { schemaVersion: "1.0.0", ...form, metadata: nuevaSpecMetadata(NOW) };
    // (b) el Spec resultante contiene scheduling activo.
    assert.equal(spec.capabilities.scheduling, true);
    assert.equal(spec.scheduling.enabled, true);
    assert.equal(spec.scheduling.provider, "nylas");

    // (c) el compiler produce la acción real de agendamiento genérico.
    const compiled = compileBusinessAgent(spec, CTX);
    if (!compiled.success) return assert.fail("compile: " + JSON.stringify(compiled.diagnostics));
    const flow = compileIRToFlowDefinition(compiled.ir, CTX);
    if (!flow.success) return assert.fail("flow: " + JSON.stringify(flow.diagnostics));
    const actBook = flow.flow.nodes.find((n) => n.id === "act-book");
    assert.ok(actBook && actBook.type === "action", "debe existir la acción de agendamiento");
    assert.equal((actBook as { config: { actionType: string } }).config.actionType, "crear_cita_nylas_generico");
  });
});
