// DuLabs Business — Business Agent 2.0, FASE 6 — "Prueba tu agente".
//
// Conversaciones de EJEMPLO generadas desde la configuración del negocio (no por industria) que se ejecutan de verdad,
// en simulación, contra el borrador: Gate → state machine → Action Engine → renderer. Lo que se verifica es el
// comportamiento del agente con TU configuración: que pida lo necesario, respete tus reglas, no ejecute nada real y
// responda con lo que configuraste.
//
// FASE 7: cada mensaje de ejemplo se interpreta con el MISMO entendimiento que la vista previa (IA real en producción),
// y el servicio del ejemplo sale del catálogo REAL del negocio. Si la IA no está disponible, la prueba no se inventa un
// resultado: el servicio de onboarding responde que no se puede ejecutar ahora.

import type { EffectDispatchRequest } from "@/lib/flow/executor-types";
import type { GateRule } from "@/lib/agent-compiler/runtime/guardrail-gate";
import type { CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import { getActionDefinition } from "@/lib/agent-compiler/actions/registry";
import type { ConversationState } from "@/lib/agent-compiler/conversation/model";
import { catalogPortForArtifact } from "@/lib/agent-compiler/conversation/entities";
import { WEEKDAYS } from "@/lib/agent-compiler/business-model/schema";
import type { OnboardingDraft } from "@/lib/agent-compiler/onboarding/draft";
import { readOnlyHandler, runSimulationTurn, type SimulationDeps } from "@/lib/agent-compiler/onboarding/simulation";

export interface ScenarioCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ScenarioResult {
  id: "saludo" | "reserva" | "no_disponible" | "persona" | "tema_restringido" | "pregunta";
  title: string;
  transcript: Array<{ from: "cliente" | "agente"; text: string }>;
  checks: ScenarioCheck[];
  passed: boolean;
}

const DAY_ES: Record<string, string> = { sunday: "domingo", monday: "lunes", tuesday: "martes", wednesday: "miércoles", thursday: "jueves", friday: "viernes", saturday: "sábado" };

/** Un día y una hora que el negocio atiende (para que el ejemplo de reserva sea plausible). Hora sin ambigüedad am/pm. */
function sampleSlot(draft: OnboardingDraft): { dayRaw: string; hourRaw: string } {
  for (const d of [...WEEKDAYS.slice(1), WEEKDAYS[0]]) {
    const day = draft.hours.week[d];
    if (day.open && day.intervals[0]) {
      const [h] = day.intervals[0].start.split(":").map(Number);
      const hour = Math.min(22, (h ?? 9) + 1);
      return { dayRaw: `el ${DAY_ES[d]}`, hourRaw: `a las ${hour > 12 ? hour - 12 : hour}${hour >= 12 ? " de la tarde" : " de la mañana"}` };
    }
  }
  return { dayRaw: "el lunes", hourRaw: "a las 10 de la mañana" };
}

/** Valor de ejemplo para un dato que el negocio pide (según su tipo). */
function sampleValue(kind: string, options?: readonly string[]): string {
  switch (kind) {
    case "count":
    case "number":
      return "2";
    case "email":
      return "cliente@ejemplo.com";
    case "phone":
      return "3001234567";
    case "date":
      return "mañana";
    case "time":
      return "a las 10 de la mañana";
    case "boolean":
      return "sí";
    case "select":
      return options?.[0] ?? "opción 1";
    default:
      return "prueba";
  }
}

export interface ScenarioDeps {
  artifact: CompiledAgentArtifact;
  gateRules: GateRule[];
  draft: OnboardingDraft;
  /** El MISMO entendimiento, catálogo y lecturas que la vista previa. */
  sim: SimulationDeps;
}

async function play(deps: ScenarioDeps, id: ScenarioResult["id"], texts: string[]) {
  const seen: EffectDispatchRequest[] = [];
  const handler = readOnlyHandler(deps.sim.readHandler, seen);
  let state: ConversationState | null = null;
  const transcript: ScenarioResult["transcript"] = [];
  const steps: Array<{ replies: string[]; status: string | null; gate: string; actions: Array<{ action: string; status: string; simulated: boolean }> }> = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]!;
    transcript.push({ from: "cliente", text });
    const r = await runSimulationTurn(
      { ...deps.sim, readHandler: handler, trace: deps.sim.trace ?? (() => {}) },
      { artifact: deps.artifact, gateRules: deps.gateRules, state, text, turnId: `prueba-${id}-${i}` },
    );
    if (!r.ok) {
      steps.push({ replies: [], status: null, gate: "error", actions: [] });
      break;
    }
    state = r.result.state;
    for (const reply of r.result.replies) transcript.push({ from: "agente", text: reply });
    steps.push({ replies: r.result.replies, status: state?.status ?? null, gate: r.result.gate.decision, actions: r.result.actions });
  }
  // Nada real: ninguna acción con efecto llegó al handler, y toda acción con efecto quedó marcada como simulada.
  const realWrites = seen.filter((s) => getActionDefinition((s.action as { actionType?: string }).actionType ?? "")?.mutation);
  const unsimulated = steps.flatMap((s) => s.actions).filter((a) => getActionDefinition(a.action)?.mutation && a.status === "SUCCEEDED" && !a.simulated);
  const safe: ScenarioCheck = { label: "No ejecutó acciones reales", ok: realWrites.length === 0 && unsimulated.length === 0, ...(realWrites.length + unsimulated.length > 0 ? { detail: "Se intentó una acción real." } : {}) };
  return { transcript, steps, safe };
}

const result = (id: ScenarioResult["id"], title: string, transcript: ScenarioResult["transcript"], checks: ScenarioCheck[]): ScenarioResult => ({ id, title, transcript, checks, passed: checks.every((c) => c.ok) });

/** Ejecuta las conversaciones de ejemplo que aplican a ESTA configuración. */
export async function runAgentScenarios(deps: ScenarioDeps): Promise<ScenarioResult[]> {
  const a = deps.artifact;
  const req = a.requirements;
  const results: ScenarioResult[] = [];

  // 1. Saludo
  {
    const p = await play(deps, "saludo", ["Hola, buenas"]);
    const reply = p.steps[0]?.replies.join(" ") ?? "";
    results.push(result("saludo", "Saludo", p.transcript, [{ label: "Respondió con el nombre de tu negocio", ok: reply.includes(a.identity.name) }, p.safe]));
  }

  // 2. Reserva (si agenda) o petición no disponible
  if (req.goals.booking.supported) {
    const s = sampleSlot(deps.draft);
    // El servicio del ejemplo es uno REAL de tu negocio (el mismo catálogo que usa tu agente).
    const catalog = a.booking?.requiresService ? await catalogPortForArtifact(a, deps.sim.readServices)?.load().catch(() => null) : null;
    const service = catalog?.services[0]?.name ?? null;
    if (a.booking?.requiresService && !service) {
      results.push(
        result("reserva", "Reservar una cita", [], [{ label: "Tienes servicios para reservar", ok: false, detail: "Agrega al menos un servicio en «Oferta» para probar una reserva." }]),
      );
    } else {
      const t1 = `Quiero agendar${service ? ` un ${service}` : " una cita"} para ${s.dayRaw} ${s.hourRaw}`;
      const missing = req.goals.booking.required.map((r) => r.ask).filter((slot) => !["date", "time", "service"].includes(slot));
      const second = missing.map((slot) => {
        const def = a.understanding.businessSlots.find((b) => b.name === slot);
        return slot === "customer_name" ? "Ana Prueba" : slot === "email" ? "cliente@ejemplo.com" : sampleValue(def?.kind ?? "text", def?.options);
      });
      const t2 = second.length > 0 ? `Mis datos: ${second.join(", ")}` : null;
      const p = await play(deps, "reserva", [t1, ...(t2 ? [t2] : []), "Sí, confírmala"]);
      const asked = t2 ? p.steps[0]?.status === "COLLECTING_INFORMATION" && (p.steps[0]?.replies.join(" ").includes("?") ?? false) : true;
      const confirmIdx = t2 ? 1 : 0;
      const proposed = p.steps[confirmIdx]?.status === "AWAITING_CONFIRMATION";
      const last = p.steps.at(-1);
      const simulatedBooking = Boolean(last?.actions.some((x) => x.simulated && req.goals.booking.action === x.action));
      results.push(
        result("reserva", "Reservar una cita", p.transcript, [
          { label: "Pidió la información necesaria", ok: asked && proposed, ...(asked && proposed ? {} : { detail: "No llegó a pedir confirmación con los datos del ejemplo." }) },
          { label: "Pidió confirmación antes de agendar", ok: proposed },
          { label: "Solo simuló la reserva (no creó nada en tu calendario)", ok: simulatedBooking },
          p.safe,
        ]),
      );
    }
  } else {
    const p = await play(deps, "no_disponible", ["Quiero agendar una cita para mañana"]);
    const reply = p.steps[0]?.replies.join(" ") ?? "";
    results.push(
      result("no_disponible", "Pedir algo que tu negocio no hace por aquí", p.transcript, [
        { label: "Explicó que eso no se gestiona por aquí", ok: /no puedo gestionar eso/i.test(reply) },
        { label: "No intentó agendar", ok: !p.steps.some((s) => s.actions.length > 0) },
        p.safe,
      ]),
    );
  }

  // 3. Hablar con una persona
  if (req.handoff.supported) {
    const p = await play(deps, "persona", ["Quiero hablar con una persona"]);
    const reply = p.steps[0]?.replies.join(" ") ?? "";
    results.push(
      result("persona", "Pedir hablar con una persona", p.transcript, [
        { label: "Pasó la conversación a tu equipo (simulado)", ok: /Simulación/.test(reply) && /persona/.test(reply) },
        p.safe,
      ]),
    );
  }

  // 4. Tema restringido
  const topic = deps.draft.restrictedTopics.find((t) => t.words.some((w) => w.trim()));
  if (topic) {
    const word = topic.words.find((w) => w.trim())!.trim();
    const p = await play(deps, "tema_restringido", [`¿Qué opinas de ${word}?`]);
    const expected = topic.reply?.trim() || "Prefiero no hablar de ese tema. ¿Te ayudo con algo más?";
    results.push(
      result("tema_restringido", `Tema restringido: «${word}»`, p.transcript, [
        { label: "Respetó tu regla", ok: p.steps[0]?.gate === "fixed_response" && (p.steps[0]?.replies[0] ?? "") === expected },
        p.safe,
      ]),
    );
  }

  // 5. Pregunta sobre el negocio
  if (req.informationAction) {
    const p = await play(deps, "pregunta", ["¿Qué horario tienen?"]);
    const reply = p.steps[0]?.replies.join(" ") ?? "";
    const looked = Boolean(p.steps[0]?.actions.some((x) => x.action === req.informationAction));
    results.push(
      result("pregunta", "Preguntar algo de tu negocio", p.transcript, [
        { label: "Buscó en la información de tu negocio", ok: looked },
        { label: "Respondió sin inventar", ok: reply.length > 0 },
        p.safe,
      ]),
    );
  }
  return results;
}
