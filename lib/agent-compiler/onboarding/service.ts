// DuLabs Business — Business Agent 2.0, FASE 6 — orquestación del onboarding (pura, con dependencias inyectadas).
//
// Las rutas HTTP (app/api/business-agent/onboarding/*) solo autentican, derivan el tenant de la SESIÓN, construyen estas
// dependencias y llaman aquí. Nada de aquí lee el tenant del cuerpo de la petición.
//
//   guardar    borrador estricto + revisión optimista (otra pestaña => conflicto, nunca se pisa)
//   validar    borrador → UBM (FASE 5) + Spec del runtime compilado + verificación con datos reales
//   publicar   etapas reales, en orden: revisar → validar → compilar → verificar → guardar versión → publicar (atómico)
//   activar    solo con la última configuración publicada + gate de activación de FASE 1 (plan, número, readiness)

import { detectConfigurationDrift, type ArtifactLink, type DriftFinding } from "@/lib/agent-compiler/lifecycle/drift";
import { checksumOf } from "@/lib/agent-compiler/checksum";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { buildGateRules, type GateRule } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { hasErrors } from "@/lib/agent-compiler/diagnostics";
import { compileAndCreateDraftVersion } from "@/lib/agent-compiler/registry/registry";
import type { BusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/types";
import type { AgentEngineId, BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { evaluateReadiness, type ReadinessFacts, type ReadinessReport } from "@/lib/business-agent-readiness";
import type { AgentLifecycleState } from "@/lib/agent-compiler/lifecycle/lifecycle";
import { explainActivationBlocker, type ActivationBlocker, type ActivationDecision } from "@/lib/agent-compiler/lifecycle/activation-gate";
import type { CapabilityRow, EngineReadiness, EngineReport } from "@/lib/agent-compiler/lifecycle/capability-matrix";
import { compileBusinessModel, compileLegacySpec } from "@/lib/agent-compiler/business-model/compile";
import type { CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import { publishedVersionRef } from "@/lib/agent-compiler/business-model/store";
import { draftFromSpec, emptyDraft, parseDraft, type OnboardingDraft } from "@/lib/agent-compiler/onboarding/draft";
import { assembleDraft, type Assembly } from "@/lib/agent-compiler/onboarding/assemble";
import { buildRuntimeSpec } from "@/lib/agent-compiler/onboarding/runtime-spec";
import { issue, READINESS_STEP, SUPPORT_CODES, type OnboardingIssue, type OnboardingStep } from "@/lib/agent-compiler/onboarding/issues";
import { buildChecklist, deriveOnboardingStatus, type ChecklistItem, type OnboardingStatus, type PublicationRecord, type WhatsAppNumberInfo } from "@/lib/agent-compiler/onboarding/status";
import type { OnboardingDraftStore, OnboardingPublisher } from "@/lib/agent-compiler/onboarding/store";
import { runSimulationTurn, type SimulationDeps } from "@/lib/agent-compiler/onboarding/simulation";
import { runAgentScenarios, type ScenarioResult } from "@/lib/agent-compiler/onboarding/scenarios";

export const ONBOARDING_EVENTS = [
  "onboarding_started",
  "draft_saved",
  "validation_failed",
  "validation_passed",
  "publish_started",
  "publish_succeeded",
  "publish_failed",
  "preview_started",
  "activation_started",
  "activation_succeeded",
  "activation_failed",
] as const;
export type OnboardingEventName = (typeof ONBOARDING_EVENTS)[number];

/** Evento de observabilidad. Sin contenido del borrador ni datos personales: solo ids, revisión, código y duración. */
export interface OnboardingEvent {
  event: OnboardingEventName;
  tenantId: string;
  agentId: string;
  revision?: number;
  code?: string;
  stage?: string;
  publishedVersion?: number;
  durationMs?: number;
}

export interface OnboardingDeps {
  /** De la sesión autenticada. */
  tenantId: string;
  userId?: string;
  drafts: OnboardingDraftStore;
  registry: BusinessAgentRegistryStore;
  publisher: OnboardingPublisher;
  loadFacts(spec: BusinessAgentSpec, gateRules?: GateRule[]): Promise<ReadinessFacts>;
  hasActivePlan(): Promise<boolean>;
  listNumbers(flowId: string): Promise<WhatsAppNumberInfo[]>;
  lifecycle(flowId: string): Promise<AgentLifecycleState | null>;
  activation: {
    evaluate(flowId: string, phoneNumberId: string): Promise<ActivationDecision>;
    bind(flowId: string, phoneNumberId: string): Promise<boolean>;
  };
  /** FASE 8 — matriz de capacidades + motor + readiness (hechos reales). Ausente = no se muestra. */
  engineReport?(flowId: string, input: { publishedSpec: BusinessAgentSpec | null; draftSpec: BusinessAgentSpec | null; agentActive: boolean }): Promise<EngineReport>;
  /** FASE 9 — artefacto activo del modelo de negocio y su vínculo con el registro (deriva de configuración). */
  artifactLink?(flowId: string): Promise<ArtifactLink | null>;
  now?(): Date;
  log?(e: OnboardingEvent): void;
}

const defaultLog = (e: OnboardingEvent) => console.info("[business-agent.onboarding]", JSON.stringify(e));

interface Context {
  flowId: string;
  publishedFlowVersionId: string | null;
  previousSpec: BusinessAgentSpec | null;
  hasPreviousAgent: boolean;
  stored: { draft: OnboardingDraft; revision: number; savedAt: string | null; exists: boolean; corrupt: boolean };
}

async function loadContext(deps: OnboardingDeps): Promise<Context> {
  const identity = await deps.registry.ensureAgentIdentity(deps.tenantId, deps.userId);
  const [versions, stored] = await Promise.all([deps.registry.listVersions(deps.tenantId, identity.flowId), deps.drafts.load(deps.tenantId, identity.flowId)]);
  const latest = versions[0] ? await deps.registry.getVersion(deps.tenantId, versions[0].flowVersionId) : null;
  const previousSpec = latest?.spec ?? null;
  let draft: OnboardingDraft;
  let corrupt = false;
  if (stored) {
    const parsed = parseDraft(stored.draft);
    corrupt = !parsed.ok;
    draft = parsed.ok ? parsed.draft : previousSpec ? draftFromSpec(previousSpec) : emptyDraft();
  } else {
    // Sin borrador: se siembra desde el agente existente (editor avanzado) para no empezar de cero.
    draft = previousSpec ? draftFromSpec(previousSpec) : emptyDraft();
  }
  return {
    flowId: identity.flowId,
    publishedFlowVersionId: identity.publishedVersionId,
    previousSpec,
    hasPreviousAgent: versions.length > 0,
    stored: { draft, revision: stored?.revision ?? 0, savedAt: stored?.updatedAt ?? null, exists: Boolean(stored), corrupt },
  };
}

function readinessIssues(report: ReadinessReport): OnboardingIssue[] {
  return [
    ...report.blockers.map((b) => issue(READINESS_STEP[b.step ?? ""] ?? "oferta", SUPPORT_CODES.READINESS, b.message)),
    ...report.warnings.map((w) => issue(READINESS_STEP[w.step ?? ""] ?? "oferta", SUPPORT_CODES.READINESS, w.message, undefined, "warning")),
  ];
}

function specFor(deps: OnboardingDeps, ctx: Context, assembly: Assembly, draft: OnboardingDraft): BusinessAgentSpec {
  const now = (deps.now?.() ?? new Date()).toISOString();
  return buildRuntimeSpec(assembly.model, draft, ctx.previousSpec, { specVersion: 1, now, authorId: deps.userId });
}

/** Compila el Spec como lo hará la publicación (sin escribir): diagnósticos + reglas del Gate que servirá producción. */
function compileSpec(deps: OnboardingDeps, spec: BusinessAgentSpec): { ok: true; gateRules: GateRule[] } | { ok: false; issues: OnboardingIssue[] } {
  const compiled = compileBusinessAgent(spec, { tenantId: deps.tenantId });
  const failed = () => ({
    ok: false as const,
    issues: [issue("reglas", SUPPORT_CODES.RUNTIME_RULES, "Alguna de tus reglas o datos no se puede aplicar tal como está. Revisa las reglas y los datos que pides al cliente.")],
  });
  if (!compiled.success) {
    console.warn("[business-agent.onboarding] spec_compile_failed", JSON.stringify(compiled.diagnostics.filter((d) => d.severity === "error").map((d) => d.code)));
    return failed();
  }
  const flow = compileIRToFlowDefinition(compiled.ir, { tenantId: deps.tenantId });
  if (!flow.success || !validateFlowForPublish(flow.flow).valid || hasErrors(compiled.diagnostics)) {
    console.warn("[business-agent.onboarding] flow_compile_failed");
    return failed();
  }
  return { ok: true, gateRules: buildGateRules(compiled.ir) };
}

export interface OnboardingOverview {
  draft: OnboardingDraft;
  revision: number;
  savedAt: string | null;
  status: OnboardingStatus;
  pendingChanges: boolean;
  issues: OnboardingIssue[];
  checklist: { items: ChecklistItem[]; readyToActivate: boolean };
  publication: PublicationRecord | null;
  numbers: WhatsAppNumberInfo[];
  facts: Pick<ReadinessFacts, "activeServices" | "activeProducts" | "hasKnowledge" | "calendarConnected"> | null;
  /** El borrador guardado estaba dañado y se reconstruyó desde el agente existente. */
  recovered: boolean;
  /** FASE 8 — matriz de capacidades, motor que atiende (y por qué) y readiness del motor (credenciales sin valores). */
  engine: {
    selected: AgentEngineId;
    source: string;
    /** Motor que la persona eligió para la PRÓXIMA publicación. */
    requested: AgentEngineId;
    capabilities: CapabilityRow[];
    blockers: string[];
    warnings: string[];
    credentials: EngineReadiness["credentials"];
  } | null;
  /** FASE 9 — deriva de configuración (piezas que deberían coincidir y no coinciden). */
  drift: DriftFinding[];
}

/** GET: configuración actual, estado real, problemas y checklist. */
export async function getOnboarding(deps: OnboardingDeps): Promise<OnboardingOverview> {
  const log = deps.log ?? defaultLog;
  const ctx = await loadContext(deps);
  if (!ctx.stored.exists) log({ event: "onboarding_started", tenantId: deps.tenantId, agentId: ctx.flowId });
  const draft = ctx.stored.draft;
  const assembly = assembleDraft(draft);
  const structural = assembly.issues.filter((i) => i.severity === "error");

  let facts: ReadinessFacts | null = null;
  let readiness: ReadinessReport | null = null;
  if (structural.length === 0) {
    const spec = specFor(deps, ctx, assembly, draft);
    facts = await deps.loadFacts(spec).catch(() => null);
    if (facts) readiness = evaluateReadiness(spec, facts);
  }
  const [publication, numbers, plan, lifecycle, artifactLink] = await Promise.all([
    deps.drafts.lastPublication(deps.tenantId, ctx.flowId),
    deps.listNumbers(ctx.flowId),
    deps.hasActivePlan(),
    deps.lifecycle(ctx.flowId).catch(() => null),
    deps.artifactLink ? deps.artifactLink(ctx.flowId).catch(() => null) : Promise.resolve(null),
  ]);
  const st = deriveOnboardingStatus({
    hasDraft: ctx.stored.exists,
    hasPreviousAgent: ctx.hasPreviousAgent,
    draftRevision: ctx.stored.revision,
    structuralErrors: structural.length,
    readinessBlockers: readiness ? readiness.blockers.length : null,
    publication,
    registryPublishedFlowVersionId: ctx.publishedFlowVersionId,
    lifecycle,
  });
  let engine: OnboardingOverview["engine"] = null;
  if (deps.engineReport) {
    try {
      const publishedSpec = ctx.publishedFlowVersionId ? ((await deps.registry.getVersion(deps.tenantId, ctx.publishedFlowVersionId))?.spec ?? null) : null;
      const draftSpec = structural.length === 0 ? specFor(deps, ctx, assembly, draft) : null;
      if (publishedSpec || draftSpec) {
        const r = await deps.engineReport(ctx.flowId, { publishedSpec, draftSpec, agentActive: lifecycle === "ACTIVE" });
        engine = {
          selected: r.engine.engine,
          source: r.engine.source,
          requested: draft.engine ?? publishedSpec?.runtime?.engine ?? "graph_v1",
          capabilities: r.matrix,
          blockers: r.readiness.blockers.map((b) => b.message),
          warnings: r.readiness.warnings.map((w) => w.message),
          credentials: r.readiness.credentials,
        };
      }
    } catch {
      engine = null;
    }
  }
  const checklist = buildChecklist({
    structuralErrors: structural.length,
    readinessBlockers: readiness ? readiness.blockers.length : null,
    firstReadinessMessage: readiness?.blockers[0]?.message,
    publishedUpToDate: st.publishedUpToDate,
    hasActivePlan: plan,
    numbers,
    ...(engine ? { engineBlockers: engine.blockers } : {}),
  });
  const drift = detectConfigurationDrift({
    registryPublishedFlowVersionId: ctx.publishedFlowVersionId,
    publication,
    artifact: artifactLink,
    draftRevision: ctx.stored.revision,
    lifecycle,
    numbers,
  });
  return {
    engine,
    drift,
    draft,
    revision: ctx.stored.revision,
    savedAt: ctx.stored.savedAt,
    status: st.status,
    pendingChanges: st.pendingChanges,
    issues: [...assembly.issues, ...(readiness ? readinessIssues(readiness) : [])],
    checklist,
    publication,
    numbers,
    facts: facts ? { activeServices: facts.activeServices, activeProducts: facts.activeProducts, hasKnowledge: facts.hasKnowledge, calendarConnected: facts.calendarConnected } : null,
    recovered: ctx.stored.corrupt,
  };
}

export type SaveResult =
  | { ok: true; revision: number; issues: OnboardingIssue[] }
  | { ok: false; code: string; reason: "invalid" | "conflict"; message: string; currentRevision?: number; details?: Array<{ path: string; message: string }> };

/** Autosave: guarda el borrador (nunca publica ni activa). Estricto: campos desconocidos o protegidos => rechazo. */
export async function saveOnboardingDraft(deps: OnboardingDeps, input: { expectedRevision: number; draft: unknown }): Promise<SaveResult> {
  const log = deps.log ?? defaultLog;
  const parsed = parseDraft(input.draft);
  if (!parsed.ok) return { ok: false, code: SUPPORT_CODES.DRAFT_INVALID, reason: "invalid", message: "No pudimos guardar: hay datos que no son válidos.", details: parsed.issues };
  const identity = await deps.registry.ensureAgentIdentity(deps.tenantId, deps.userId);
  const r = await deps.drafts.save({ tenantId: deps.tenantId, agentId: identity.flowId, expectedRevision: input.expectedRevision, draft: parsed.draft, userId: deps.userId });
  if (r.outcome === "conflict") {
    return { ok: false, code: SUPPORT_CODES.DRAFT_CONFLICT, reason: "conflict", message: "Esta configuración cambió en otra sesión. Actualiza antes de continuar.", currentRevision: r.revision };
  }
  log({ event: "draft_saved", tenantId: deps.tenantId, agentId: identity.flowId, revision: r.revision });
  return { ok: true, revision: r.revision, issues: assembleDraft(parsed.draft).issues };
}

export interface ValidationReport {
  revision: number;
  valid: boolean;
  issues: OnboardingIssue[];
}

/** Validación COMPLETA del borrador guardado (modelo + Spec compilado + datos reales + reglas en el runtime). */
export async function validateOnboarding(deps: OnboardingDeps): Promise<ValidationReport> {
  const log = deps.log ?? defaultLog;
  const ctx = await loadContext(deps);
  const draft = ctx.stored.draft;
  const assembly = assembleDraft(draft);
  const issues = [...assembly.issues];
  if (!issues.some((i) => i.severity === "error")) {
    const spec = specFor(deps, ctx, assembly, draft);
    const compiled = compileSpec(deps, spec);
    if (!compiled.ok) issues.push(...compiled.issues);
    else issues.push(...readinessIssues(evaluateReadiness(spec, await deps.loadFacts(spec, compiled.gateRules))));
  }
  const valid = !issues.some((i) => i.severity === "error");
  log({ event: valid ? "validation_passed" : "validation_failed", tenantId: deps.tenantId, agentId: ctx.flowId, revision: ctx.stored.revision, ...(valid ? {} : { code: issues.find((i) => i.severity === "error")!.code }) });
  return { revision: ctx.stored.revision, valid, issues };
}

// ---------------------------------------------------------------------------
// Publicación
// ---------------------------------------------------------------------------

export const PUBLISH_STAGES = [
  { id: "review", label: "Revisando la información de tu negocio" },
  { id: "validate", label: "Validando servicios, horarios y reglas" },
  { id: "compile", label: "Preparando lo que tu agente puede hacer" },
  { id: "verify", label: "Verificando tus datos reales y la seguridad" },
  { id: "save", label: "Guardando la nueva versión" },
  { id: "publish", label: "Publicando" },
] as const;
export type PublishStageId = (typeof PUBLISH_STAGES)[number]["id"];

export interface PublishStageEvent {
  stage: PublishStageId;
  status: "running" | "done" | "failed";
}

export type PublishResult =
  | { ok: true; publishedVersion: number; publishedAt: string; revision: number }
  | { ok: false; code: string; stage: PublishStageId; message: string; issues: OnboardingIssue[]; conflict?: boolean };

/**
 * Publica el borrador guardado en la revisión `expectedRevision`. Cada etapa corresponde a una operación real; el
 * puntero de versión activa solo cambia en la última (una transacción). Si algo falla, el borrador queda intacto.
 */
export async function publishOnboarding(deps: OnboardingDeps, input: { expectedRevision: number }, onStage: (e: PublishStageEvent) => void = () => {}): Promise<PublishResult> {
  const log = deps.log ?? defaultLog;
  const started = Date.now();
  let stage: PublishStageId = "review";
  const begin = (s: PublishStageId) => {
    stage = s;
    onStage({ stage: s, status: "running" });
  };
  const done = () => onStage({ stage, status: "done" });
  let flowId = "";
  const fail = (code: string, message: string, issues: OnboardingIssue[] = [], conflict = false): PublishResult => {
    onStage({ stage, status: "failed" });
    log({ event: "publish_failed", tenantId: deps.tenantId, agentId: flowId, revision: input.expectedRevision, code, stage, durationMs: Date.now() - started });
    return { ok: false, code, stage, message, issues, ...(conflict ? { conflict } : {}) };
  };

  try {
    begin("review");
    const ctx = await loadContext(deps);
    flowId = ctx.flowId;
    log({ event: "publish_started", tenantId: deps.tenantId, agentId: flowId, revision: input.expectedRevision });
    if (!ctx.stored.exists || ctx.stored.corrupt) return fail(SUPPORT_CODES.PUBLISH_INVALID, "Guarda tu configuración antes de publicar.");
    if (ctx.stored.revision !== input.expectedRevision) {
      return fail(SUPPORT_CODES.PUBLISH_CONFLICT, "Esta configuración cambió en otra sesión. Actualiza antes de publicar.", [], true);
    }
    const draft = ctx.stored.draft;
    done();

    begin("validate");
    const assembly = assembleDraft(draft);
    const structural = assembly.issues.filter((i) => i.severity === "error");
    if (structural.length > 0 || !assembly.capabilities) return fail(SUPPORT_CODES.PUBLISH_INVALID, "Todavía faltan datos para publicar tu agente.", assembly.issues);
    done();

    begin("compile");
    const nextVersion = (await deps.drafts.latestModelVersion(deps.tenantId, flowId)) + 1;
    const artifactResult = compileBusinessModel(assembly.model, { tenantId: deps.tenantId, agentId: flowId, versionRef: publishedVersionRef(nextVersion), publishedVersion: nextVersion });
    if (!artifactResult.ok) return fail(SUPPORT_CODES.PUBLISH_COMPILE, "No pudimos preparar tu agente con esta configuración.");
    const artifact: CompiledAgentArtifact = artifactResult.artifact;
    const spec = specFor(deps, ctx, assembly, draft);
    const compiled = compileSpec(deps, spec);
    if (!compiled.ok) return fail(SUPPORT_CODES.PUBLISH_COMPILE, "Alguna de tus reglas no se puede aplicar tal como está.", compiled.issues);
    done();

    begin("verify");
    // Datos reales (servicios, calendario, conocimiento) + que cada regla llegue al runtime (manifiesto de políticas).
    const readiness = evaluateReadiness(spec, await deps.loadFacts(spec, compiled.gateRules));
    if (!readiness.ready) return fail(SUPPORT_CODES.PUBLISH_NOT_READY, "Antes de publicar hay que completar algunos datos de tu negocio.", readinessIssues(readiness));
    // Una sola verdad: el Spec que servirá el runtime actual debe comportarse EXACTAMENTE como el modelo publicado.
    const legacy = compileLegacySpec(spec, { tenantId: deps.tenantId, agentId: flowId, versionRef: "projection-check", publishedVersion: null });
    if (!legacy.ok || legacy.artifact.executionFingerprint !== artifact.executionFingerprint) {
      console.error(`[business-agent.onboarding] projection_mismatch tenant=${deps.tenantId}`);
      return fail(SUPPORT_CODES.PUBLISH_PROJECTION, "Hubo un problema al preparar tu agente.");
    }
    done();

    begin("save");
    const specToSave = { ...spec, metadata: { ...spec.metadata, specVersion: nextVersion } };
    const created = await compileAndCreateDraftVersion({ store: deps.registry }, { tenantId: deps.tenantId, spec: specToSave, createdBy: deps.userId });
    if (!created.ok || created.validationStatus !== "validated") return fail(SUPPORT_CODES.PUBLISH_STORE, "Hubo un problema al guardar la nueva versión de tu agente.");
    done();

    begin("publish");
    const published = await deps.publisher.publish({
      tenantId: deps.tenantId,
      agentId: flowId,
      flowVersionId: created.flowVersionId,
      expectedRevision: input.expectedRevision,
      expectedModelVersion: nextVersion - 1,
      model: assembly.model,
      modelChecksum: checksumOf(assembly.model),
      artifact,
    });
    if (published.outcome === "draft_conflict" || published.outcome === "version_conflict") {
      return fail(SUPPORT_CODES.PUBLISH_CONFLICT, "Esta configuración cambió en otra sesión. Actualiza antes de publicar.", [], true);
    }
    if (published.outcome !== "published") return fail(SUPPORT_CODES.PUBLISH_REJECTED_BY_DB, "Hubo un problema al publicar tu agente.");
    done();
    log({ event: "publish_succeeded", tenantId: deps.tenantId, agentId: flowId, revision: input.expectedRevision, publishedVersion: published.publishedVersion, durationMs: Date.now() - started });
    return { ok: true, publishedVersion: published.publishedVersion, publishedAt: (deps.now?.() ?? new Date()).toISOString(), revision: input.expectedRevision };
  } catch (err) {
    console.error(`[business-agent.onboarding] publish_error tenant=${deps.tenantId} stage=${stage}:`, err instanceof Error ? err.message : String(err));
    return fail(SUPPORT_CODES.PUBLISH_STORE, "Hubo un problema al publicar tu agente.");
  }
}

// ---------------------------------------------------------------------------
// Activación
// ---------------------------------------------------------------------------

/** FASE 10 — un bloqueo explicado para el negocio: qué falta, por qué y cómo solucionarlo (y en qué paso). */
export interface ActivationExplanation {
  what: string;
  why: string | null;
  fix: string | null;
  step: OnboardingStep | null;
}

export type ActivateResult =
  | { ok: true; phoneNumberId: string }
  | { ok: false; code: string; message: string; reasons: string[]; blockers: ActivationExplanation[] };

/** Paso del configurador donde se soluciona cada bloqueo (null = no depende de la configuración). */
function stepForBlocker(b: ActivationBlocker): OnboardingStep | null {
  if (b.code === "READINESS_BLOCKED") return READINESS_STEP[b.readinessStep ?? ""] ?? "oferta";
  if (b.code === "ENGINE_NOT_READY" && (b.detailCode === "ENGINE_CAPABILITY_UNSUPPORTED" || !b.detailCode)) return "activar";
  if (b.code === "NOT_PUBLISHED" || b.code === "AGENT_INVALID" || (b.code === "ENGINE_NOT_READY" && b.detailCode === "ARTIFACT_INVALID")) return "activar";
  return null;
}

/** Activa el agente publicado en un número del negocio. Nunca con cambios sin publicar ni sin artefacto publicado. */
export async function activateOnboarding(deps: OnboardingDeps, input: { phoneNumberId: string }): Promise<ActivateResult> {
  const log = deps.log ?? defaultLog;
  const ctx = await loadContext(deps);
  const base = { tenantId: deps.tenantId, agentId: ctx.flowId };
  log({ event: "activation_started", ...base, revision: ctx.stored.revision });
  const failure = (code: string, message: string, blockers: ActivationBlocker[] = []): ActivateResult => {
    log({ event: "activation_failed", ...base, code });
    const explained = blockers.map(explainActivationBlocker);
    return {
      ok: false,
      code,
      message,
      reasons: explained.map((b) => b.message),
      blockers: explained.map((b) => ({ what: b.message, why: b.why ?? null, fix: b.fix ?? null, step: stepForBlocker(b) })),
    };
  };
  const publication = await deps.drafts.lastPublication(deps.tenantId, ctx.flowId);
  if (!publication || publication.flowVersionId !== ctx.publishedFlowVersionId) {
    return failure(SUPPORT_CODES.ACTIVATE_NOT_PUBLISHED, "Publica tu agente antes de activarlo.");
  }
  if (publication.draftRevision !== ctx.stored.revision) {
    return failure(SUPPORT_CODES.ACTIVATE_OUTDATED, "Tienes cambios sin publicar. Publícalos antes de activar para que tu WhatsApp responda con lo que probaste.");
  }
  const decision = await deps.activation.evaluate(ctx.flowId, input.phoneNumberId);
  if (decision.kind === "not_business_agent") return failure(SUPPORT_CODES.ACTIVATE_NOT_PUBLISHED, "Publica tu agente antes de activarlo.");
  if (decision.kind === "blocked") {
    const notFound = decision.blockers.some((b) => b.code === "NUMBER_NOT_FOUND");
    return failure(notFound ? SUPPORT_CODES.ACTIVATE_NUMBER : SUPPORT_CODES.ACTIVATE_BLOCKED, notFound ? "No encontramos ese número en tu cuenta." : "Todavía no se puede activar tu agente.", decision.blockers);
  }
  if (!(await deps.activation.bind(ctx.flowId, input.phoneNumberId))) return failure(SUPPORT_CODES.ACTIVATE_NUMBER, "No encontramos ese número en tu cuenta.");
  log({ event: "activation_succeeded", ...base });
  return { ok: true, phoneNumberId: input.phoneNumberId };
}

// ---------------------------------------------------------------------------
// Simulación (vista previa y "Prueba tu agente") con el borrador GUARDADO
// ---------------------------------------------------------------------------

type DraftArtifact = { ok: true; artifact: CompiledAgentArtifact; gateRules: GateRule[]; draft: OnboardingDraft; revision: number } | { ok: false; code: string; message: string; issues: OnboardingIssue[] };

/** El artefacto del borrador guardado (sin publicar): lo mismo que se publicaría, en memoria. */
async function draftArtifact(deps: OnboardingDeps): Promise<DraftArtifact> {
  const ctx = await loadContext(deps);
  const draft = ctx.stored.draft;
  const assembly = assembleDraft(draft);
  if (assembly.issues.some((i) => i.severity === "error") || !assembly.capabilities) {
    return { ok: false, code: SUPPORT_CODES.SIM_INCOMPLETE, message: "Completa los datos marcados para poder probar tu agente.", issues: assembly.issues };
  }
  const compiled = compileBusinessModel(assembly.model, { tenantId: deps.tenantId, agentId: ctx.flowId, versionRef: `borrador-r${ctx.stored.revision}`, publishedVersion: null });
  if (!compiled.ok) return { ok: false, code: SUPPORT_CODES.SIM_INCOMPLETE, message: "Completa los datos marcados para poder probar tu agente.", issues: [] };
  const spec = specFor(deps, ctx, assembly, draft);
  const rules = compileSpec(deps, spec);
  if (!rules.ok) return { ok: false, code: SUPPORT_CODES.SIM_INCOMPLETE, message: "Alguna de tus reglas no se puede aplicar tal como está.", issues: rules.issues };
  return { ok: true, artifact: compiled.artifact, gateRules: rules.gateRules, draft, revision: ctx.stored.revision };
}

export type PreviewResult =
  | { ok: true; replies: string[]; state: unknown; actions: Array<{ action: string; status: string; simulated: boolean }>; revision: number }
  | { ok: false; code: string; message: string; issues: OnboardingIssue[] };

/** Un turno de la vista previa: el mensaje recorre el agente del borrador en SIMULACIÓN (nada real). */
/** FASE 7 — sin proveedor de IA configurado, la vista previa y las pruebas no se ejecutan (no se finge un resultado). */
export const SIM_UNAVAILABLE_MESSAGE = "La vista previa no está disponible en este momento. Intenta de nuevo en unos minutos.";

export async function previewOnboarding(deps: OnboardingDeps, sim: SimulationDeps, input: { text: string; state: unknown; turnId: string }): Promise<PreviewResult> {
  const log = deps.log ?? defaultLog;
  if (sim.available === false) return { ok: false, code: SUPPORT_CODES.SIM_UNAVAILABLE, message: SIM_UNAVAILABLE_MESSAGE, issues: [] };
  const d = await draftArtifact(deps);
  if (!d.ok) return d;
  if (input.state === null || input.state === undefined) log({ event: "preview_started", tenantId: deps.tenantId, agentId: d.artifact.agentId, revision: d.revision });
  const r = await runSimulationTurn(sim, { artifact: d.artifact, gateRules: d.gateRules, state: input.state, text: input.text, turnId: input.turnId });
  if (!r.ok) {
    return r.code === "STATE_INVALID"
      ? { ok: false, code: SUPPORT_CODES.SIM_STATE, message: "La conversación de prueba se reinició. Escribe de nuevo.", issues: [] }
      : { ok: false, code: SUPPORT_CODES.SIM_UNAVAILABLE, message: SIM_UNAVAILABLE_MESSAGE, issues: [] };
  }
  return { ok: true, replies: r.result.replies, state: r.result.state, actions: r.result.actions, revision: d.revision };
}

export type AgentTestResult = { ok: true; scenarios: ScenarioResult[]; passed: boolean; revision: number } | { ok: false; code: string; message: string; issues: OnboardingIssue[] };

/** "Prueba tu agente": conversaciones de ejemplo contra el borrador, en simulación. */
export async function testOnboardingAgent(deps: OnboardingDeps, sim: SimulationDeps): Promise<AgentTestResult> {
  if (sim.available === false) return { ok: false, code: SUPPORT_CODES.SIM_UNAVAILABLE, message: SIM_UNAVAILABLE_MESSAGE, issues: [] };
  const d = await draftArtifact(deps);
  if (!d.ok) return d;
  const scenarios = await runAgentScenarios({ artifact: d.artifact, gateRules: d.gateRules, draft: d.draft, sim });
  return { ok: true, scenarios, passed: scenarios.every((s) => s.passed), revision: d.revision };
}
