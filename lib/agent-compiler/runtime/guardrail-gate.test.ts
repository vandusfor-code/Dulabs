// DuLabs Business — Agent Compiler, Step 7 — tests del Business Guardrail Gate.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CompiledBusinessAgentIR, CompiledGuardrailIR, HandoffBindingIR } from "@/lib/agent-compiler/ir";
import {
  buildGateRules,
  evaluateGuardrailGate,
  HANDOFF_GATE_PRIORITY,
  type GateRule,
  type SemanticClassifier,
} from "@/lib/agent-compiler/runtime/guardrail-gate";

function irWith(parts: {
  guardrails?: CompiledGuardrailIR[];
  handoff?: HandoffBindingIR[];
}): CompiledBusinessAgentIR {
  // Solo se ejercitan guardrails + handoff; el resto se rellena mínimo.
  return {
    irVersion: "1.0.0",
    tenantId: "t-1",
    checksum: "x",
    specVersion: 1,
    identity: { businessName: "Acme", agentName: "Ana", language: "es-CO", timezone: "America/Bogota" },
    personality: { primary: "friendly", verbosity: "balanced", emojiPolicy: "limited", formality: "neutral", styleHints: [] },
    capabilities: [],
    states: [],
    transitions: [],
    guardrails: parts.guardrails ?? [],
    rules: [],
    catalogBindings: [],
    handoff: parts.handoff ?? [],
    scheduling: { requested: false, provider: "none", available: false, actions: [], resources: [] },
    knowledge: { authority: "secondary", documentIds: [] },
    provenance: [],
  };
}

const mascotaEstudio: CompiledGuardrailIR = {
  id: "no_mascota_estudio",
  source: { kind: "prohibition", prohibitionId: "no_mascota_estudio" },
  execution: "PRE_LLM",
  scope: "contextual",
  condition: {
    rules: [
      { field: "message", operator: "contains", value: "perro" },
      { field: "state", operator: "equals", value: "QUOTING" },
    ],
    match: "all",
  },
  action: "FIXED_RESPONSE",
  response: "En el estudio no se permiten mascotas.",
  priority: 100,
  runtimeBinding: null,
};

const noEfectivo: CompiledGuardrailIR = {
  id: "no_efectivo",
  source: { kind: "prohibition", prohibitionId: "no_efectivo" },
  execution: "PRE_LLM",
  scope: "business",
  condition: { rules: [{ field: "message", operator: "contains", value: "efectivo" }], match: "any" },
  action: "FIXED_RESPONSE",
  response: "No aceptamos efectivo.",
  priority: 50,
  runtimeBinding: null,
};

const quejaSemantica: CompiledGuardrailIR = {
  id: "queja",
  source: { kind: "prohibition", prohibitionId: "queja" },
  execution: "PRE_LLM",
  scope: "business",
  condition: undefined, // sin condición determinista -> semántica
  action: "TRANSFER_HUMAN",
  response: "Lamento el inconveniente, te comunico con una persona.",
  priority: 80,
  runtimeBinding: "transferir_soporte",
};

const handoffKeyword: HandoffBindingIR = {
  id: "pedir_humano",
  trigger: { kind: "keyword", keywords: ["hablar con una persona", "asesor"] },
  action: "TRANSFER_HUMAN",
  response: "Te comunico con un asesor.",
  pauseHours: 12,
  runtimeBinding: "transferir_soporte",
};

const handoffIntent: HandoffBindingIR = {
  id: "pedir_descuento",
  trigger: { kind: "discount_request" },
  action: "TRANSFER_HUMAN",
  response: "Un asesor revisará un descuento contigo.",
  pauseHours: 24,
  runtimeBinding: "transferir_soporte",
};

const rulesFor = (parts: Parameters<typeof irWith>[0]): GateRule[] => buildGateRules(irWith(parts));

describe("buildGateRules — derivación desde la IR", () => {
  it("clasifica determinista vs semántica y conserva prioridad/acción/trazas", () => {
    const rules = rulesFor({ guardrails: [mascotaEstudio, quejaSemantica], handoff: [handoffKeyword, handoffIntent] });
    const byId = new Map(rules.map((r) => [r.id, r]));
    assert.equal(byId.get("no_mascota_estudio")!.evaluation, "deterministic");
    assert.equal(byId.get("queja")!.evaluation, "semantic");
    assert.equal(byId.get("pedir_humano")!.evaluation, "deterministic");
    assert.equal(byId.get("pedir_descuento")!.evaluation, "semantic");
    // handoff con prioridad base alta.
    assert.equal(byId.get("pedir_humano")!.priority, HANDOFF_GATE_PRIORITY);
    // provenance conservada.
    assert.deepEqual(byId.get("no_mascota_estudio")!.provenance, { kind: "prohibition", sourceId: "no_mascota_estudio" });
  });

  it("ordena por prioridad desc (estable)", () => {
    const rules = rulesFor({ guardrails: [noEfectivo, mascotaEstudio] });
    assert.deepEqual(rules.map((r) => r.id), ["no_mascota_estudio", "no_efectivo"]);
  });
});

describe("evaluateGuardrailGate — deterministas (0 LLM)", () => {
  it("prohibición contextual: perro + estado QUOTING => fixed_response", async () => {
    const rules = rulesFor({ guardrails: [mascotaEstudio] });
    const decision = await evaluateGuardrailGate({
      rules,
      context: { message: "¿puedo llevar mi perro al estudio?", commercialState: "QUOTING" },
    });
    assert.equal(decision.kind, "fixed_response");
    if (decision.kind === "fixed_response") {
      assert.equal(decision.ruleId, "no_mascota_estudio");
      assert.equal(decision.matchedBy, "deterministic");
      assert.equal(decision.response, "En el estudio no se permiten mascotas.");
    }
  });

  it("misma prohibición NO matchea si el estado no es el contextual", async () => {
    const rules = rulesFor({ guardrails: [mascotaEstudio] });
    const decision = await evaluateGuardrailGate({
      rules,
      context: { message: "¿puedo llevar mi perro?", commercialState: "WELCOME" },
    });
    assert.equal(decision.kind, "pass");
  });

  it("NO invoca el clasificador cuando una determinista hace match", async () => {
    let called = 0;
    const classifier: SemanticClassifier = async () => {
      called += 1;
      return { label: "queja" };
    };
    const rules = rulesFor({ guardrails: [mascotaEstudio, quejaSemantica] });
    const decision = await evaluateGuardrailGate({
      rules,
      context: { message: "quiero llevar mi perro", commercialState: "QUOTING" },
      classifier,
    });
    assert.equal(decision.kind, "fixed_response");
    assert.equal(called, 0);
  });

  it("handoff por keyword => transfer_human con pauseHours de la regla", async () => {
    const rules = rulesFor({ handoff: [handoffKeyword] });
    const decision = await evaluateGuardrailGate({
      rules,
      context: { message: "quiero hablar con una persona por favor" },
    });
    assert.equal(decision.kind, "transfer_human");
    if (decision.kind === "transfer_human") {
      assert.equal(decision.ruleId, "pedir_humano");
      assert.equal(decision.pauseHours, 12);
      // El mensaje configurado debe llegar en la decisión (el sink lo envía al cliente).
      assert.equal(decision.response, "Te comunico con un asesor.");
    }
  });

  it("prioridad: gana la regla de mayor prioridad ante doble match", async () => {
    // handoff (100) vs prohibición efectivo (50) — ambas matchean.
    const rules = rulesFor({ guardrails: [noEfectivo], handoff: [handoffKeyword] });
    const decision = await evaluateGuardrailGate({
      rules,
      context: { message: "quiero pagar en efectivo o hablar con una persona" },
    });
    assert.equal(decision.kind, "transfer_human");
    if (decision.kind === "transfer_human") assert.equal(decision.ruleId, "pedir_humano");
  });
});

describe("R5 — agent_request: 'quiero hablar con una persona' NO depende del clasificador de IA", () => {
  const pedirPersona: HandoffBindingIR = {
    id: "pedir_persona",
    trigger: { kind: "agent_request" },
    action: "TRANSFER_HUMAN",
    response: "Con gusto te comunico con una persona del equipo.",
    pauseHours: 6,
    runtimeBinding: "transferir_soporte",
  };

  it("frase explícita => transfer_human DETERMINISTA, sin clasificador (y con el mensaje/pausa de la regla)", async () => {
    const rules = rulesFor({ handoff: [pedirPersona] });
    for (const msg of ["Quiero hablar con una persona.", "Necesito hablar con un asesor", "me pasas con alguien de atencion?", "Can I talk to a human?", "quiero atención humana"]) {
      const decision = await evaluateGuardrailGate({ rules, context: { message: msg } }); // sin classifier
      assert.equal(decision.kind, "transfer_human", msg);
      if (decision.kind === "transfer_human") {
        assert.equal(decision.matchedBy, "deterministic");
        assert.equal(decision.pauseHours, 6);
        assert.equal(decision.response, "Con gusto te comunico con una persona del equipo.");
        assert.equal(decision.trace.source, "handoff");
      }
    }
  });

  it("si el clasificador FALLA, la solicitud explícita igual transfiere (antes se perdía: fail-safe = pass)", async () => {
    const rules = rulesFor({ handoff: [pedirPersona] });
    const classifier: SemanticClassifier = async () => { throw new Error("proveedor caído"); };
    const decision = await evaluateGuardrailGate({ rules, context: { message: "quiero hablar con una persona" }, classifier });
    assert.equal(decision.kind, "transfer_human");
  });

  it("la paráfrasis rara sigue cubierta por la regla semántica", async () => {
    const rules = rulesFor({ handoff: [pedirPersona] });
    const classifier: SemanticClassifier = async ({ labels }) => (labels.includes("pedir_persona") ? { label: "pedir_persona" } : { label: "continue" });
    const decision = await evaluateGuardrailGate({ rules, context: { message: "prefiero que me atienda gente de carne y hueso" }, classifier });
    assert.equal(decision.kind, "transfer_human");
    if (decision.kind === "transfer_human") assert.equal(decision.matchedBy, "semantic");
  });

  it("sin falsos positivos: consultas normales NO transfieren", async () => {
    const rules = rulesFor({ handoff: [pedirPersona] });
    for (const msg of ["¿Ofrecen asesoría para cejas?", "¿Cuánto cuesta el manicure?", "Quiero una cita para mañana", "Hablé con una amiga que me lo recomendó", "el asesoramiento es gratis?"]) {
      const decision = await evaluateGuardrailGate({ rules, context: { message: msg } });
      assert.equal(decision.kind, "pass", msg);
    }
  });

  it("tenant/wamid: solo agent_request genera la regla de frases (una keyword o queja NO)", () => {
    const soloQueja = buildGateRules(irWith({ handoff: [{ id: "q", trigger: { kind: "complaint" }, action: "TRANSFER_HUMAN", pauseHours: 24, runtimeBinding: "transferir_soporte" }] }));
    assert.equal(soloQueja.some((r) => r.id.endsWith(":frases")), false);
    const con = buildGateRules(irWith({ handoff: [pedirPersona] }));
    assert.equal(con.filter((r) => r.evaluation === "deterministic").length, 1);
    assert.equal(con.filter((r) => r.evaluation === "semantic").length, 1);
  });
});

describe("evaluateGuardrailGate — semánticas (clasificador controlado)", () => {
  it("clasifica intención y DuLabs decide la acción (transfer)", async () => {
    const classifier: SemanticClassifier = async ({ labels }) => {
      assert.ok(labels.includes("queja"));
      assert.ok(labels.includes("continue"));
      return { label: "queja" };
    };
    const rules = rulesFor({ guardrails: [quejaSemantica] });
    const decision = await evaluateGuardrailGate({
      rules,
      context: { message: "esto es pésimo, un desastre total" },
      classifier,
    });
    assert.equal(decision.kind, "transfer_human");
    if (decision.kind === "transfer_human") {
      assert.equal(decision.ruleId, "queja");
      assert.equal(decision.matchedBy, "semantic");
    }
  });

  it("clasificador 'continue' => pass (no bloquea)", async () => {
    const classifier: SemanticClassifier = async () => ({ label: "continue" });
    const rules = rulesFor({ guardrails: [quejaSemantica] });
    const decision = await evaluateGuardrailGate({ rules, context: { message: "hola, info por favor" }, classifier });
    assert.equal(decision.kind, "pass");
  });

  it("error del clasificador => pass (fail-safe conversacional; las críticas son deterministas)", async () => {
    const classifier: SemanticClassifier = async () => {
      throw new Error("classifier down");
    };
    const rules = rulesFor({ guardrails: [quejaSemantica] });
    const decision = await evaluateGuardrailGate({ rules, context: { message: "reclamo" }, classifier });
    assert.equal(decision.kind, "pass");
  });

  it("reglas semánticas sin clasificador => pass", async () => {
    const rules = rulesFor({ guardrails: [quejaSemantica] });
    const decision = await evaluateGuardrailGate({ rules, context: { message: "reclamo" } });
    assert.equal(decision.kind, "pass");
  });
});
