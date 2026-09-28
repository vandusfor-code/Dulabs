// Business Agent 2.0, FASE 10 — un negocio configurado y PUBLICADO por el onboarding, con su runtime armado sobre el
// artefacto ACTIVO (lo que carga producción cuando el enlace coincide con la versión servida). Solo para tests.
import assert from "node:assert/strict";
import { publishOnboarding, saveOnboardingDraft } from "@/lib/agent-compiler/onboarding/service";
import { depsFor, type World } from "@/lib/agent-compiler/onboarding/testing/harness";
import type { OnboardingDraft } from "@/lib/agent-compiler/onboarding/draft";
import type { CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import { createPipeline, type PipelineOptions } from "@/lib/agent-compiler/runtime/testing/real-pipeline";

export async function publishDraft(world: World, tenantId: string, draft: OnboardingDraft) {
  const deps = depsFor(world, tenantId);
  const saved = await saveOnboardingDraft(deps, { expectedRevision: 0, draft });
  assert.ok(saved.ok, JSON.stringify(saved));
  const pub = await publishOnboarding(deps, { expectedRevision: saved.revision });
  assert.ok(pub.ok, JSON.stringify(pub));
  const flow = world.registry._debug.flows.find((f) => f.tenantId === tenantId)!;
  const served = (await world.registry.resolvePublishedVersion(tenantId, flow.id))!;
  const active = (await world.fakes.modelStore.loadActive(tenantId, flow.id))!;
  return { deps, flowId: flow.id, served, artifact: active.artifact as CompiledAgentArtifact };
}

/** Runtime del negocio publicado (mismo artefacto que producción). */
export async function publishedPipeline(world: World, tenantId: string, draft: OnboardingDraft, opts: Omit<PipelineOptions, "tenantId" | "artifact" | "agentId"> = {}) {
  const pub = await publishDraft(world, tenantId, draft);
  const p = createPipeline(pub.served.spec, { ...opts, tenantId, agentId: pub.flowId, artifact: pub.artifact });
  return { ...pub, p };
}
