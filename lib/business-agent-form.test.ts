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
import {
  blankBusinessHours,
  blankCustomerField,
  blankSpecForm,
  customerDataIssues,
  fieldsAgentWillAsk,
  normalizeFormForSave,
  recommendedBookingFields,
  slugifyFieldKey,
  toggleCapability,
  wellKnownCustomerField,
} from "@/lib/business-agent-form";
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

describe("Wizard form — Datos del cliente (R3)", () => {
  const t = (es: string) => es;
  const conAgenda = () => toggleCapability(blankSpecForm(), "scheduling", true);

  it("1. el form en blanco parte sin datos configurados; el conjunto recomendado es nombre (obligatorio) + teléfono del canal", () => {
    assert.deepEqual(blankSpecForm().customerData, { fields: [] });
    const rec = recommendedBookingFields();
    assert.deepEqual(rec.map((f) => [f.key, f.required]), [["nombreCliente", true], ["telefonoCliente", true]]);
    assert.deepEqual(fieldsAgentWillAsk({ ...conAgenda(), customerData: { fields: rec } }).map((f) => f.key), ["nombreCliente"], "el teléfono no se pregunta (viene del canal)");
  });

  it("2. los campos conocidos se agregan con su tipo/alcance fijos; el personalizado nace con clave única", () => {
    assert.equal(wellKnownCustomerField("correoCliente").type, "email");
    assert.equal(wellKnownCustomerField("notas").scope, "booking");
    assert.equal(blankCustomerField([]).key, "campo_1");
    assert.equal(blankCustomerField(["campo_1", "campo_2"]).key, "campo_3");
  });

  it("3. slugifyFieldKey: minúsculas, sin acentos, snake_case, empieza por letra", () => {
    assert.equal(slugifyFieldKey("Edad del paciente"), "edad_del_paciente");
    assert.equal(slugifyFieldKey("¿Número de personas?"), "numero_de_personas");
    assert.equal(slugifyFieldKey("123 abc"), "abc");
    assert.equal(slugifyFieldKey("!!!"), "");
  });

  it("4. customerDataIssues espeja al servidor: con agenda exige Nombre obligatorio; sin capacidad, avisa; sin datos, silencio", () => {
    assert.deepEqual(customerDataIssues(conAgenda(), t), []);
    const sinNombre = { ...conAgenda(), customerData: { fields: [wellKnownCustomerField("correoCliente")] } };
    assert.ok(customerDataIssues(sinNombre, t).some((m) => /Nombre/.test(m)));
    const conNombre = { ...conAgenda(), customerData: { fields: recommendedBookingFields() } };
    assert.deepEqual(customerDataIssues(conNombre, t), []);
    const sinCapacidad = { ...blankSpecForm(), customerData: { fields: [wellKnownCustomerField("nombreCliente")] } };
    assert.ok(customerDataIssues(sinCapacidad, t).some((m) => /requieren/.test(m)));
    const clave = { ...conAgenda(), customerData: { fields: [...recommendedBookingFields(), { ...blankCustomerField([]), key: "fecha", label: "Fecha" }] } };
    assert.ok(customerDataIssues(clave, t).some((m) => /reservada/.test(m)));
  });

  it("5. normalizeFormForSave limpia estados intermedios del editor (opciones vacías, textos en blanco) sin mutar el original", () => {
    const original = {
      ...conAgenda(),
      customerData: {
        fields: [
          { ...wellKnownCustomerField("nombreCliente"), question: "   ", description: "  " },
          { key: " tipo ", label: " Tipo ", type: "select" as const, required: true, enabled: true, scope: "booking" as const, options: [" A ", "", "B", "  "] },
        ],
      },
    };
    const limpio = normalizeFormForSave(original);
    assert.deepEqual(limpio.customerData!.fields[1], { key: "tipo", label: "Tipo", type: "select", required: true, enabled: true, scope: "booking", options: ["A", "B"] });
    assert.equal("question" in limpio.customerData!.fields[0]!, false);
    assert.equal("description" in limpio.customerData!.fields[0]!, false);
    assert.equal(original.customerData.fields[1]!.options!.length, 4, "no muta");
    // un form sin customerData (borrador previo) pasa tal cual
    const viejo = { ...blankSpecForm(), customerData: undefined };
    assert.equal(normalizeFormForSave(viejo), viejo);
  });

  it("6. UI -> Spec -> compiler: el form con datos recomendados compila y genera la pregunta de nombre (extremo a extremo del wizard)", () => {
    let form = blankSpecForm();
    form = { ...form, identity: { ...form.identity, businessName: "Salón X", agentName: "Ana", businessType: "Salón de belleza / Uñas" } };
    form = toggleCapability(form, "scheduling", true);
    form = { ...form, scheduling: { ...form.scheduling, provider: "nylas", businessHours: blankBusinessHours() }, customerData: { fields: recommendedBookingFields() } };
    const spec: BusinessAgentSpec = { schemaVersion: "1.0.0", ...normalizeFormForSave(form), metadata: nuevaSpecMetadata(NOW) };
    const compiled = compileBusinessAgent(spec, CTX);
    if (!compiled.success) return assert.fail("compile: " + JSON.stringify(compiled.diagnostics));
    const flow = compileIRToFlowDefinition(compiled.ir, CTX);
    if (!flow.success) return assert.fail("flow: " + JSON.stringify(flow.diagnostics));
    assert.ok(flow.flow.nodes.some((n) => n.id === "q-data:nombreCliente"));
    assert.equal(flow.flow.nodes.some((n) => n.id === "q-data:telefonoCliente"), false, "el teléfono se toma de WhatsApp");
  });
});
