// Business Agent 2.0, FASE 6 — `fetch` de prueba que atiende /api/business-agent/onboarding/* EN PROCESO con el MISMO
// servicio que usan las rutas (misma sesión→tenant, mismos guardas de cuerpo, mismo envelope y el mismo flujo NDJSON
// de publicación). Permite E2E de la interfaz sin red ni Supabase. La autenticación real de las rutas (401) y sus
// guardas se prueban aparte contra los route handlers.

import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { readBody, isRevision } from "@/lib/agent-compiler/onboarding/http";
import { activateOnboarding, getOnboarding, previewOnboarding, publishOnboarding, PUBLISH_STAGES, saveOnboardingDraft, testOnboardingAgent, validateOnboarding } from "@/lib/agent-compiler/onboarding/service";
import { SUPPORT_CODES } from "@/lib/agent-compiler/onboarding/issues";
import { depsFor, simulationDeps, type World } from "@/lib/agent-compiler/onboarding/testing/harness";

type Reading = Record<string, unknown>;

export interface InProcessApi {
  fetch: typeof fetch;
  calls: string[];
  /** Simula un corte de red para las peticiones siguientes. */
  offline: { value: boolean };
}

export function createInProcessApi(world: World, sessions: Record<string, string>, readings: Record<string, Reading> = {}): InProcessApi {
  const calls: string[] = [];
  const offline = { value: false };
  let turn = 0;
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (offline.value) throw new TypeError("Failed to fetch");
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/business-agent\/onboarding/, "") || "/";
    calls.push(`${method} ${path}`);
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const tenantId = sessions[auth.replace(/^Bearer /, "")];
    if (!tenantId) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });
    const deps = depsFor(world, tenantId);
    const request = new Request(url, { method, body: init?.body, headers: init?.headers });

    if (path === "/" && method === "GET") return apiOk(await getOnboarding(deps));
    if (path === "/" && method === "PUT") {
      const read = await readBody(request, ["expectedRevision", "draft"]);
      if (!read.ok) return read.response;
      if (!isRevision(read.body.expectedRevision)) return apiError(SUPPORT_CODES.DRAFT_INVALID, "No pudimos guardar: falta la versión de tu configuración.", 400);
      const r = await saveOnboardingDraft(deps, { expectedRevision: read.body.expectedRevision, draft: read.body.draft });
      if (!r.ok) return apiError(r.code, r.message, r.reason === "conflict" ? 409 : 422);
      return apiOk({ revision: r.revision, issues: r.issues });
    }
    if (path === "/validate") return apiOk(await validateOnboarding(deps));
    if (path === "/status") {
      const o = await getOnboarding(deps);
      return apiOk({ status: o.status, pendingChanges: o.pendingChanges, revision: o.revision, publication: o.publication, checklist: o.checklist, numbers: o.numbers });
    }
    if (path === "/publish") {
      const read = await readBody(request, ["expectedRevision"]);
      if (!read.ok) return read.response;
      const expectedRevision = read.body.expectedRevision as number;
      const labels = Object.fromEntries(PUBLISH_STAGES.map((s) => [s.id, s.label]));
      const lines: string[] = [];
      const result = await publishOnboarding(deps, { expectedRevision }, (e) => lines.push(JSON.stringify({ type: "stage", ...e, label: labels[e.stage] })));
      lines.push(JSON.stringify({ type: "result", ...result }));
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const l of lines) controller.enqueue(encoder.encode(`${l}\n`));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
    }
    if (path === "/preview") {
      const read = await readBody(request, ["text", "state"]);
      if (!read.ok) return read.response;
      const r = await previewOnboarding(deps, simulationDeps(readings), { text: String(read.body.text), state: read.body.state ?? null, turnId: `ui-${++turn}` });
      if (!r.ok) return apiError(r.code, r.message, 422, { issues: r.issues });
      return apiOk(r);
    }
    if (path === "/test") {
      const r = await testOnboardingAgent(deps, { readHandler: simulationDeps({}).readHandler });
      if (!r.ok) return apiError(r.code, r.message, 422);
      return apiOk(r);
    }
    if (path === "/activate") {
      const read = await readBody(request, ["phoneNumberId"]);
      if (!read.ok) return read.response;
      const r = await activateOnboarding(deps, { phoneNumberId: String(read.body.phoneNumberId) });
      if (!r.ok) return apiError(r.code, r.message, 409, { reasons: r.reasons });
      return apiOk(r);
    }
    return Response.json({ error: "no encontrado" }, { status: 404 });
  };
  return { fetch: impl as typeof fetch, calls, offline };
}
