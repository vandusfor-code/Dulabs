/**
 * Auditoría de TEXTOS ESTÁTICOS de los flujos compilados: todo lo que el agente le dice al cliente sin pasar por la IA
 * (mensajes, preguntas, botones, mensajes de re-pregunta, transferencia) DEBE llegar. El filtro de afirmaciones externas
 * es heurístico ("cita", "horario", "reserva"... como palabras de dominio) y DESCARTA EN SILENCIO lo que clasifica como una
 * afirmación sin evidencia: el cliente se quedaría sin la siguiente pregunta (bug real de R7: "¿Para qué día te gustaría la
 * cita?" nunca se enviaba). Esta prueba compila agentes con TODAS las combinaciones relevantes de capacidades y exige que
 * ningún texto informativo/pregunta sea filtrado sin evidencia. Los mensajes `external_assertion` (p. ej. "Listo, tu cita
 * fue cancelada") SÍ requieren evidencia por diseño: aquí solo se exige que declaren qué afirman.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowDefinition, FlowNode } from "@/lib/flow/types";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { EngineEffect } from "@/lib/flow/engine-types";
import { filterClaimSecuredEffects } from "@/lib/flow/ai-runtime/ai-response-security";
import { retailSpec, salonSpec } from "@/lib/agent-compiler/runtime/fixtures";
import { TENANT_A, agenteFaq, caps, publicar } from "@/lib/agent-compiler/e2e/testing/knowledge-harness";

const HORARIO = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "08:00", close: "20:00" }] })), exceptions: [] };
const NOMBRE = { key: "nombreCliente", label: "Nombre", type: "text" as const, required: true, enabled: true, scope: "customer" as const };
const CORREO = { key: "correoCliente", label: "Correo", type: "email" as const, required: false, enabled: true, scope: "customer" as const };
const NOTAS = { key: "notas", label: "Notas", type: "text" as const, required: false, enabled: true, scope: "booking" as const };
const REGLA_HUMANO = { id: "h", description: "pide persona", trigger: { kind: "agent_request" as const }, action: "TRANSFER_HUMAN" as const, response: "Te comunico con una persona del equipo." };

function citas(over: Partial<BusinessAgentSpec> = {}, provider: "nylas" | "internal" = "nylas"): BusinessAgentSpec {
  const s = salonSpec();
  return {
    ...s,
    capabilities: caps({ scheduling: true, humanHandoff: true }),
    catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
    handoff: { rules: [REGLA_HUMANO], defaultPauseHours: 6 },
    scheduling: { ...s.scheduling, provider, businessHours: HORARIO, minNoticeMinutes: 60, cancellation: { allowed: true, minNoticeHours: 24 } },
    customerData: { fields: [NOMBRE, CORREO, NOTAS] },
    ...over,
  };
}

const VARIANTES: Array<[string, () => BusinessAgentSpec]> = [
  ["citas Nylas + datos del cliente + cancelar/reprogramar + transferencia", () => citas()],
  ["citas Nylas sin transferencia", () => citas({ capabilities: caps({ scheduling: true }), handoff: { rules: [], defaultPauseHours: 6 } })],
  ["citas Nylas sin cancelación", () => citas({ scheduling: { ...salonSpec().scheduling, provider: "nylas", businessHours: HORARIO, minNoticeMinutes: 60, cancellation: { allowed: false, minNoticeHours: 24 } } })],
  ["citas interno", () => citas({}, "internal")],
  ["catálogo + productos + ventas + FAQ + transferencia", () => agenteFaq({ capabilities: caps({ catalog: true, sales: true, faq: true, humanHandoff: true }), catalog: { source: "structured", useServices: true, useProducts: true, quoteBeforeQualification: true }, handoff: { rules: [REGLA_HUMANO], defaultPauseHours: 12 } })],
  ["solo servicios, cotiza tras calificar", () => agenteFaq({ capabilities: caps({ catalog: true, sales: true }), catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: false } })],
  ["solo FAQ", () => agenteFaq()],
  ["FAQ con transferencia si no hay respuesta", () => agenteFaq({ capabilities: caps({ faq: true, humanHandoff: true }), handoff: { rules: [REGLA_HUMANO], defaultPauseHours: 6 }, knowledge: { authority: "secondary", documents: [], onNoAnswer: "handoff" } })],
  ["TODO: citas + catálogo + ventas + FAQ + transferencia", () => citas({ capabilities: caps({ scheduling: true, catalog: true, sales: true, faq: true, humanHandoff: true }), catalog: { source: "structured", useServices: true, useProducts: true, quoteBeforeQualification: true }, knowledge: { authority: "secondary", documents: [] } })],
  ["retail base", () => ({ ...retailSpec(), capabilities: caps({ catalog: true, faq: true, humanHandoff: true }), catalog: { source: "structured", useServices: true, useProducts: true, quoteBeforeQualification: false }, handoff: { rules: [REGLA_HUMANO], defaultPauseHours: 6 }, knowledge: { authority: "secondary", documents: [] } })],
];

type Texto = { nodo: string; tipo: string; texto: string; origen: "flow_static" | "flow_static_interpolated" | "system"; role?: string };

/** Todo lo que el flujo le dice al cliente SIN IA. */
function textosEstaticos(flow: FlowDefinition): Texto[] {
  const out: Texto[] = [];
  const add = (n: FlowNode, tipo: string, texto: string | undefined, role?: string, origen?: Texto["origen"]) => {
    if (!texto?.trim()) return;
    out.push({ nodo: n.id, tipo, texto, origen: origen ?? (/\{\{[a-zA-Z0-9_.]+\}\}/.test(texto) ? "flow_static_interpolated" : "flow_static"), role });
  };
  for (const n of flow.nodes) {
    const c = n.config as Record<string, unknown>;
    if (n.type === "message") {
      add(n, "message", c.text as string | undefined, (c.messageRole as string | undefined) ?? "informational");
      for (const p of (c.parts as string[] | undefined) ?? []) add(n, "message.parts", p, (c.messageRole as string | undefined) ?? "informational");
    } else if (n.type === "question") {
      add(n, "question", c.text as string | undefined, "informational");
      const v = c.validation as { kind?: string; message?: string } | undefined;
      if (v?.kind === "regex") add(n, "question.reintento", v.message ?? "La respuesta no cumple el formato esperado.", "informational", "system");
    } else if (n.type === "buttons") {
      add(n, "buttons", c.text as string | undefined, "informational");
    } else if (n.type === "human") {
      add(n, "human", c.message as string | undefined, "informational");
    }
  }
  return out;
}

const llega = (t: Texto): boolean => {
  const effect = { type: "send_message", nodeId: t.nodo, content: { text: t.texto, ...(t.role ? { messageRole: t.role } : {}) }, executionId: "e", effectId: "f", origin: t.origen } as unknown as EngineEffect;
  return filterClaimSecuredEffects([effect], {}).length === 1;
};

describe("Auditoría de textos estáticos: nada informativo se descarta en silencio", () => {
  for (const [nombre, crear] of VARIANTES) {
    it(`${nombre}`, async () => {
      const { version } = await publicar(crear(), TENANT_A);
      const textos = textosEstaticos(version.flow);
      assert.ok(textos.length > 0, "el flujo tiene textos");
      const bloqueados = textos.filter((t) => t.role !== "external_assertion" && !llega(t));
      assert.deepEqual(
        bloqueados.map((t) => `[${t.nodo}] (${t.tipo}) ${t.texto}`),
        [],
        "estos textos el cliente NUNCA los vería (el filtro de afirmaciones los descarta sin evidencia): reescribirlos sin palabras de dominio",
      );
      // Los mensajes que afirman algo externo declaran QUÉ afirman (requieren evidencia por diseño).
      for (const n of version.flow.nodes) {
        const c = n.config as { messageRole?: string; asserts?: string[] };
        if (n.type === "message" && c.messageRole === "external_assertion") assert.ok((c.asserts?.length ?? 0) > 0, `${n.id}: external_assertion sin asserts`);
      }
    });
  }
});
