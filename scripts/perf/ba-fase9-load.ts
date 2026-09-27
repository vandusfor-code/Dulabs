/**
 * Business Agent 2.0, FASE 9 — carga CONTROLADA en proceso: 10 / 50 / 100 tenants a la vez.
 *
 * Qué ejecuta: el pipeline REAL de un turno (GeminiExecutor → entendimiento → entidades → state machine → Action Engine
 * con circuitos y límites → renderer) para N tenants × C conversaciones EN PARALELO, compartiendo — como en producción —
 * UN store de estado, UN store de ejecuciones, UN registro de circuitos y UN contador de límites.
 * Qué NO es: no hay red ni Postgres (el transporte del modelo es el doble `fakeGemini` y los stores son los de memoria
 * con el contrato de Postgres). Mide el costo de CPU/coordinación del código y verifica invariantes bajo concurrencia;
 * la contención real de la base se mide aparte con pgbench (ba-fase9-pgbench.sh).
 *
 * Uso: npx tsx scripts/perf/ba-fase9-load.ts [--tenants 10,50,100] [--conversaciones 3] [--json salida.json]
 */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  createPipeline,
  out,
} from "@/lib/agent-compiler/runtime/testing/real-pipeline";
import {
  barberia8Spec,
  BARBERIA_SERVICES,
} from "@/lib/agent-compiler/runtime/testing/fase8-fixtures";
import { createInMemoryConversationStore } from "@/lib/agent-compiler/conversation/testing/in-memory-conversation-store";
import {
  createFakeHandler,
  createInMemoryActionStore,
} from "@/lib/agent-compiler/actions/testing/harness";
import { createCircuitRegistry } from "@/lib/agent-compiler/runtime/production/circuits";
import { createMemoryRateLimiter } from "@/lib/agent-compiler/runtime/production/operations";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : def;
};
const TENANT_COUNTS = arg("tenants", "10,50,100").split(",").map(Number);
const CONVERSATIONS = Number(arg("conversaciones", "3"));
const S = (name: string, raw: string, value?: string) => ({
  name,
  raw,
  ...(value ? { value } : {}),
});
const tenantId = (i: number) =>
  `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`;
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? Number(
        s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!.toFixed(2),
      )
    : 0;
};

/**
 * Escenarios por tenant (C conversaciones a la vez):
 *   "dias_distintos"  cada conversación reserva OTRO día → todas deben completarse (1 reserva por conversación).
 *   "mismo_dia"       todas reservan el MISMO día y hora a la vez → el candado por (tenant, fecha) deja pasar UNA
 *                     reserva; las demás reciben BOOKING_IN_PROGRESS (reintentable) y NO reservan (nunca doble reserva).
 */
const DAYS = ["mañana", "el lunes", "el martes", "el miércoles", "el jueves"];

async function run(tenants: number, scenario: "dias_distintos" | "mismo_dia") {
  const conversationStore = createInMemoryConversationStore();
  const actionStore = createInMemoryActionStore();
  const handler = createFakeHandler();
  const circuits = createCircuitRegistry();
  const limiter = createMemoryRateLimiter(() =>
    Date.parse("2026-09-26T15:00:00Z"),
  );
  const pipelines = Array.from({ length: tenants * CONVERSATIONS }, (_, k) => {
    const t = tenantId(Math.floor(k / CONVERSATIONS));
    return {
      tenant: t,
      day:
        scenario === "mismo_dia"
          ? "mañana"
          : DAYS[(k % CONVERSATIONS) % DAYS.length]!,
      p: createPipeline(barberia8Spec(), {
        tenantId: t,
        phoneNumberId: `pn-${k}`,
        catalogServices: BARBERIA_SERVICES,
        conversationStore,
        actionStore,
        handler,
        circuits,
        limiter,
      }),
    };
  });
  const latencies: number[] = [];
  const say = async (
    p: (typeof pipelines)[number]["p"],
    text: string,
    behavior: Parameters<typeof p.say>[1],
  ) => {
    const t0 = performance.now();
    const r = await p.say(text, behavior);
    latencies.push(performance.now() - t0);
    return r;
  };
  const started = performance.now();
  const results = await Promise.all(
    pipelines.map(async ({ p, day }) => {
      await say(p, "Hola", out("GREETING"));
      await say(
        p,
        `Quiero un corte ${day} a las 4:30 de la tarde, soy Juan, con el Barbero 2`,
        out("BOOKING_REQUEST", [
          S("service", "corte", "Corte"),
          S("date", day),
          S("time", "a las 4:30 de la tarde"),
          S("customer_name", "Juan"),
          S("recurso", "Barbero 2", "Barbero 2"),
        ]),
      );
      const done = await say(p, "sí", out("CONFIRMATION"));
      return {
        status: done.status,
        errors: done.actions.map((a) => a.errorCode).filter(Boolean),
      };
    }),
  );
  const elapsed = performance.now() - started;

  // Invariantes bajo concurrencia.
  const bookings = handler.calls.filter(
    (c) =>
      (c.action as { actionType: string }).actionType ===
      "crear_cita_nylas_generico",
  );
  const perTenant = new Map<string, number>();
  for (const b of bookings)
    perTenant.set(b.tenantId, (perTenant.get(b.tenantId) ?? 0) + 1);
  let crossTenant = 0;
  for (const { tenant, p } of pipelines) {
    const st = await p.state();
    if (!st || st.scope.tenantId !== tenant) crossTenant++;
  }
  return {
    scenario,
    tenants,
    conversations: pipelines.length,
    turns: latencies.length,
    completed: results.filter((r) => r.status === "COMPLETED").length,
    notCompletedErrors: [
      ...new Set(
        results.flatMap((r) => (r.status === "COMPLETED" ? [] : r.errors)),
      ),
    ],
    bookings: bookings.length,
    tenantsWithWrongBookingCount: [...Array(tenants).keys()].filter(
      (i) =>
        (perTenant.get(tenantId(i)) ?? 0) !==
        (scenario === "mismo_dia" ? 1 : CONVERSATIONS),
    ).length,
    crossTenantStates: crossTenant,
    openCircuits: circuits.snapshot(Date.parse("2026-09-26T15:10:00Z")).length,
    elapsedMs: Math.round(elapsed),
    turnsPerSecond: Math.round((latencies.length / elapsed) * 1000),
    latencyMs: {
      p50: pct(latencies, 50),
      p95: pct(latencies, 95),
      max: pct(latencies, 100),
    },
    heapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  };
}

async function main() {
  const out_: unknown[] = [];
  for (const n of TENANT_COUNTS) {
    for (const scenario of ["dias_distintos", "mismo_dia"] as const) {
      const r = await run(n, scenario);
      out_.push(r);
      console.log(JSON.stringify(r));
      const expected = scenario === "mismo_dia" ? n : r.conversations;
      const ok =
        r.completed === expected &&
        r.bookings === expected &&
        r.tenantsWithWrongBookingCount === 0 &&
        r.crossTenantStates === 0;
      if (!ok) {
        console.error(`FAIL invariantes: ${scenario} con ${n} tenants`);
        process.exitCode = 1;
      }
    }
  }
  const json = arg("json", "");
  if (json) writeFileSync(json, JSON.stringify(out_, null, 2));
}

void main();
