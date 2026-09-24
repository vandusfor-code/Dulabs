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
  PUBLIBORDADOS_NOMBRE_EMPRESA,
  PUBLIBORDADOS_PAUSA_HORAS,
  PUBLIBORDADOS_PRODUCTO,
  PUBLIBORDADOS_REINTENTO_CANTIDAD,
  PUBLIBORDADOS_REINTENTO_NOMBRE,
  PUBLIBORDADOS_REINTENTO_OPCION,
  PUBLIBORDADOS_TIPO_CLIENTE,
  PUBLIBORDADOS_TRASPASO,
  publibordadosFlow,
} from "@/lib/flows/publibordados.flow";

const flow = publibordadosFlow();

type Paso = FlowEngineEvent;
const btn = (id: string): Paso => ({ type: "button", id });
const txt = (text: string): Paso => ({ type: "text", text });

type Enviado = Extract<EngineEffect, { type: "send_message" }>;

/** Mensajes que el cliente recibiría (ya filtrados por la seguridad de claims real). */
function enviados(effects: EngineEffect[], variables: Record<string, unknown>): Enviado[] {
  return filterClaimSecuredEffects(effects, variables).filter((e): e is Enviado => e.type === "send_message");
}

/** Conversación completa desde "Hola"; completa el efecto de transferencia como lo hace el executor real. */
function conversar(pasos: Paso[]): {
  state: FlowEngineState;
  recibidos: string[];
  mensajes: Enviado[];
  efectos: EngineEffect[];
  /** Mensajes recibidos como respuesta al ÚLTIMO paso. */
  ultimaRespuesta: string[];
} {
  let state = createFlowEngineState(flow);
  const efectos: EngineEffect[] = [];
  const mensajes: Enviado[] = [];
  let ultimaRespuesta: string[] = [];
  const correr = (evento: FlowEngineEvent) => {
    const r = runFlowEngine(flow, state, evento);
    efectos.push(...r.effects);
    const nuevos = enviados(r.effects, r.state.variables);
    mensajes.push(...nuevos);
    if (evento.type !== "effect_result") ultimaRespuesta = nuevos.map((m) => m.content.text ?? "");
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
  return { state, recibidos: mensajes.map((m) => m.content.text ?? ""), mensajes, efectos, ultimaRespuesta };
}

/** Efectos que piden ejecutar una acción (el runtime real los resuelve con InternalActionExecutor). */
const accionTransferir = (efectos: EngineEffect[]) =>
  efectos.filter(
    (e): e is Extract<EngineEffect, { type: "effect_required" }> => e.type === "effect_required" && e.action?.actionType === "transferir_soporte",
  );

const HASTA_PRODUCTO: Paso[] = [btn("empresa"), txt("Ana Gómez"), txt("Textiles SAS")];
const HASTA_CANTIDAD: Paso[] = [...HASTA_PRODUCTO, btn("gorras")];

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

  it("botones: máximo 3 por mensaje, etiquetas de hasta 20 caracteres y TODA pregunta de botones tiene salida de texto libre", () => {
    for (const n of flow.nodes) {
      if (n.type !== "buttons") continue;
      assert.ok(n.config.buttons.length <= 3, n.id);
      for (const b of n.config.buttons) assert.ok(b.label.length <= 20, `${b.label} (${b.label.length})`);
      assert.ok(
        flow.edges.some((e) => e.source === n.id && e.sourceHandle === "text"),
        `${n.id} sin conexión "text": el cliente quedaría sin respuesta si escribe otra cosa`,
      );
    }
  });

  it("sin IA: ningún nodo ai", () => {
    assert.equal(flow.nodes.filter((n) => n.type === "ai").length, 0);
  });
});

describe("PUBLI BORDADOS — recorrido completo", () => {
  it("bienvenida + pregunta de tipo de cliente con sus 2 botones, esperando botón", () => {
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start", text: "Hola" });
    const msgs = enviados(r.effects, r.state.variables);
    assert.deepEqual(msgs.map((m) => m.content.text), [PUBLIBORDADOS_BIENVENIDA, PUBLIBORDADOS_TIPO_CLIENTE]);
    assert.deepEqual(msgs[1].buttons?.map((b) => b.label), ["Persona natural", "Empresa"]);
    assert.equal(r.state.status, "waiting_input");
  });

  it("empresa · gorras · 20 → nombre de empresa, aviso mayorista, traspaso y UNA transferir_soporte", () => {
    const { state, recibidos, efectos } = conversar([...HASTA_CANTIDAD, txt("20")]);
    assert.deepEqual(recibidos, [
      PUBLIBORDADOS_BIENVENIDA,
      PUBLIBORDADOS_TIPO_CLIENTE,
      PUBLIBORDADOS_NOMBRE,
      PUBLIBORDADOS_NOMBRE_EMPRESA,
      PUBLIBORDADOS_PRODUCTO,
      PUBLIBORDADOS_CANTIDAD,
      PUBLIBORDADOS_MAYORISTA,
      PUBLIBORDADOS_TRASPASO,
    ]);
    assert.equal(state.variables.tipo_cliente, "empresa");
    assert.equal(state.variables.nombre, "Ana Gómez");
    assert.equal(state.variables.nombre_empresa, "Textiles SAS");
    assert.equal(state.variables.producto, "gorras");
    assert.equal(state.variables.cantidad, "20");
    const acciones = accionTransferir(efectos);
    assert.equal(acciones.length, 1);
    const accion = acciones[0].action;
    assert.ok(accion && "pauseDurationHours" in accion);
    assert.equal(accion.pauseDurationHours, PUBLIBORDADOS_PAUSA_HORAS);
    assert.equal(state.status, "completed");
  });

  it("persona natural: NO pregunta empresa y pasa directo a productos", () => {
    const { state, recibidos } = conversar([btn("persona_natural"), txt("Luis"), btn("prendas_de_vestir"), txt("3")]);
    assert.ok(!recibidos.includes(PUBLIBORDADOS_NOMBRE_EMPRESA));
    assert.equal(state.variables.nombre_empresa, "");
    assert.equal(state.status, "completed");
  });

  it("sin mensajes duplicados: cada texto del recorrido se envía una sola vez", () => {
    const { recibidos } = conversar([...HASTA_CANTIDAD, txt("20")]);
    assert.equal(new Set(recibidos).size, recibidos.length);
  });
});

describe("PUBLI BORDADOS — botones escritos a mano (sin adivinar)", () => {
  for (const variante of ["empresa", "Empresa", "EMPRESA", "empresa.", "  Empresa!  ", "Émpresa"]) {
    it(`"${variante}" en tipo de cliente → Empresa`, () => {
      const { state, ultimaRespuesta } = conversar([txt(variante)]);
      assert.equal(state.variables.tipo_cliente, "empresa");
      assert.deepEqual(ultimaRespuesta, [PUBLIBORDADOS_NOMBRE]);
    });
  }

  it('"persona natural" escrito → Persona natural', () => {
    const { state } = conversar([txt("persona natural")]);
    assert.equal(state.variables.tipo_cliente, "persona_natural");
  });

  for (const ambiguo of ["Necesito unas gorras", "hola", "si", "persona", "👍", "🧢", "?", "empresa o persona"]) {
    it(`"${ambiguo}" en tipo de cliente → vuelve a preguntar con los botones, sin asumir nada`, () => {
      const { state, ultimaRespuesta, mensajes, efectos } = conversar([txt(ambiguo)]);
      assert.deepEqual(ultimaRespuesta, [PUBLIBORDADOS_REINTENTO_OPCION, PUBLIBORDADOS_TIPO_CLIENTE]);
      assert.deepEqual(mensajes.at(-1)?.buttons?.map((b) => b.label), ["Persona natural", "Empresa"]);
      assert.equal(state.currentNodeId, "btn-tipo-cliente");
      assert.equal(state.status, "waiting_input");
      assert.equal(accionTransferir(efectos).length, 0);
    });
  }

  it("tras un texto inválido, el botón correcto sigue funcionando y SOBRESCRIBE lo escrito", () => {
    const { state } = conversar([txt("Necesito unas gorras"), btn("persona_natural")]);
    assert.equal(state.variables.tipo_cliente, "persona_natural");
    assert.equal(state.currentNodeId, "q-nombre");
  });

  it('"gorras", "GORRAS" y "Prendas de vestir" escritos → producto correcto', () => {
    assert.equal(conversar([...HASTA_PRODUCTO, txt("GORRAS")]).state.variables.producto, "gorras");
    assert.equal(conversar([...HASTA_PRODUCTO, txt("gorras")]).state.variables.producto, "gorras");
    assert.equal(conversar([...HASTA_PRODUCTO, txt("Prendas de vestir")]).state.variables.producto, "prendas_de_vestir");
  });

  it('producto ambiguo ("camisetas y gorras") → vuelve a mostrar los productos, sin elegir', () => {
    const { state, ultimaRespuesta } = conversar([...HASTA_PRODUCTO, txt("camisetas y gorras")]);
    assert.deepEqual(ultimaRespuesta, [PUBLIBORDADOS_REINTENTO_OPCION, PUBLIBORDADOS_PRODUCTO]);
    assert.equal(state.currentNodeId, "btn-producto");
  });

  it('"Más opciones" (botón o escrito) → Uniformes / Otros / Ver anteriores', () => {
    for (const paso of [btn("mas_opciones"), txt("más opciones"), txt("MAS OPCIONES")]) {
      const { state, mensajes } = conversar([...HASTA_PRODUCTO, paso]);
      assert.equal(mensajes.at(-1)?.content.text, PUBLIBORDADOS_MAS_OPCIONES);
      assert.deepEqual(mensajes.at(-1)?.buttons?.map((b) => b.label), ["🦺 Uniformes", "🧵 Otros", "⬅️ Ver anteriores"]);
      assert.equal(state.currentNodeId, "btn-producto-mas");
    }
  });

  it("Uniformes y Otros (botón o escrito) guardan el producto y terminan en traspaso", () => {
    for (const [paso, producto] of [
      [btn("uniformes"), "uniformes"],
      [btn("otros"), "otros"],
      [txt("uniformes"), "uniformes"],
      [txt("Otros"), "otros"],
    ] as const) {
      const { state } = conversar([...HASTA_PRODUCTO, btn("mas_opciones"), paso, txt("12")]);
      assert.equal(state.variables.producto, producto);
      assert.equal(state.status, "completed");
    }
  });

  it('"Ver anteriores" vuelve a Gorras / Prendas; texto inválido en Más opciones repite esa pantalla', () => {
    const volver = conversar([...HASTA_PRODUCTO, btn("mas_opciones"), btn("volver")]);
    assert.equal(volver.state.currentNodeId, "btn-producto");
    const invalido = conversar([...HASTA_PRODUCTO, btn("mas_opciones"), txt("no sé")]);
    assert.deepEqual(invalido.ultimaRespuesta, [PUBLIBORDADOS_REINTENTO_OPCION, PUBLIBORDADOS_MAS_OPCIONES]);
    assert.equal(invalido.state.currentNodeId, "btn-producto-mas");
  });
});

describe("PUBLI BORDADOS — nombre y cantidad", () => {
  it("nombre sin letras (emoji, puntos) se vuelve a pedir; un nombre real avanza", () => {
    for (const malo of ["👍", "...", "123"]) {
      const { state, ultimaRespuesta } = conversar([btn("persona_natural"), txt(malo)]);
      assert.deepEqual(ultimaRespuesta, [PUBLIBORDADOS_REINTENTO_NOMBRE], malo);
      assert.equal(state.currentNodeId, "q-nombre");
    }
    assert.equal(conversar([btn("persona_natural"), txt("José 😊")]).state.variables.nombre, "José 😊");
  });

  for (const [entrada, guardado] of [
    ["6", "6"],
    ["06", "06"],
    [" 20 ", "20"],
    ["999999", "999999"],
  ] as const) {
    it(`cantidad "${entrada}" es válida`, () => {
      const { state } = conversar([...HASTA_CANTIDAD, txt(entrada)]);
      assert.equal(state.variables.cantidad, guardado);
      assert.equal(state.status, "completed");
    });
  }

  for (const invalida of ["6 unidades", "muchas", "-3", "0", "1.5", "1,5", "Infinity", "1e3", "0x10", "1000000", "👍"]) {
    it(`cantidad "${invalida}" se vuelve a pedir con un ejemplo; no avanza ni transfiere`, () => {
      const { state, efectos, ultimaRespuesta } = conversar([...HASTA_CANTIDAD, txt(invalida)]);
      assert.deepEqual(ultimaRespuesta, [PUBLIBORDADOS_REINTENTO_CANTIDAD]);
      assert.equal(state.status, "waiting_input");
      assert.equal(state.currentNodeId, "q-cantidad");
      assert.equal(accionTransferir(efectos).length, 0);
    });
  }

  it("tras una cantidad inválida, la válida continúa normalmente", () => {
    const { state, recibidos } = conversar([...HASTA_CANTIDAD, txt("6 unidades"), txt("6")]);
    assert.ok(recibidos.includes(PUBLIBORDADOS_MAYORISTA));
    assert.equal(state.status, "completed");
  });

  it('límite exacto: 6 y "06" → aviso mayorista; 5 → sin aviso, directo al traspaso', () => {
    assert.ok(conversar([...HASTA_CANTIDAD, txt("6")]).recibidos.includes(PUBLIBORDADOS_MAYORISTA));
    assert.ok(conversar([...HASTA_CANTIDAD, txt("06")]).recibidos.includes(PUBLIBORDADOS_MAYORISTA));
    const cinco = conversar([...HASTA_CANTIDAD, txt("5")]);
    assert.ok(!cinco.recibidos.includes(PUBLIBORDADOS_MAYORISTA));
    assert.equal(cinco.recibidos.at(-1), PUBLIBORDADOS_TRASPASO);
  });
});

describe("PUBLI BORDADOS — cliente guardado (save_data → custom_fields del contacto)", () => {
  it("empresa: guarda tipo, nombre, empresa, producto, cantidad y estado 'nuevo'", () => {
    const { state } = conversar([...HASTA_CANTIDAD, txt("20")]);
    assert.deepEqual(state.exports.custom_fields, {
      pb_tipo_cliente: "empresa",
      pb_nombre: "Ana Gómez",
      pb_nombre_empresa: "Textiles SAS",
      pb_producto: "gorras",
      pb_cantidad: "20",
      pb_estado: "nuevo",
    });
  });

  it("persona natural: empresa vacía (limpia una empresa de una solicitud anterior)", () => {
    const { state } = conversar([btn("persona_natural"), txt("Luis"), btn("mas_opciones"), btn("otros"), txt("2")]);
    assert.deepEqual(state.exports.custom_fields, {
      pb_tipo_cliente: "persona_natural",
      pb_nombre: "Luis",
      pb_nombre_empresa: "",
      pb_producto: "otros",
      pb_cantidad: "2",
      pb_estado: "nuevo",
    });
  });

  it("nunca guarda un valor no elegido: textos inválidos previos quedan sobrescritos por la opción real", () => {
    const { state } = conversar([
      txt("Necesito unas gorras"),
      btn("persona_natural"),
      txt("Luis"),
      txt("camisetas"),
      btn("mas_opciones"),
      txt("??"),
      btn("uniformes"),
      txt("7"),
    ]);
    assert.equal(state.exports.custom_fields.pb_tipo_cliente, "persona_natural");
    assert.equal(state.exports.custom_fields.pb_producto, "uniformes");
  });

  it("se guarda ANTES del traspaso: sin datos guardados si el cliente no termina", () => {
    const { state } = conversar([...HASTA_CANTIDAD]);
    assert.deepEqual(state.exports.custom_fields, {});
  });
});
