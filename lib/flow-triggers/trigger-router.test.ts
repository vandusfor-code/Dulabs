import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveFlowSelection } from "@/lib/flow-triggers/trigger-router";
import type { IncomingEvent, RoutableTrigger, TriggerConfig } from "@/lib/flow-triggers/types";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

let seq = 0;
function trigger(config: TriggerConfig, overrides: Partial<RoutableTrigger> = {}): RoutableTrigger {
  seq += 1;
  return {
    id: overrides.id ?? `trig-${seq}`,
    tenantId: TENANT_A,
    flowId: overrides.flowId ?? `flow-${seq}`,
    type: config.type,
    config,
    priority: 0,
    enabled: true,
    flowStatus: "published",
    ...overrides,
  };
}

function event(overrides: Partial<IncomingEvent> = {}): IncomingEvent {
  return {
    tenantId: TENANT_A,
    channel: "whatsapp",
    channelAccountId: "pn-1",
    contactId: "+573000000000",
    eventType: "message",
    timestamp: new Date().toISOString(),
    message: { text: "hola" },
    ...overrides,
  };
}

describe("resolveFlowSelection — sin candidatos / sin match", () => {
  it("array vacío -> matched:false, reason:no_candidates", () => {
    assert.deepEqual(resolveFlowSelection([], event()), { matched: false, reason: "no_candidates" });
  });

  it("ningún trigger coincide con el evento -> matched:false, reason:no_trigger_matched", () => {
    const t = trigger({ type: "keyword", keywords: ["comprar"] });
    const result = resolveFlowSelection([t], event({ message: { text: "hola" } }));
    assert.deepEqual(result, { matched: false, reason: "no_trigger_matched" });
  });
});

describe("resolveFlowSelection — caso feliz", () => {
  it("un único trigger que coincide -> gana", () => {
    const t = trigger({ type: "keyword", keywords: ["hola"] }, { flowId: "flow-hola" });
    const result = resolveFlowSelection([t], event());
    assert.equal(result.matched, true);
    if (result.matched) {
      assert.equal(result.flowId, "flow-hola");
      assert.equal(result.triggerId, t.id);
      assert.equal(result.triggerType, "keyword");
    }
  });
});

describe("resolveFlowSelection — múltiples Flows, cada uno con su propio trigger", () => {
  it("Flow A -> 'hola', Flow B -> 'comprar', Flow C -> 'soporte': cada evento selecciona el Flow correcto", () => {
    const candidatos = [
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "t-a", flowId: "flow-a" }),
      trigger({ type: "keyword", keywords: ["comprar"] }, { id: "t-b", flowId: "flow-b" }),
      trigger({ type: "keyword", keywords: ["soporte"] }, { id: "t-c", flowId: "flow-c" }),
    ];
    const rA = resolveFlowSelection(candidatos, event({ message: { text: "hola" } }));
    const rB = resolveFlowSelection(candidatos, event({ message: { text: "comprar" } }));
    const rC = resolveFlowSelection(candidatos, event({ message: { text: "soporte" } }));
    assert.equal(rA.matched && rA.flowId, "flow-a");
    assert.equal(rB.matched && rB.flowId, "flow-b");
    assert.equal(rC.matched && rC.flowId, "flow-c");
  });
});

describe("resolveFlowSelection — múltiples triggers para el MISMO Flow", () => {
  it("keyword 'hola', keyword 'buenas' y conversation_started, todos al mismo Flow -- cualquiera lo activa", () => {
    const candidatos = [
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "t-1", flowId: "flow-unico" }),
      trigger({ type: "keyword", keywords: ["buenas"] }, { id: "t-2", flowId: "flow-unico" }),
      trigger({ type: "conversation_started" }, { id: "t-3", flowId: "flow-unico" }),
    ];
    assert.equal(resolveFlowSelection(candidatos, event({ message: { text: "hola" } })).matched, true);
    assert.equal(resolveFlowSelection(candidatos, event({ message: { text: "buenas" } })).matched, true);
    const r = resolveFlowSelection(candidatos, event({ eventType: "conversation_started", message: undefined }));
    assert.equal(r.matched && r.flowId, "flow-unico");
  });
});

describe("resolveFlowSelection — prioridad", () => {
  it("Flow A prioridad 10, Flow B prioridad 20, ambos con keyword 'venta' -- gana B (mayor prioridad)", () => {
    const candidatos = [
      trigger({ type: "keyword", keywords: ["venta"] }, { id: "t-a", flowId: "flow-a", priority: 10 }),
      trigger({ type: "keyword", keywords: ["venta"] }, { id: "t-b", flowId: "flow-b", priority: 20 }),
    ];
    const r = resolveFlowSelection(candidatos, event({ message: { text: "venta" } }));
    assert.equal(r.matched && r.flowId, "flow-b");
  });

  it("el orden del array NO importa -- el resultado es el mismo invertido", () => {
    const candidatos = [
      trigger({ type: "keyword", keywords: ["venta"] }, { id: "t-a", flowId: "flow-a", priority: 10 }),
      trigger({ type: "keyword", keywords: ["venta"] }, { id: "t-b", flowId: "flow-b", priority: 20 }),
    ];
    const r1 = resolveFlowSelection(candidatos, event({ message: { text: "venta" } }));
    const r2 = resolveFlowSelection([...candidatos].reverse(), event({ message: { text: "venta" } }));
    assert.deepEqual(r1, r2);
  });
});

describe("resolveFlowSelection — especificidad (desempate de prioridad)", () => {
  it("Flow A contains 'venta', Flow B exact 'venta', misma prioridad -- gana B (keyword exacto es más específico)", () => {
    const candidatos = [
      trigger({ type: "message_contains", keywords: ["venta"] }, { id: "t-a", flowId: "flow-a", priority: 5 }),
      trigger({ type: "keyword", keywords: ["venta"] }, { id: "t-b", flowId: "flow-b", priority: 5 }),
    ];
    const r = resolveFlowSelection(candidatos, event({ message: { text: "venta" } }));
    assert.equal(r.matched && r.flowId, "flow-b");
  });

  it("starts_with es más específico que contains a igual prioridad", () => {
    const candidatos = [
      trigger({ type: "message_contains", keywords: ["hola"] }, { id: "t-a", flowId: "flow-a", priority: 5 }),
      trigger({ type: "message_starts_with", keywords: ["hola"] }, { id: "t-b", flowId: "flow-b", priority: 5 }),
    ];
    const r = resolveFlowSelection(candidatos, event({ message: { text: "hola mundo" } }));
    assert.equal(r.matched && r.flowId, "flow-b");
  });

  it("user_message (catch-all) pierde contra un keyword específico a igual prioridad", () => {
    const candidatos = [
      trigger({ type: "user_message" }, { id: "t-a", flowId: "flow-catchall", priority: 5 }),
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "t-b", flowId: "flow-especifico", priority: 5 }),
    ];
    const r = resolveFlowSelection(candidatos, event({ message: { text: "hola" } }));
    assert.equal(r.matched && r.flowId, "flow-especifico");
  });
});

describe("resolveFlowSelection — empate total (misma prioridad, mismo tipo, misma keyword)", () => {
  it("dos triggers EXACT 'hola' de dos Flows distintos, misma prioridad -- desempate determinista por id, no por orden", () => {
    const candidatos = [
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "trig-zzz", flowId: "flow-z", priority: 5 }),
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "trig-aaa", flowId: "flow-a", priority: 5 }),
    ];
    const r1 = resolveFlowSelection(candidatos, event({ message: { text: "hola" } }));
    const r2 = resolveFlowSelection([...candidatos].reverse(), event({ message: { text: "hola" } }));
    assert.deepEqual(r1, r2, "el ganador no debe depender del orden del array");
    assert.equal(r1.matched && r1.triggerId, "trig-aaa", "id menor gana el desempate final");
  });
});

describe("resolveFlowSelection — enabled/disabled", () => {
  it("trigger disabled nunca gana, aunque coincida y tenga prioridad más alta", () => {
    const candidatos = [
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "t-off", flowId: "flow-off", priority: 100, enabled: false }),
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "t-on", flowId: "flow-on", priority: 1, enabled: true }),
    ];
    const r = resolveFlowSelection(candidatos, event({ message: { text: "hola" } }));
    assert.equal(r.matched && r.flowId, "flow-on");
  });

  it("todos disabled -> no_trigger_matched", () => {
    const t = trigger({ type: "keyword", keywords: ["hola"] }, { enabled: false });
    assert.deepEqual(resolveFlowSelection([t], event({ message: { text: "hola" } })), {
      matched: false,
      reason: "no_trigger_matched",
    });
  });
});

describe("resolveFlowSelection — Draft nunca gana", () => {
  it("Flow en Draft con trigger enabled -- NO gana, aunque sea el único candidato que matchea", () => {
    const t = trigger({ type: "keyword", keywords: ["hola"] }, { flowStatus: "draft" });
    assert.deepEqual(resolveFlowSelection([t], event({ message: { text: "hola" } })), {
      matched: false,
      reason: "no_trigger_matched",
    });
  });

  it("Flow A draft, Flow B published, mismo keyword -- gana B, nunca A", () => {
    const candidatos = [
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "t-draft", flowId: "flow-draft", flowStatus: "draft", priority: 100 }),
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "t-pub", flowId: "flow-pub", flowStatus: "published", priority: 1 }),
    ];
    const r = resolveFlowSelection(candidatos, event({ message: { text: "hola" } }));
    assert.equal(r.matched && r.flowId, "flow-pub");
  });
});

describe("resolveFlowSelection — Archived nunca gana", () => {
  it("Flow archivado con trigger enabled -- NO gana", () => {
    const t = trigger({ type: "keyword", keywords: ["hola"] }, { flowStatus: "archived" });
    assert.deepEqual(resolveFlowSelection([t], event({ message: { text: "hola" } })), {
      matched: false,
      reason: "no_trigger_matched",
    });
  });

  it("Flow A archivado, Flow B published, mismo keyword -- gana B, nunca A", () => {
    const candidatos = [
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "t-arch", flowId: "flow-arch", flowStatus: "archived", priority: 100 }),
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "t-pub", flowId: "flow-pub", flowStatus: "published", priority: 1 }),
    ];
    const r = resolveFlowSelection(candidatos, event({ message: { text: "hola" } }));
    assert.equal(r.matched && r.flowId, "flow-pub");
  });
});

describe("resolveFlowSelection — multi-tenant", () => {
  it("un trigger de otro tenant NUNCA gana, aunque coincida perfectamente y tenga prioridad más alta", () => {
    const candidatos = [
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "t-b", flowId: "flow-b", tenantId: TENANT_B, priority: 999 }),
      trigger({ type: "keyword", keywords: ["hola"] }, { id: "t-a", flowId: "flow-a", tenantId: TENANT_A, priority: 1 }),
    ];
    const r = resolveFlowSelection(candidatos, event({ tenantId: TENANT_A, message: { text: "hola" } }));
    assert.equal(r.matched && r.flowId, "flow-a");
  });

  it("evento de tenant A con SOLO candidatos de tenant B -> no_trigger_matched", () => {
    const t = trigger({ type: "keyword", keywords: ["hola"] }, { tenantId: TENANT_B });
    const r = resolveFlowSelection([t], event({ tenantId: TENANT_A, message: { text: "hola" } }));
    assert.deepEqual(r, { matched: false, reason: "no_trigger_matched" });
  });
});

describe("resolveFlowSelection — event / manual", () => {
  it("trigger 'event' selecciona su Flow cuando el eventName coincide", () => {
    const t = trigger({ type: "event", eventName: "campaign_reply" }, { flowId: "flow-campania" });
    const r = resolveFlowSelection([t], event({ eventType: "custom_event", message: undefined, metadata: { eventName: "campaign_reply" } }));
    assert.equal(r.matched && r.flowId, "flow-campania");
  });

  it("trigger 'manual' nunca gana un routing automático, ni siendo el único candidato", () => {
    const t = trigger({ type: "manual" }, { priority: 999 });
    const r = resolveFlowSelection([t], event({ message: { text: "cualquier cosa" } }));
    assert.deepEqual(r, { matched: false, reason: "no_trigger_matched" });
  });
});
