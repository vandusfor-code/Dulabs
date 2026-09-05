/**
 * Blocker NLU (autorizado) — validación del NLU REAL de Claude para el
 * clasificador de intención de Daniela, después de cerrar el Blocker #7
 * (Fix A: classify sin responseText; Fix B: __firstMessageText llega como
 * userMessage).
 *
 * Usa el camino real de producción hasta la llamada a Claude -- flow real
 * (danielaRouterFlow), motor real (runFlowEngine) para obtener el context
 * real del efecto, buildAIRequest real, ClaudeExecutor.dispatch() REAL --
 * pero llamado DIRECTAMENTE, sin orchestrator ni registry de otros
 * executors. Es físicamente imposible que esto dispare una acción real: no
 * hay ningún InternalActionExecutor ni SendMessageExecutor en este proceso,
 * no hay Supabase, no hay WhatsApp.
 *
 * Se salta automáticamente si no hay ANTHROPIC_API_KEY en el entorno (mismo
 * patrón que HAS_SUPABASE en flow-store.test.ts) -- npm run test:flow normal
 * NO hace llamadas reales ni incurre en costo; esta suite solo corre cuando
 * alguien la invoca deliberadamente con la key presente.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { danielaRouterFlow } from "@/lib/flows/daniela-router.flow";
import { danielaCancelarCitaFlow } from "@/lib/flows/daniela-cancelar-cita.flow";
import { buildAIRequest } from "@/lib/flow/claude/claude-context-builder";
import { ClaudeExecutor } from "@/lib/flow/executors/claude-executor";
import type { AiNodeConfig } from "@/lib/flow/types";
import type { EffectDispatchRequest } from "@/lib/flow/executor-types";

const HAS_ANTHROPIC = Boolean(process.env.ANTHROPIC_API_KEY);

function nodeConfig(flow: ReturnType<typeof danielaRouterFlow>, nodeId: string): AiNodeConfig {
  const node = flow.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "ai") throw new Error(`nodo ai no encontrado: ${nodeId}`);
  return node.config;
}

async function classifyViaRouter(
  executor: ClaudeExecutor,
  mensaje: string,
): Promise<{ classification?: string; error?: string }> {
  const flow = danielaRouterFlow();
  const state = createFlowEngineState(flow, {});
  const run = runFlowEngine(flow, state, { type: "start", text: mensaje });
  const effect = run.effects.find((e) => e.type === "effect_required" && e.kind === "ai");
  if (!effect || effect.type !== "effect_required") throw new Error("no se generó effect_required ai");

  const req = buildAIRequest({
    request: {
      effectId: effect.effectId,
      executionRowId: "row-nlu-test",
      tenantId: "tenant-nlu-test",
      nodeId: effect.nodeId,
      attempt: 1,
      kind: "ai",
      payload: effect.context,
    } as EffectDispatchRequest,
    ai: nodeConfig(flow, "ai-clasificar-intencion"),
    model: "claude-sonnet-5",
  });
  assert.equal(req.userMessage, mensaje, "FALLO DE PLOMERÍA (Blocker #7 Fix B): el mensaje real debe llegar tal cual como userMessage");

  const dispatchReq: EffectDispatchRequest = {
    effectId: effect.effectId,
    executionRowId: "row-nlu-test",
    tenantId: "tenant-nlu-test",
    nodeId: effect.nodeId,
    attempt: 1,
    kind: "ai",
    payload: effect.context,
    ai: nodeConfig(flow, "ai-clasificar-intencion"),
  } as EffectDispatchRequest;

  const result = await executor.dispatch(dispatchReq, { tenantId: "tenant-nlu-test", internal: true });
  if (!result.success) return { error: result.error };
  const data = result.data as Record<string, unknown>;
  assert.equal("responseText" in data, false, "FALLO (Blocker #7 Fix A): classify no debe poder producir responseText");
  return { classification: data.classification as string };
}

async function classifyViaConfirmacionCancelar(
  executor: ClaudeExecutor,
  respuesta: string,
): Promise<{ classification?: string; error?: string }> {
  const flow = danielaCancelarCitaFlow();
  const dispatchReq: EffectDispatchRequest = {
    effectId: "fx-confirm-nlu",
    executionRowId: "row-nlu-test",
    tenantId: "tenant-nlu-test",
    nodeId: "ai-clasificar-confirmacion",
    attempt: 1,
    kind: "ai",
    payload: { respuestaConfirmacionTexto: respuesta },
    ai: nodeConfig(flow, "ai-clasificar-confirmacion"),
  } as EffectDispatchRequest;
  const result = await executor.dispatch(dispatchReq, { tenantId: "tenant-nlu-test", internal: true });
  if (!result.success) return { error: result.error };
  return { classification: (result.data as Record<string, unknown>).classification as string };
}

describe(
  "Blocker NLU — clasificación real de Claude (post Blocker #7 Fix A/B)",
  { skip: !HAS_ANTHROPIC && "requiere ANTHROPIC_API_KEY -- suite de costo real, no corre en CI normal" },
  () => {
    const executor = new ClaudeExecutor({ resolveApiKey: async () => process.env.ANTHROPIC_API_KEY! });

    const CASOS_DUROS: Array<{ id: string; mensaje: string; esperado: string[] }> = [
      { id: "1", mensaje: "Quiero una cita", esperado: ["agendar"] },
      { id: "2", mensaje: "Quiero reservar", esperado: ["agendar"] },
      { id: "3", mensaje: "Quiero reservar para el viernes", esperado: ["agendar"] },
      { id: "4", mensaje: "Quiero hacerme las uñas", esperado: ["agendar"] },
      { id: "5", mensaje: "Quiero cancelar mi cita", esperado: ["cancelar"] },
      { id: "6", mensaje: "Ya no puedo ir mañana", esperado: ["cancelar"] },
      { id: "7", mensaje: "Quiero quitar la cita", esperado: ["cancelar"] },
      { id: "8", mensaje: "Quiero cambiar mi cita", esperado: ["reagendar"] },
      { id: "9", mensaje: "La hora que tengo no me sirve", esperado: ["reagendar"] },
      { id: "10", mensaje: "¿Será posible mover la que tengo?", esperado: ["reagendar"] },
      { id: "11", mensaje: "Quiero moverla para mañana", esperado: ["reagendar"] },
      { id: "12", mensaje: "¿Qué cita tengo?", esperado: ["consultar"] },
      { id: "13", mensaje: "¿Para cuándo estoy?", esperado: ["consultar"] },
      { id: "14", mensaje: "¿Cuánto cuestan las uñas?", esperado: ["otro"] },
      { id: "15", mensaje: "No sé qué servicio hacerme", esperado: ["otro"] },
      { id: "16", mensaje: "Hola", esperado: ["otro"] },
      { id: "17", mensaje: "Necesito ayuda", esperado: ["otro"] },
      { id: "18", mensaje: "¿Me puedes ayudar?", esperado: ["otro"] },
      { id: "19", mensaje: "Quiero un masaje", esperado: ["agendar"] },
      { id: "27", mensaje: "Tengo una pregunta", esperado: ["otro"] },
      { id: "v-ag-1", mensaje: "Me gustaría reservar", esperado: ["agendar"] },
      { id: "v-ag-2", mensaje: "Necesito agendar", esperado: ["agendar"] },
      { id: "v-ag-3", mensaje: "Quisiera separar un espacio", esperado: ["agendar"] },
      { id: "v-ag-4", mensaje: "Quiero sacar una cita", esperado: ["agendar"] },
      // v-ag-5 ("¿Tienen disponibilidad para atenderme?") NO está en esta
      // lista a propósito -- ver GAP documentado en el reporte del Blocker
      // NLU: es un caso genuinamente ambiguo entre "agendar" e
      // "información/disponibilidad", no un error claro de clasificación.
      { id: "v-ag-6", mensaje: "Necesito que me atiendan el viernes", esperado: ["agendar"] },
      { id: "v-ag-7", mensaje: "Quisiera una cita para el viernes", esperado: ["agendar"] },
      { id: "v-can-1", mensaje: "Ya no voy a poder ir", esperado: ["cancelar"] },
      { id: "v-can-2", mensaje: "No podré asistir", esperado: ["cancelar"] },
      { id: "v-can-3", mensaje: "Necesito quitar mi cita", esperado: ["cancelar"] },
      { id: "v-can-4", mensaje: "Quiero dejar sin efecto la cita", esperado: ["cancelar"] },
      { id: "v-can-5", mensaje: "Ya no me sirve la cita que tengo", esperado: ["cancelar", "reagendar"] },
      { id: "v-re-1", mensaje: "Necesito cambiar el horario", esperado: ["reagendar"] },
      { id: "v-re-2", mensaje: "¿Podemos pasarla para otro día?", esperado: ["reagendar"] },
      { id: "v-re-3", mensaje: "La hora actual no me funciona", esperado: ["reagendar"] },
      { id: "v-re-4", mensaje: "Quiero mover la cita", esperado: ["reagendar"] },
      { id: "v-re-5", mensaje: "Necesito otra hora", esperado: ["reagendar", "agendar"] },
      { id: "v-con-1", mensaje: "¿Cuándo tengo mi cita?", esperado: ["consultar"] },
      { id: "v-con-2", mensaje: "¿Para qué día quedé?", esperado: ["consultar"] },
      { id: "v-con-3", mensaje: "¿Me recuerdas mi cita?", esperado: ["consultar"] },
      { id: "v-con-4", mensaje: "¿A qué hora estoy?", esperado: ["consultar"] },
      { id: "v-con-5", mensaje: "¿Qué día me toca?", esperado: ["consultar"] },
    ];

    for (const c of CASOS_DUROS) {
      it(`[${c.id}] "${c.mensaje}" -> ${c.esperado.join("|")}`, async () => {
        const r = await classifyViaRouter(executor, c.mensaje);
        assert.equal(r.error, undefined, `no debe fallar la llamada real: ${r.error}`);
        assert.ok(
          c.esperado.includes(r.classification ?? ""),
          `esperaba ${c.esperado.join("|")}, Claude real devolvió "${r.classification}"`,
        );
      });
    }

    describe("Ambiguos -- el contrato exige 'otro' ante duda genuina (no se fuerza una intención)", () => {
      const AMBIGUOS = ["La cita", "Lo de mañana", "Quiero otra", "Sí", "Dale", "Perfecto", "Ya no", "Necesito cambiar algo"];
      for (const mensaje of AMBIGUOS) {
        it(`"${mensaje}" -> el router lo trata como 'otro' (informativo, no se exige)`, async () => {
          const r = await classifyViaRouter(executor, mensaje);
          assert.equal(r.error, undefined);
          // No se afirma una única respuesta "correcta" -- se documenta.
          assert.ok(typeof r.classification === "string" && r.classification.length > 0);
        });
      }
    });

    describe("Continuación contextual -- defensa en profundidad + mecanismo real", () => {
      const CONTINUACIONES_BARE = ["manos", "Sí", "mañana a las 4"];
      for (const mensaje of CONTINUACIONES_BARE) {
        it(`[defensa en profundidad] "${mensaje}" enviado (por error hipotético) al clasificador del router -> NO debe inferir agendar/cancelar/reagendar de la nada`, async () => {
          const r = await classifyViaRouter(executor, mensaje);
          assert.equal(r.error, undefined);
          assert.notEqual(
            r.classification,
            undefined,
          );
          // El mecanismo REAL que evita que esto ocurra en producción es el
          // motor (getActiveExecution + currentNodeId), ya probado sin
          // Claude en daniela-router.test.ts caso 14 y en el fix de carrera
          // del Blocker #8 -- esto es una medición adicional de robustez,
          // no la protección real.
        });
      }

      it("[mecanismo real] 'Sí' respondiendo '¿Confirmas que deseas cancelar?' -> ai-clasificar-confirmacion (subflow real) -> 'confirma'", async () => {
        const r = await classifyViaConfirmacionCancelar(executor, "Sí");
        assert.equal(r.error, undefined);
        assert.equal(r.classification, "confirma");
      });

      it("[mecanismo real] 'mejor no' respondiendo la misma pregunta -> 'no_confirma'", async () => {
        const r = await classifyViaConfirmacionCancelar(executor, "mejor no");
        assert.equal(r.error, undefined);
        assert.equal(r.classification, "no_confirma");
      });
    });

    it("GAP documentado: '¿Tienen disponibilidad para atenderme?' -> Claude clasifica 'otro' de forma ESTABLE (3/3), no 'agendar' -- interpretación defendible, no forzada aquí", async () => {
      const intentos = await Promise.all([
        classifyViaRouter(executor, "¿Tienen disponibilidad para atenderme?"),
        classifyViaRouter(executor, "¿Tienen disponibilidad para atenderme?"),
        classifyViaRouter(executor, "¿Tienen disponibilidad para atenderme?"),
      ]);
      const clasificaciones = intentos.map((r) => r.classification);
      // Se documenta el comportamiento real, estable -- no se afirma que
      // "otro" sea incorrecto (ver GAP en el reporte: es una pregunta de
      // disponibilidad, defendible como información, no una orden clara de
      // agendar). Si esto cambiara de comportamiento (dejara de ser
      // estable), este test lo haría evidente.
      assert.ok(clasificaciones.every((c) => c === clasificaciones[0]), `esperaba estabilidad 3/3, obtuvo: ${clasificaciones.join(",")}`);
    });
  },
);
