/**
 * Business Agent 2.0, FASE 10 — tiempos EN PROCESO de cada etapa del autoservicio y del runtime.
 *
 * Qué mide: el costo de CPU/coordinación del código del Business Agent en cada operación (guardar borrador, validar,
 * vista previa, "Prueba tu agente", publicar = compilar + verificar + RPC en memoria, activar, respuesta del runtime).
 * Qué NO mide: red, Postgres ni la IA real (stores en memoria con la semántica de las migraciones; transporte del
 * modelo con guion). La latencia real de producción = esto + consultas + IA; ver scripts/perf/ba-fase9-pgbench.sh.
 *
 * Uso: npx tsx scripts/perf/ba-fase10-onboarding.ts [--n 30]
 */
import { performance } from "node:perf_hooks";
import { activateOnboarding, previewOnboarding, publishOnboarding, saveOnboardingDraft, testOnboardingAgent, validateOnboarding } from "@/lib/agent-compiler/onboarding/service";
import { barberDraft, barberScenarioReadings, BARBER_SERVICES, createWorld, depsFor, reading, simulationDeps, TENANT_A } from "@/lib/agent-compiler/onboarding/testing/harness";
import { createPipeline, out } from "@/lib/agent-compiler/runtime/testing/real-pipeline";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : def;
};
const N = Number(arg("n", "30"));
const samples: Record<string, number[]> = {};
async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  (samples[label] ??= []).push(performance.now() - t0);
  return r;
}
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Number(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!.toFixed(2));
};

async function main() {
  for (let i = 0; i < N; i++) {
    const world = createWorld();
    const deps = depsFor(world, TENANT_A);
    const saved = await time("save_draft", () => saveOnboardingDraft(deps, { expectedRevision: 0, draft: barberDraft() }));
    if (!saved.ok) throw new Error("save");
    await time("validate", () => validateOnboarding(deps));
    await time("preview", () => previewOnboarding(deps, simulationDeps({ Hola: reading("GREETING") }), { text: "Hola", state: null, turnId: `t${i}` }));
    await time("test_agent", () => testOnboardingAgent(deps, simulationDeps(barberScenarioReadings(), [], BARBER_SERVICES)));
    const pub = await time("publish", () => publishOnboarding(deps, { expectedRevision: saved.revision }));
    if (!pub.ok) throw new Error("publish");
    await time("activate", () => activateOnboarding(deps, { phoneNumberId: "pn-a" }));
    const flow = world.registry._debug.flows[0]!;
    const served = (await world.registry.resolvePublishedVersion(TENANT_A, flow.id))!;
    const artifact = (await world.fakes.modelStore.loadActive(TENANT_A, flow.id))!.artifact as never;
    const p = createPipeline(served.spec, { tenantId: TENANT_A, agentId: flow.id, artifact, catalogServices: BARBER_SERVICES.map((name) => ({ name, durationMinutes: 30, price: 30_000 })) });
    await time("runtime_greeting", () => p.say("Hola", out("GREETING")));
    await time("runtime_price", () => p.say("¿Cuánto cuesta el corte clásico?", out("PRICE_INQUIRY", [{ name: "service", raw: "corte clásico", value: "Corte clásico" }])));
  }
  const rows = Object.entries(samples).map(([op, xs]) => ({ op, n: xs.length, p50_ms: pct(xs, 50), p95_ms: pct(xs, 95), max_ms: pct(xs, 100) }));
  console.table(rows);
  console.log(JSON.stringify(rows));
}

void main();
