/**
 * R3 — datos del cliente a través del pipeline Spec -> validación -> IR ->
 * FlowDefinition. 100% offline. Cubre: schema válido/inválido, requerido/
 * opcional, coherencia con capabilities, compatibilidad hacia atrás, que el
 * compiler TRANSPORTE la configuración y que los nodos generados sean válidos
 * para el Flow Engine y para publicar.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateBusinessAgentSpec } from "@/lib/agent-compiler/spec/validate";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { commercialStateFromNodeId } from "@/lib/agent-compiler/runtime/commercial-state-resolver";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";
import { salonSpec, retailSpec } from "@/lib/agent-compiler/runtime/fixtures";
import type { AgentCapabilities, BusinessAgentSpec, CustomerField } from "@/lib/agent-compiler/spec/types";
import type { CompiledBusinessAgentIR } from "@/lib/agent-compiler/ir";
import type { FlowDefinition } from "@/lib/flow/types";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CTX = { tenantId: TENANT };

function caps(on: Partial<AgentCapabilities>): AgentCapabilities {
  const base = Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, false])) as AgentCapabilities;
  return { ...base, ...on };
}
function campo(over: Partial<CustomerField> & Pick<CustomerField, "key" | "type">): CustomerField {
  return { label: over.key, required: false, enabled: true, scope: "customer", ...over };
}
const NOMBRE = campo({ key: "nombreCliente", type: "text", label: "Nombre", required: true });
const TELEFONO = campo({ key: "telefonoCliente", type: "phone", label: "Teléfono", required: true });
const CORREO = campo({ key: "correoCliente", type: "email", label: "Correo", required: false });
const MOTIVO_NOTAS = campo({ key: "notas", type: "text", label: "Notas", scope: "booking" });

const HORARIO = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "08:00", close: "20:00" }] })), exceptions: [] };

/** Agente de agenda Nylas (sin catálogo/faq: camino más corto al booking). */
function nylasSpec(fields?: CustomerField[]): BusinessAgentSpec {
  const s = salonSpec();
  return {
    ...s,
    capabilities: caps({ scheduling: true, humanHandoff: true }),
    catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
    scheduling: { ...s.scheduling, provider: "nylas", businessHours: HORARIO },
    ...(fields ? { customerData: { fields } } : {}),
  };
}

/** Spec mínimo SIN agenda ni leads (solo FAQ): base limpia para probar coherencia con capabilities. */
function soloFaqSpec(fields: CustomerField[]): BusinessAgentSpec {
  const s = retailSpec();
  return {
    ...s,
    capabilities: caps({ faq: true }),
    catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
    policies: { prohibitions: [], rules: [] },
    handoff: { rules: [], defaultPauseHours: 24 },
    customerData: { fields },
  };
}

function compilar(spec: BusinessAgentSpec): { ir: CompiledBusinessAgentIR; flow: FlowDefinition } {
  const c = compileBusinessAgent(spec, CTX);
  assert.ok(c.success, "compile: " + JSON.stringify(c.success ? [] : c.diagnostics));
  const f = compileIRToFlowDefinition(c.ir, CTX);
  assert.ok(f.success, "flow: " + JSON.stringify(f.success ? [] : f.diagnostics));
  return { ir: c.ir, flow: f.flow };
}
const codes = (spec: unknown) => validateBusinessAgentSpec(spec).issues.map((i) => `${i.code}:${i.message}`);

describe("R3 — Spec: schema y reglas (validate)", () => {
  it("1. Spec con datos del cliente válidos (requerido + opcional + de reserva) es válido", () => {
    const r = validateBusinessAgentSpec(nylasSpec([NOMBRE, TELEFONO, CORREO, MOTIVO_NOTAS]));
    assert.deepEqual(r.issues, []);
    assert.equal(r.valid, true);
  });

  it("2. schema inválido: tipo desconocido, scope desconocido, label vacío, key vacía, campos de más", () => {
    const mala = (over: Record<string, unknown>) => nylasSpec([NOMBRE, { ...campo({ key: "x", type: "text" }), ...over } as CustomerField]);
    assert.equal(validateBusinessAgentSpec(mala({ type: "hologram" })).valid, false);
    assert.equal(validateBusinessAgentSpec(mala({ scope: "global" })).valid, false);
    assert.equal(validateBusinessAgentSpec(mala({ label: "" })).valid, false);
    assert.equal(validateBusinessAgentSpec(mala({ key: "" })).valid, false);
    assert.equal(validateBusinessAgentSpec(mala({ required: "si" })).valid, false);
    const muchos = Array.from({ length: 21 }, (_, i) => campo({ key: `c_${i}`, type: "text" }));
    assert.equal(validateBusinessAgentSpec(nylasSpec([NOMBRE, ...muchos])).valid, false);
  });

  it("3. clave reservada / duplicada / tipo incompatible con clave conocida => bloquea", () => {
    assert.ok(codes(nylasSpec([NOMBRE, campo({ key: "fecha", type: "text" })])).some((c) => /reservada/.test(c)));
    assert.ok(codes(nylasSpec([NOMBRE, NOMBRE])).some((c) => /repetida/.test(c)));
    assert.ok(codes(nylasSpec([{ ...NOMBRE, type: "number" }])).some((c) => /significado fijo/.test(c)));
  });

  it("4. select sin opciones suficientes => bloquea; con opciones => válido", () => {
    assert.equal(validateBusinessAgentSpec(nylasSpec([NOMBRE, campo({ key: "tipo", type: "select", options: ["Solo una"] })])).valid, false);
    assert.equal(validateBusinessAgentSpec(nylasSpec([NOMBRE, campo({ key: "tipo", type: "select", options: ["A", "B"] })])).valid, true);
  });

  it("5. con agendamiento el Nombre es obligatorio (la reserva lo exige): sin él o no requerido => bloquea", () => {
    assert.ok(codes(nylasSpec([CORREO])).some((c) => /Nombre/.test(c)));
    assert.ok(codes(nylasSpec([{ ...NOMBRE, required: false }])).some((c) => /Nombre/.test(c)));
    assert.ok(codes(nylasSpec([{ ...NOMBRE, enabled: false }, CORREO])).some((c) => /Nombre/.test(c)), "nombre desactivado + otro campo activo");
  });

  it("6. coherencia con capabilities: datos sin leadCapture ni scheduling => bloquea; de reserva sin scheduling => bloquea", () => {
    assert.ok(codes(soloFaqSpec([NOMBRE])).some((c) => /Captar datos del cliente/.test(c)));
    assert.deepEqual(codes(soloFaqSpec([])), [], "base limpia sin datos: válida");
    const leadSinAgenda: BusinessAgentSpec = { ...retailSpec(), customerData: { fields: [NOMBRE, MOTIVO_NOTAS] } };
    assert.ok(codes(leadSinAgenda).some((c) => /requieren la capacidad 'Agendar citas'/.test(c)));
    // leadCapture con datos del cliente (sin agenda) es válido
    const leadOk: BusinessAgentSpec = { ...retailSpec(), customerData: { fields: [NOMBRE] } };
    assert.deepEqual(codes(leadOk), []);
  });

  it("7. campos desactivados no disparan reglas de coherencia (se conservan en el Spec)", () => {
    assert.deepEqual(codes(soloFaqSpec([{ ...NOMBRE, enabled: false }])), []);
  });

  it("8. compatibilidad hacia atrás: Spec sin customerData (o con lista vacía) sigue siendo válido", () => {
    assert.equal(validateBusinessAgentSpec(salonSpec()).valid, true);
    assert.equal(validateBusinessAgentSpec({ ...salonSpec(), customerData: { fields: [] } }).valid, true);
  });

  it("9. seguridad: una clave de tenant dentro de customerData se rechaza (el tenant sale del servidor)", () => {
    const r = validateBusinessAgentSpec(nylasSpec([{ ...NOMBRE, tenantId: "otro-tenant" } as unknown as CustomerField]));
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.code === "SPEC_TENANT_INJECTION"));
  });
});

describe("R3 — compiler: la IR transporta la configuración", () => {
  it("10. la IR contiene solo los campos ACTIVOS, sin la nota interna, y con procedencia", () => {
    const { ir } = compilar(nylasSpec([{ ...NOMBRE, description: "interno" }, TELEFONO, { ...CORREO, enabled: false }]));
    assert.deepEqual(ir.customerData?.fields.map((f) => f.key), ["nombreCliente", "telefonoCliente"]);
    assert.equal(ir.customerData?.fields.some((f) => "description" in f), false);
    assert.ok(ir.provenance.some((p) => p.element === "customer-field:nombreCliente"));
  });

  it("11. sin datos configurados la IR es IDÉNTICA a la previa a R3 (mismo checksum): ausente, lista vacía o todo desactivado", () => {
    const base = compilar(nylasSpec()).ir;
    assert.equal("customerData" in base, false);
    assert.equal(compilar({ ...nylasSpec(), customerData: { fields: [] } }).ir.checksum, base.checksum);
    assert.equal(compilar(nylasSpec([{ ...NOMBRE, enabled: false }])).ir.checksum, base.checksum);
  });

  it("12. el compiler es determinista con datos del cliente", () => {
    const a = compilar(nylasSpec([NOMBRE, TELEFONO, CORREO]));
    const b = compilar(nylasSpec([NOMBRE, TELEFONO, CORREO]));
    assert.equal(a.ir.checksum, b.ir.checksum);
    assert.deepEqual(a.flow.nodes, b.flow.nodes);
    assert.deepEqual(a.flow.edges, b.flow.edges);
  });

  it("13. un agente de agenda SIN leadCapture activa IDENTIFICATION (por 'scheduling') solo si hay campos pedibles activos", () => {
    const conDatos = compilar(nylasSpec([NOMBRE, TELEFONO])).ir;
    const ident = conDatos.states.find((s) => s.id === "IDENTIFICATION");
    assert.ok(ident);
    assert.deepEqual(ident!.enabledBy, ["scheduling"]);
    assert.deepEqual(ident!.toolBindings, [], "sin tools de lead");
    // Todos los campos desactivados => nada que preguntar => no hay estado de captura ni customerData.
    const todosOff = compilar(nylasSpec([{ ...NOMBRE, enabled: false }, { ...TELEFONO, enabled: false }]));
    assert.equal(todosOff.ir.states.some((s) => s.id === "IDENTIFICATION"), false);
    assert.equal("customerData" in todosOff.ir, false);
  });
});

describe("R3 — compiler: FlowDefinition (nodos de captura y acción de reserva)", () => {
  it("14. campo REQUERIDO: cond(exists) -> [sí] siguiente / [no] pregunta con validación real; el nombre no se pregunta dos veces", () => {
    const { flow } = compilar(nylasSpec([NOMBRE, TELEFONO]));
    const cond = flow.nodes.find((n) => n.id === "cond-data:nombreCliente");
    assert.ok(cond && cond.type === "condition");
    assert.deepEqual((cond as { config: { rules: unknown } }).config.rules, [{ field: "nombreCliente", operator: "exists" }]);
    const q = flow.nodes.find((n) => n.id === "q-data:nombreCliente");
    assert.ok(q && q.type === "question");
    assert.equal((q as { config: { variableKey: string } }).config.variableKey, "nombreCliente");
    assert.ok(flow.edges.some((e) => e.source === "cond-data:nombreCliente" && e.sourceHandle === "false" && e.target === "q-data:nombreCliente"));
    assert.equal(flow.nodes.some((n) => n.id === "q-identify"), false, "la pregunta genérica de nombre se reemplaza (no se pregunta dos veces)");
    // El teléfono lo aporta el canal: no se genera pregunta.
    assert.equal(flow.nodes.some((n) => n.id.includes("telefonoCliente")), false);
    // q-need -> [router R7: cancelar/reprogramar si lo pide] -> captura -> reserva
    assert.ok(flow.edges.some((e) => e.source === "q-need" && e.target === "cond-ap-need-notq"));
    assert.ok(flow.edges.some((e) => e.source === "cond-ap-need-resched" && e.sourceHandle === "false" && e.target === "cond-data:nombreCliente"));
    assert.ok(flow.edges.some((e) => e.source === "cond-ap-need-notq" && e.sourceHandle === "false" && e.target === "cond-data:nombreCliente"));
    assert.ok(flow.edges.some((e) => e.source === "cond-data:nombreCliente" && e.sourceHandle === "true" && e.target === "sd-data"));
    assert.ok(flow.edges.some((e) => e.source === "q-data:nombreCliente" && e.target === "sd-data"));
  });

  it("15. campo OPCIONAL: se ofrece con botones Sí/No; 'No' salta, 'Sí' pregunta (omitir nunca contamina el dato)", () => {
    const { flow } = compilar(nylasSpec([NOMBRE, CORREO]));
    const btn = flow.nodes.find((n) => n.id === "btn-data:correoCliente");
    assert.ok(btn && btn.type === "buttons");
    assert.deepEqual((btn as { config: { buttons: { id: string }[] } }).config.buttons.map((b) => b.id), ["si", "no"]);
    assert.ok(flow.edges.some((e) => e.source === "cond-data:correoCliente" && e.sourceHandle === "false" && e.target === "btn-data:correoCliente"));
    assert.ok(flow.edges.some((e) => e.source === "btn-data:correoCliente" && e.sourceHandle === "button:si" && e.target === "q-data:correoCliente"));
    assert.ok(flow.edges.some((e) => e.source === "btn-data:correoCliente" && e.sourceHandle === "button:no" && e.target === "sd-data"));
    const q = flow.nodes.find((n) => n.id === "q-data:correoCliente");
    assert.equal((q as { config: { validation: { kind: string } } }).config.validation.kind, "email");
  });

  it("16. varios campos: se encadenan en el orden del Spec y convergen al MISMO siguiente estado", () => {
    const { flow } = compilar(nylasSpec([NOMBRE, campo({ key: "edad", type: "number", label: "Edad", required: true }), CORREO]));
    assert.ok(flow.edges.some((e) => e.source === "cond-data:nombreCliente" && e.sourceHandle === "true" && e.target === "cond-data:edad"));
    assert.ok(flow.edges.some((e) => e.source === "q-data:nombreCliente" && e.target === "cond-data:edad"));
    assert.ok(flow.edges.some((e) => e.source === "q-data:edad" && e.target === "cond-data:correoCliente"));
    assert.ok(flow.edges.some((e) => e.source === "sd-data" && e.target === "q-booking-when"));
    // ningún nodo de captura queda huérfano: la validación real del Flow Engine ya lo garantiza (compilar() la corrió).
  });

  it("17. solo los datos del CLIENTE se guardan en el contacto (custom_field); los de la reserva no", () => {
    const { flow } = compilar(nylasSpec([NOMBRE, MOTIVO_NOTAS]));
    const sd = flow.nodes.find((n) => n.id === "sd-data");
    assert.ok(sd && sd.type === "save_data");
    assert.deepEqual((sd as { config: { mappings: unknown } }).config.mappings, [{ variable: "nombreCliente", target: "custom_field", targetKey: "nombreCliente" }]);
    // Si TODO es de la reserva no hay save_data.
    const soloReserva = compilar(nylasSpec([NOMBRE, MOTIVO_NOTAS].map((f) => ({ ...f, scope: "booking" as const }))));
    assert.equal(soloReserva.flow.nodes.some((n) => n.id === "sd-data"), false);
  });

  it("18. la acción de reserva lleva la definición ESTÁTICA (customerFieldsJson) junto al horario; la IA no puede alterarla", () => {
    const { flow, ir } = compilar(nylasSpec([NOMBRE, TELEFONO, CORREO]));
    const act = flow.nodes.find((n) => n.id === "act-book");
    assert.ok(act && act.type === "action");
    const cfg = (act as { config: { actionType: string; params: Record<string, string> } }).config;
    assert.equal(cfg.actionType, "crear_cita_nylas_generico");
    assert.ok(cfg.params.businessHoursJson, "el horario sigue embebido (R2)");
    assert.deepEqual(JSON.parse(cfg.params.customerFieldsJson), ir.customerData!.fields);
    const propose = flow.nodes.find((n) => n.id === "ai-book-propose") as { config: { instruction: string } };
    assert.match(propose.config.instruction, /datos del cliente ya fueron recopilados/);
  });

  it("19. agente SIN datos: la acción y la instrucción son exactamente las de antes (sin customerFieldsJson)", () => {
    const { flow } = compilar(nylasSpec());
    const cfg = (flow.nodes.find((n) => n.id === "act-book") as { config: { params: Record<string, string> } }).config;
    // Solo horario (R2) y aviso mínimo (R7): NINGÚN parámetro de datos del cliente (R3).
    assert.deepEqual(Object.keys(cfg.params).sort(), ["businessHoursJson", "minNoticeMinutes"]);
    const propose = flow.nodes.find((n) => n.id === "ai-book-propose") as { config: { instruction: string } };
    assert.doesNotMatch(propose.config.instruction, /datos del cliente/);
  });

  it("20. leadCapture con datos configurados reemplaza q-identify; sin datos conserva q-identify (retrocompat)", () => {
    const conDatos = compilar({ ...retailSpec(), customerData: { fields: [NOMBRE] } }).flow;
    assert.equal(conDatos.nodes.some((n) => n.id === "q-identify"), false);
    assert.ok(conDatos.nodes.some((n) => n.id === "q-data:nombreCliente"));
    const legacy = compilar(retailSpec()).flow;
    assert.ok(legacy.nodes.some((n) => n.id === "q-identify"));
    assert.equal(legacy.nodes.some((n) => n.id.startsWith("q-data:")), false);
  });

  it("21. el provider 'internal' no recibe customerFieldsJson (esa acción tiene su propio contrato)", () => {
    const s = salonSpec();
    const interno: BusinessAgentSpec = {
      ...s,
      capabilities: caps({ scheduling: true, humanHandoff: true }),
      catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
      customerData: { fields: [NOMBRE] },
    };
    const { flow } = compilar(interno);
    const act = flow.nodes.find((n) => n.id === "act-book") as { config: { actionType: string; params?: Record<string, string> } };
    assert.equal(act.config.actionType, "agendar_cita_especialista");
    assert.equal(act.config.params?.customerFieldsJson, undefined);
    // pero la captura (y el nombre en la variable nombreCliente que ese action ya lee) sí existe
    assert.ok(flow.nodes.some((n) => n.id === "q-data:nombreCliente"));
  });

  it("22. el flow resultante es PUBLICABLE (validateFlowForPublish) con todos los tipos de campo", () => {
    const todos = [
      NOMBRE,
      TELEFONO,
      CORREO,
      campo({ key: "edad", type: "number", required: true }),
      campo({ key: "nac", type: "date" }),
      campo({ key: "llegada", type: "time", required: true }),
      campo({ key: "tipo", type: "select", options: ["Uñas", "Pestañas"], required: true }),
      campo({ key: "primera_vez", type: "boolean" }),
      MOTIVO_NOTAS,
    ];
    const { flow } = compilar(nylasSpec(todos));
    const pub = validateFlowForPublish(flow);
    assert.deepEqual(pub.errors, [], JSON.stringify(pub.errors));
    assert.equal(pub.valid, true);
  });

  it("23. los ids de los nodos de captura se resuelven a commercialState IDENTIFICATION (Gate/estado)", () => {
    const { flow } = compilar(nylasSpec([NOMBRE, CORREO]));
    for (const n of flow.nodes.filter((x) => /^(cond|q|btn)-data:|^sd-data$/.test(x.id))) {
      assert.equal(commercialStateFromNodeId(n.id), "IDENTIFICATION", n.id);
    }
    assert.equal(commercialStateFromNodeId("q-data-inventado"), undefined, "sin prefijo exacto no se adivina");
  });

  it("24. tenant isolation: el flow lleva el tenant del CONTEXTO; el mismo Spec en dos tenants da grafos equivalentes", () => {
    const TB = "22222222-2222-4222-8222-222222222222";
    const a = compileBusinessAgent(nylasSpec([NOMBRE, TELEFONO]), { tenantId: TENANT });
    const b = compileBusinessAgent(nylasSpec([NOMBRE, TELEFONO]), { tenantId: TB });
    assert.ok(a.success && b.success);
    if (a.success && b.success) {
      const fa = compileIRToFlowDefinition(a.ir, { tenantId: TENANT });
      const fb = compileIRToFlowDefinition(b.ir, { tenantId: TB });
      assert.ok(fa.success && fb.success);
      if (fa.success && fb.success) {
        assert.equal(fa.flow.tenantId, TENANT);
        assert.equal(fb.flow.tenantId, TB);
        assert.deepEqual(fa.flow.nodes, fb.flow.nodes);
        // un IR de un tenant no compila con el contexto de otro
        assert.equal(compileIRToFlowDefinition(a.ir, { tenantId: TB }).success, false);
      }
    }
  });
});
