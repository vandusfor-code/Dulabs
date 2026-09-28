// Business Agent 2.0 — investigación del despachador en producción (tras FASE 9).
//
// Defecto: el despacho tomaba el lote COMPLETO (hasta 50) con un lease de 60 s y lo recorría en serie, sin presupuesto de
// tiempo, dentro de una función con maxDuration = 60 s. Si la plataforma cortaba la función a mitad del lote, los
// recordatorios que NUNCA llegaron a enviarse quedaban en 'sending'; el siguiente despacho los marcaba 'unknown'
// (OUTCOME_UNKNOWN), la verificación no los encontraba en el historial y — por diseño — nunca se reenvían: el cliente
// jamás recibía el recordatorio. Además la respuesta nunca llegaba (504) y no quedaba latido.
// Las llamadas a Postgres (PostgREST) no tenían timeout: una colgada consumía la función entera.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { memoryReminders } from "@/lib/agent-compiler/runtime/testing/fase8-fixtures";
import {
  DISPATCH_BUDGET_MS,
  DISPATCH_DB_TIMEOUT_MS,
  dispatchDueReminders,
  fetchWithTimeout,
  REMINDER_SEND_TIMEOUT_MS,
  type ReminderDispatchDeps,
} from "@/lib/agent-compiler/runtime/production/reminder-dispatcher";
import type { ScheduleReminderInput } from "@/lib/agent-compiler/actions/native/reminders";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const MAX_DURATION_MS = 60_000; // app/api/business-agent/reminders/dispatch/route.ts → maxDuration
const SCHEDULE_EVERY_MS = 5 * 60_000; // QStash */5

function input(i: number): ScheduleReminderInput {
  return {
    tenantId: A,
    agentId: "f",
    conversationId: `pn:${i}`,
    phoneNumberId: "pn",
    telefonoCliente: `57300000${String(i).padStart(4, "0")}`,
    anchorRef: `cita-${i}`,
    appointmentStart: "2026-09-28T21:30:00.000Z",
    service: "Corte",
    remindAt: "2026-09-28T20:30:00.000Z",
    timezone: "America/Bogota",
    message: "x",
    idempotencyKey: i.toString(16).padStart(32, "0"),
    tone: null,
  };
}

/**
 * Una invocación de la función serverless: si el reloj pasa de maxDuration, la plataforma la corta — desde ese instante
 * NADA más se ejecuta ni persiste (cada dependencia lanza) y no hay respuesta ni latido.
 */
function invocation(store: ReturnType<typeof memoryReminders>, clock: { now: number }, perSendMs: number, attempted: Set<string>) {
  const killAt = clock.now + MAX_DURATION_MS;
  let killed = false;
  let beats = 0;
  const alive = () => {
    if (clock.now > killAt) killed = true;
    if (killed) throw new Error("FUNCTION_KILLED");
  };
  const guard = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A) => {
    alive();
    return fn(...a);
  };
  const deps: ReminderDispatchDeps = {
    store: {
      ...store,
      claimDue: guard(store.claimDue.bind(store)),
      beginSend: guard(store.beginSend.bind(store)),
      markSent: guard(store.markSent.bind(store)),
      complete: guard(store.complete.bind(store)),
      unverified: guard(store.unverified.bind(store)),
      resolveUnknown: guard(store.resolveUnknown.bind(store)),
    },
    clock: () => new Date(clock.now),
    env: {},
    log: () => {},
    random: () => 0.5,
    lastInboundAt: guard(async () => new Date(clock.now - 3_600_000)),
    send: guard(async (r) => {
      attempted.add(r.id);
      clock.now += perSendMs; // latencia real de Meta + registro del saliente
      alive(); // cortada DURANTE el envío: desenlace desconocido (legítimo)
      return { kind: "sent", providerMessageId: `wamid.${r.id}` };
    }),
    findSent: guard(async () => false),
    heartbeat: guard(async () => void beats++),
  };
  return { deps, state: () => ({ killed, beats }) };
}

async function runSchedule(total: number, perSendMs: number, invocations: number) {
  const clock = { now: Date.parse("2026-09-28T20:00:00Z") };
  const store = memoryReminders(() => clock.now);
  for (let i = 0; i < total; i++) await store.schedule(input(i));
  clock.now = Date.parse("2026-09-28T20:31:00Z");
  const attempted = new Set<string>();
  const runs: Array<{ killed: boolean; beats: number; elapsedMs: number }> = [];
  for (let k = 0; k < invocations; k++) {
    const start = clock.now;
    const inv = invocation(store, clock, perSendMs, attempted);
    try {
      await dispatchDueReminders(inv.deps, { limit: 50 });
    } catch {
      // cortada: la plataforma no devuelve nada (504)
    }
    runs.push({ ...inv.state(), elapsedMs: clock.now - start });
    clock.now = start + SCHEDULE_EVERY_MS;
  }
  const byStatus = (s: string) => store.rows.filter((r) => r.status === s);
  return { store, attempted, runs, byStatus };
}

describe("Despachador en producción — presupuesto de tiempo, lease y timeouts", () => {
  it("D1. 50 recordatorios vencidos con Meta lento (1,5 s c/u): ninguno queda 'unknown' sin haberse intentado; todos se envían una vez", async () => {
    const { store, attempted, runs, byStatus } = await runSchedule(50, 1_500, 5);
    const neverAttemptedButUnknown = byStatus("unknown").filter((r) => !attempted.has(r.id));
    assert.deepEqual(neverAttemptedButUnknown.map((r) => r.id), [], "un recordatorio que nunca llegó a Meta NO puede quedar como desenlace desconocido");
    assert.equal(byStatus("sent").length, 50, "todos terminan enviados (en varias ejecuciones)");
    assert.equal(store.rows.every((r) => r.attempts === 1), true, "cada recordatorio se tomó una sola vez");
    assert.equal(runs.some((r) => r.killed), false, "ninguna ejecución excede maxDuration");
    assert.equal(runs.every((r) => r.beats === 1), true, "cada ejecución deja su latido");
  });

  it("D2. cada ejecución termina dentro del presupuesto y bajo maxDuration (respuesta HTTP + latido siempre)", async () => {
    const { runs } = await runSchedule(50, 1_500, 5);
    for (const r of runs) assert.ok(r.elapsedMs <= DISPATCH_BUDGET_MS + 1_500 && r.elapsedMs < MAX_DURATION_MS, `duró ${r.elapsedMs} ms`);
    assert.ok(DISPATCH_BUDGET_MS + REMINDER_SEND_TIMEOUT_MS + 10 * DISPATCH_DB_TIMEOUT_MS < MAX_DURATION_MS, "presupuesto + UN recordatorio en curso (8 llamadas a Postgres + Meta) + latido + limpieza cabe en maxDuration");
  });

  it("D3. con 0 recordatorios (producción hoy) la ejecución es inmediata y deja latido", async () => {
    const { runs, store } = await runSchedule(0, 1_500, 2);
    assert.equal(store.rows.length, 0);
    assert.deepEqual(runs.map((r) => [r.killed, r.beats, r.elapsedMs]), [[false, 1, 0], [false, 1, 0]]);
  });

  it("D4. una llamada a Postgres que se cuelga se aborta en DISPATCH_DB_TIMEOUT_MS (nunca consume la función entera)", async (t) => {
    const hung: typeof fetch = (_u, init) =>
      new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason), { once: true }));
    // AbortSignal.timeout no retiene el event loop (en producción lo retiene el servidor HTTP): aquí lo hace un intervalo.
    const keepAlive = setInterval(() => {}, 1_000);
    t.after(() => clearInterval(keepAlive));
    const t0 = Date.now();
    await assert.rejects(fetchWithTimeout(hung, 50)("https://db.invalid/rest/v1/rpc/x", { method: "POST" }), /timeout|abort/i);
    assert.ok(Date.now() - t0 < 1_000);
    // La señal de quien llama se respeta también.
    const ctrl = new AbortController();
    const p = fetchWithTimeout(hung, 5_000)("https://db.invalid/rest/v1/rpc/x", { signal: ctrl.signal });
    ctrl.abort(new Error("caller abort"));
    await assert.rejects(p, /caller abort/);
    // Una llamada normal pasa intacta.
    const okFetch: typeof fetch = async () => new Response("[]", { status: 200 });
    assert.equal((await fetchWithTimeout(okFetch, 50)("https://db.invalid/rest/v1/x")).status, 200);
  });
});
