/**
 * PUBLI BORDADOS — tests del Flow determinístico.
 *
 * Mismo patrón que solotalento.flow.test.ts: motor PURO
 * (createFlowEngineState/runFlowEngine), sin Supabase ni red. Cada mensaje
 * se pasa además por filterClaimSecuredEffects (el filtro real que aplica el
 * Orchestrator antes de enviar): si la seguridad de claims bloqueara un
 * texto, el cliente no lo recibiría.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { filterClaimSecuredEffects } from "@/lib/flow/ai-runtime/ai-response-security";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import type { EngineEffect, FlowEngineEvent, FlowEngineState } from "@/lib/flow/engine-types";
import {
  PUBLIBORDADOS_BIENVENIDA,
  PUBLIBORDADOS_CANTIDAD,
  PUBLIBORDADOS_MAS_OPCIONES,
  PUBLIBORDADOS_MAYORISTA,
  PUBLIBORDADOS_NOMBRE,
  PUBLIBORDADOS_PAUSA_HORAS,
  PUBLIBORDADOS_PRODUCTO,
  PUBLIBORDADOS_TIPO_CLIENTE,
  PUBLIBORDADOS_TRASPASO,
  publibordadosFlow,
} from "@/lib/flows/publibordados.flow";

const flow = publibordadosFlow();

type Paso = FlowEngineEvent;
const btn = (id: string): Paso => ({ type: "button", id });
const txt = (text: string): Paso => ({ type: "text", text });

/** Textos que el cliente recibiría (ya filtrados por la seguridad de claims real). */
function textos(effects: EngineEffect[], variables: Record<string, unknown>): string[] {
  return filterClaimSecuredEffects(effects, variables)
    .filter((e): e is Extract<EngineEffect, { type: "send_message" }> => e.type === "send_message")
    .map((e) => e.content.text ?? "");
}

/** Conversación completa desde "Hola"; completa el efecto de transferencia como lo hace el executor real. */
function conversar(pasos: Paso[]): { state: FlowEngineState; recibidos: string[]; efectos: EngineEffect[] } {
  let state = createFlowEngineState(flow);
  const efectos: EngineEffect[] = [];
  const recibidos: string[] = [];
  const correr = (evento: FlowEngineEvent) => {
    const r = runFlowEngine(flow, state, evento);
    efectos.push(...r.effects);
    recibidos.push(...textos(r.effects, r.state.variables));
    state = r.state;
  };
  correr({ type: "start", text: "Hola" });
  for (const p of pasos) correr(p);
  if (state.status === "waiting_effect" && state.pendingEffect?.kind === "action") {
    correr({
      type: "effect_result",
      success: true,
      effectId: state.pendingEffect.effectId,
      data: { transferred: true, pausadoHasta: "2026-01-01T00:00:00Z", pauseDurationHours: PUBLIBORDADOS_PAUSA_HORAS },
    });
  }
  return { state, recibidos, efectos };
}

/** Efectos que piden ejecutar una acción (el runtime real los resuelve con InternalActionExecutor). */
const accionTransferir = (efectos: EngineEffect[]) =>
  efectos.filter(
    (e): e is Extract<EngineEffect, { type: "effect_required" }> => e.type === "effect_required" && e.action?.actionType === "transferir_soporte",
  );

describe("PUBLI BORDADOS — estructura", () => {
  it("valida para publicar (grafo, schema y reglas) sin ningún error", () => {
    const r = validateFlowForPublish(flow);
    assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  });

  it("un START y un END; transferir_soporte con la pausa configurada, justo antes del END", () => {
    assert.equal(flow.nodes.filter((n) => n.type === "start").length, 1);
    assert.equal(flow.nodes.filter((n) => n.type === "end").length, 1);
    const act = flow.nodes.find((n) => n.id === "act-transferir-soporte");
    assert.ok(act && act.type === "action");
    assert.equal(act.config.actionType, "transferir_soporte");
    assert.equal(act.config.pauseDurationHours, PUBLIBORDADOS_PAUSA_HORAS);
    assert.deepEqual(
      flow.edges.filter((e) => e.source === "act-transferir-soporte").map((e) => e.target),
      ["end-transferido"],
    );
  });

  it("todos los nodos son alcanzables desde START y todos llegan al END", () => {
    const sig = new Map<string, string[]>();
    for (const e of flow.edges) sig.set(e.source, [...(sig.get(e.source) ?? []), e.target]);
    const alcanzables = new Set<string>(["start"]);
    const cola = ["start"];
    while (cola.length) {
      for (const t of sig.get(cola.shift()!) ?? []) {
        if (alcanzables.has(t)) continue;
        alcanzables.add(t);
        cola.push(t);
      }
    }
    assert.deepEqual([...alcanzables].sort(), flow.nodes.map((n) => n.id).sort());
    const llegaAlFin = (id: string, visto = new Set<string>()): boolean =>
      id === "end-transferido" || (!visto.has(id) && (sig.get(id) ?? []).some((t) => llegaAlFin(t, new Set([...visto, id]))));
    for (const n of flow.nodes) assert.ok(llegaAlFin(n.id), `${n.id} no llega al END`);
  });

  it("botones: máximo 3 por mensaje y etiquetas de hasta 20 caracteres", () => {
    for (const n of flow.nodes) {
      if (n.type !== "buttons") continue;
      assert.ok(n.config.buttons.length <= 3, n.id);
      for (const b of n.config.buttons) assert.ok(b.label.length <= 20, `${b.label} (${b.label.length})`);
    }
  });

  it("sin IA: ningún nodo ai", () => {
    assert.equal(flow.nodes.filter((n) => n.type === "ai").length, 0);
  });
});

describe("PUBLI BORDADOS — conversación", () => {
  it("bienvenida + pregunta de tipo de cliente con sus 2 botones, esperando botón", () => {
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start", text: "Hola" });
    const msgs = r.effects.filter((e): e is Extract<EngineEffect, { type: "send_message" }> => e.type === "send_message");
    assert.deepEqual(msgs.map((m) => m.content.text), [PUBLIBORDADOS_BIENVENIDA, PUBLIBORDADOS_TIPO_CLIENTE]);
    assert.deepEqual(msgs[1].buttons?.map((b) => b.label), ["Persona natural", "Empresa"]);
    assert.equal(r.state.status, "waiting_input");
  });

  it("empresa · gorras · 20 → aviso mayorista, traspaso y transferir_soporte", () => {
    const { state, recibidos, efectos } = conversar([btn("empresa"), txt("Ana Gómez"), btn("gorras"), txt("20")]);
    assert.deepEqual(recibidos, [
      PUBLIBORDADOS_BIENVENIDA,
      PUBLIBORDADOS_TIPO_CLIENTE,
      PUBLIBORDADOS_NOMBRE,
      PUBLIBORDADOS_PRODUCTO,
      PUBLIBORDADOS_CANTIDAD,
      PUBLIBORDADOS_MAYORISTA,
      PUBLIBORDADOS_TRASPASO,
    ]);
    assert.equal(state.variables.tipo_cliente, "empresa");
    assert.equal(state.variables.nombre, "Ana Gómez");
    assert.equal(state.variables.producto, "gorras");
    assert.equal(state.variables.cantidad, 20);
    const acciones = accionTransferir(efectos);
    assert.equal(acciones.length, 1);
    const accion = acciones[0].action;
    assert.ok(accion && "pauseDurationHours" in accion);
    assert.equal(accion.pauseDurationHours, PUBLIBORDADOS_PAUSA_HORAS);
    assert.equal(state.status, "completed");
  });

  it("límite exacto: 6 unidades → aviso mayorista", () => {
    const { recibidos } = conversar([btn("persona_natural"), txt("Luis"), btn("prendas_de_vestir"), txt("6")]);
    assert.ok(recibidos.includes(PUBLIBORDADOS_MAYORISTA));
  });

  it("5 unidades → sin aviso mayorista, directo al traspaso", () => {
    const { state, recibidos } = conversar([btn("persona_natural"), txt("Luis"), btn("prendas_de_vestir"), txt("5")]);
    assert.ok(!recibidos.includes(PUBLIBORDADOS_MAYORISTA));
    assert.equal(recibidos.at(-1), PUBLIBORDADOS_TRASPASO);
    assert.equal(state.status, "completed");
  });

  it("'Más opciones' → segunda pantalla con Uniformes y Otros; guarda el producto elegido", () => {
    for (const p of ["uniformes", "otros"]) {
      const { state, recibidos } = conversar([btn("empresa"), txt("Textiles SAS"), btn("mas_opciones"), btn(p), txt("12")]);
      assert.ok(recibidos.includes(PUBLIBORDADOS_MAS_OPCIONES));
      assert.equal(state.variables.producto, p);
      assert.equal(state.status, "completed");
    }
  });

  it("la cantidad no numérica se vuelve a pedir; no avanza ni transfiere", () => {
    const { state, efectos } = conversar([btn("empresa"), txt("Ana"), btn("gorras"), txt("muchas")]);
    assert.equal(state.status, "waiting_input");
    assert.equal(state.currentNodeId, "q-cantidad");
    assert.equal(accionTransferir(efectos).length, 0);
  });

  it("el cliente puede escribir la opción en vez de tocar el botón", () => {
    const { state } = conversar([txt("Empresa"), txt("Ana"), txt("Gorras"), txt("8")]);
    assert.equal(state.variables.tipo_cliente, "empresa");
    assert.equal(state.variables.producto, "gorras");
    assert.equal(state.status, "completed");
  });
});
