"use client";

import { Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { Field, cn, inputClass } from "@/components/spa-panel/ui";
import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import { describeTriggerConfig } from "@/lib/flow-triggers/describe-trigger";
import type { FlowTrigger } from "@/lib/flow-triggers/types";
import type {
  ActionNodeConfig,
  AiNodeConfig,
  ButtonsNode,
  ConditionNode,
  ConditionOperator,
  ConditionRule,
  EndNode,
  FlowDefinition,
  FlowNode,
  HumanNode,
  MessageNode,
  QuestionNode,
  QuestionValidation,
  QuestionValidationKind,
  SaveDataMapping,
  SaveDataNode,
  StartNode,
} from "@/lib/flow/types";
import { errorsForPath, type NodeFieldError } from "@/lib/flow-builder/validate-node-edit";
import { orphanHandles } from "@/lib/flow-builder/connection-rules";
import type { FlowValidationError } from "@/lib/flow/errors";

const TYPE_LABEL: Record<FlowNode["type"], string> = {
  start: "Inicio",
  message: "Mensaje",
  question: "Pregunta",
  buttons: "Botones",
  condition: "Condición",
  ai: "IA",
  save_data: "Guardar datos",
  action: "Acción",
  human: "Humano",
  end: "Final",
};

const ASSERTION_CAPABILITIES = [
  "appointment.reserved",
  "appointment.available",
  "payment.completed",
  "lead.created",
  "support.transferred",
] as const;

const QUESTION_VALIDATION_KINDS: QuestionValidationKind[] = ["text", "number", "email", "phone", "regex", "hora_colombia"];

const CONDITION_OPERATORS: ConditionOperator[] = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "exists",
  "not_exists",
];

type OnConfigChange = (config: FlowNode["config"]) => void;

function csvOrUndefined(value: string): string[] | undefined {
  const list = value.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

function ErrorText({ errors }: { errors: NodeFieldError[] }) {
  if (errors.length === 0) return null;
  return <p className="mt-1 text-[11px] text-danger-text">{errors.map((e) => e.message).join(" · ")}</p>;
}

function ReadOnlyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-mist">{label}</p>
      <p className="whitespace-pre-wrap break-words rounded-[10px] border border-edge/60 bg-ink/60 px-3 py-2 text-xs text-mist">
        {value || "—"}
      </p>
      {hint && <p className="mt-1 text-[11px] text-mist">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editores por tipo -- SOLO propiedades reales del schema. Un campo queda
// de solo lectura cuando su valor determina el sourceHandle de un edge
// (button.id, ai.mode, ai.classifications, action.actionType): editarlo
// desincronizaría edges que esta etapa explícitamente no toca.
// ---------------------------------------------------------------------------

function StartEditor({ node, onChange }: { node: StartNode; onChange: OnConfigChange }) {
  return (
    <>
      <Field label="Trigger">
        <select
          className={inputClass}
          value={node.config.triggerType}
          onChange={(e) => onChange({ ...node.config, triggerType: e.target.value as StartNode["config"]["triggerType"] })}
        >
          <option value="first_message">first_message</option>
          <option value="keyword">keyword</option>
          <option value="campaign_reply">campaign_reply</option>
          <option value="manual">manual</option>
        </select>
      </Field>
      <Field label="Palabras clave (separadas por coma)">
        <input
          className={inputClass}
          value={node.config.keywords?.join(", ") ?? ""}
          onChange={(e) => onChange({ ...node.config, keywords: csvOrUndefined(e.target.value) })}
        />
      </Field>
    </>
  );
}

function MessageEditor({ node, onChange, errors }: { node: MessageNode; onChange: OnConfigChange; errors: NodeFieldError[] }) {
  const role = node.config.messageRole ?? "informational";
  return (
    <>
      <Field label="Texto">
        <textarea
          className={cn(inputClass, "min-h-24 resize-y")}
          value={node.config.text ?? ""}
          onChange={(e) => onChange({ ...node.config, text: e.target.value })}
        />
      </Field>
      <ErrorText errors={errorsForPath(errors, "config.text")} />
      <ErrorText errors={errorsForPath(errors, "config")} />
      <Field label="Rol">
        <select
          className={inputClass}
          value={role}
          onChange={(e) => onChange({ ...node.config, messageRole: e.target.value as MessageNode["config"]["messageRole"] })}
        >
          <option value="informational">informational</option>
          <option value="intent_offer">intent_offer</option>
          <option value="external_assertion">external_assertion</option>
        </select>
      </Field>
      {role === "external_assertion" && (
        <Field label="Afirma (capabilities)">
          <div className="flex flex-col gap-1.5">
            {ASSERTION_CAPABILITIES.map((cap) => (
              <label key={cap} className="flex items-center gap-1.5 text-xs text-fg">
                <input
                  type="checkbox"
                  className="accent-lime"
                  checked={node.config.asserts?.includes(cap) ?? false}
                  onChange={(e) => {
                    const current = node.config.asserts ?? [];
                    const next = e.target.checked ? [...current, cap] : current.filter((c) => c !== cap);
                    onChange({ ...node.config, asserts: next.length ? next : undefined });
                  }}
                />
                {cap}
              </label>
            ))}
          </div>
        </Field>
      )}
      <ErrorText errors={errorsForPath(errors, "config.asserts")} />
    </>
  );
}

function QuestionEditor({ node, onChange, errors }: { node: QuestionNode; onChange: OnConfigChange; errors: NodeFieldError[] }) {
  const validation = node.config.validation;
  return (
    <>
      <Field label="Texto">
        <input className={inputClass} value={node.config.text} onChange={(e) => onChange({ ...node.config, text: e.target.value })} />
      </Field>
      <ErrorText errors={errorsForPath(errors, "config.text")} />
      <Field label="Variable">
        <input
          className={inputClass}
          value={node.config.variableKey}
          onChange={(e) => onChange({ ...node.config, variableKey: e.target.value })}
        />
      </Field>
      <label className="flex items-center gap-1.5 text-xs text-fg">
        <input
          type="checkbox"
          className="accent-lime"
          checked={node.config.required}
          onChange={(e) => onChange({ ...node.config, required: e.target.checked })}
        />
        Requerida
      </label>
      <Field label="Validación">
        <select
          className={inputClass}
          value={validation.kind}
          onChange={(e) => {
            const kind = e.target.value as QuestionValidationKind;
            const next: QuestionValidation =
              kind === "regex" ? { kind: "regex", pattern: validation.kind === "regex" ? validation.pattern : "", flags: validation.kind === "regex" ? validation.flags : undefined } : { kind };
            onChange({ ...node.config, validation: next });
          }}
        >
          {QUESTION_VALIDATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </Field>
      {validation.kind === "regex" && (
        <>
          <Field label="Patrón">
            <input
              className={inputClass}
              value={validation.pattern}
              onChange={(e) => onChange({ ...node.config, validation: { kind: "regex", pattern: e.target.value, flags: validation.flags } })}
            />
          </Field>
          <ErrorText errors={errorsForPath(errors, "config.validation.pattern")} />
          <Field label="Flags (opcional)">
            <input
              className={inputClass}
              value={validation.flags ?? ""}
              onChange={(e) => onChange({ ...node.config, validation: { kind: "regex", pattern: validation.pattern, flags: e.target.value || undefined } })}
            />
          </Field>
        </>
      )}
    </>
  );
}

function ButtonsEditor({ node, onChange, errors }: { node: ButtonsNode; onChange: OnConfigChange; errors: NodeFieldError[] }) {
  return (
    <>
      <Field label="Texto">
        <textarea
          className={cn(inputClass, "min-h-20 resize-y")}
          value={node.config.text}
          onChange={(e) => onChange({ ...node.config, text: e.target.value })}
        />
      </Field>
      <ErrorText errors={errorsForPath(errors, "config.text")} />
      <Field label="Variable (opcional)">
        <input
          className={inputClass}
          value={node.config.variableKey ?? ""}
          onChange={(e) => onChange({ ...node.config, variableKey: e.target.value || undefined })}
        />
      </Field>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist">Botones</p>
        <div className="flex flex-col gap-2">
          {node.config.buttons.map((btn, i) => (
            <div key={i} className="rounded-[10px] border border-edge bg-ink px-3 py-2">
              <Field label="Label">
                <input
                  className={cn(inputClass, "mb-1.5")}
                  value={btn.label}
                  onChange={(e) => {
                    const next = node.config.buttons.map((b, j) => (j === i ? { ...b, label: e.target.value } : b));
                    onChange({ ...node.config, buttons: next });
                  }}
                />
              </Field>
              <Field label="ID">
                <input
                  className={cn(inputClass, "font-mono text-xs")}
                  value={btn.id}
                  onChange={(e) => {
                    const next = node.config.buttons.map((b, j) => (j === i ? { ...b, id: e.target.value } : b));
                    onChange({ ...node.config, buttons: next });
                  }}
                />
              </Field>
              <p className="mt-1 font-mono text-[10px] text-mist">handle: {FLOW_EDGE_HANDLE.button(btn.id)}</p>
              <ErrorText errors={errorsForPath(errors, `config.buttons.${i}`)} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-mist">
          Cambiar el id de un botón no mueve ni borra el edge <code>button:&#123;id anterior&#125;</code> -- ese edge queda
          temporalmente sin handle visible en el canvas hasta que lo reconectes en Etapa 3. Agregar o quitar botones sigue
          siendo una etapa posterior.
        </p>
      </div>
    </>
  );
}

function ConditionEditor({ node, onChange, errors }: { node: ConditionNode; onChange: OnConfigChange; errors: NodeFieldError[] }) {
  function updateRule(index: number, rule: ConditionRule) {
    const next = node.config.rules.map((r, j) => (j === index ? rule : r));
    onChange({ ...node.config, rules: next });
  }

  return (
    <>
      <Field label="Coincidencia">
        <select
          className={inputClass}
          value={node.config.match}
          onChange={(e) => onChange({ ...node.config, match: e.target.value as ConditionNode["config"]["match"] })}
        >
          <option value="all">all</option>
          <option value="any">any</option>
        </select>
      </Field>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist">Reglas</p>
        <div className="flex flex-col gap-2">
          {node.config.rules.map((rule, i) => {
            const needsValue = rule.operator !== "exists" && rule.operator !== "not_exists";
            return (
              <div key={i} className="flex flex-col gap-1.5 rounded-[10px] border border-edge bg-ink px-3 py-2">
                <input className={inputClass} placeholder="campo" value={rule.field} onChange={(e) => updateRule(i, { ...rule, field: e.target.value })} />
                <select
                  className={inputClass}
                  value={rule.operator}
                  onChange={(e) => updateRule(i, { ...rule, operator: e.target.value as ConditionOperator })}
                >
                  {CONDITION_OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                {needsValue && (
                  <input
                    className={inputClass}
                    placeholder="valor"
                    value={String(rule.value ?? "")}
                    onChange={(e) => updateRule(i, { ...rule, value: e.target.value })}
                  />
                )}
                <ErrorText errors={errorsForPath(errors, `config.rules.${i}`)} />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function AiEditor({ node, onChange, errors }: { node: FlowNode & { type: "ai" }; onChange: OnConfigChange; errors: NodeFieldError[] }) {
  return (
    <>
      <Field
        label="Modo"
        hint="Cambiarlo no toca los edges existentes -- si el nodo ya tenía edges para el modo anterior (ej. success/failure), pueden quedar sin handle visible en el canvas hasta que los reconectes en Etapa 3."
      >
        <select
          className={inputClass}
          value={node.config.mode}
          onChange={(e) => onChange({ ...node.config, mode: e.target.value as AiNodeConfig["mode"] } satisfies AiNodeConfig)}
        >
          <option value="classify">classify</option>
          <option value="extract">extract</option>
          <option value="respond">respond</option>
          <option value="hybrid">hybrid</option>
          <option value="propose_action">propose_action</option>
        </select>
      </Field>
      <Field label="Instrucción">
        <textarea
          className={cn(inputClass, "min-h-28 resize-y")}
          value={node.config.instruction}
          onChange={(e) => onChange({ ...node.config, instruction: e.target.value } satisfies AiNodeConfig)}
        />
      </Field>
      <ErrorText errors={errorsForPath(errors, "config.instruction")} />
      <Field label="Agent ID (opcional)">
        <input
          className={inputClass}
          value={node.config.agentId ?? ""}
          onChange={(e) => onChange({ ...node.config, agentId: e.target.value || undefined } satisfies AiNodeConfig)}
        />
      </Field>
      <Field
        label="Variables de salida (separadas por coma)"
        hint={node.config.mode === "extract" || node.config.mode === "hybrid" ? "Relevante en modo extract/hybrid." : undefined}
      >
        <input
          className={inputClass}
          value={node.config.outputVariables?.join(", ") ?? ""}
          onChange={(e) => onChange({ ...node.config, outputVariables: csvOrUndefined(e.target.value) } satisfies AiNodeConfig)}
        />
      </Field>
      <Field label="Herramientas permitidas (separadas por coma)">
        <input
          className={inputClass}
          value={node.config.allowedTools?.join(", ") ?? ""}
          onChange={(e) => onChange({ ...node.config, allowedTools: csvOrUndefined(e.target.value) } satisfies AiNodeConfig)}
        />
      </Field>
      {node.config.mode === "classify" && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist">Clasificaciones</p>
          <div className="flex flex-col gap-2">
            {(node.config.classifications ?? []).map((value, i) => (
              <div key={i} className="rounded-[10px] border border-edge bg-ink px-3 py-2">
                <input
                  className={cn(inputClass, "font-mono text-xs")}
                  value={value}
                  onChange={(e) => {
                    const next = (node.config.classifications ?? []).map((c, j) => (j === i ? e.target.value : c));
                    onChange({ ...node.config, classifications: next } satisfies AiNodeConfig);
                  }}
                />
                <p className="mt-1 font-mono text-[10px] text-mist">handle: {FLOW_EDGE_HANDLE.aiClass(value)}</p>
                <ErrorText errors={errorsForPath(errors, `config.classifications.${i}`)} />
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-mist">
            Cambiar el valor de una clasificación no mueve ni borra el edge <code>class:&#123;valor anterior&#125;</code> -- ese
            edge queda temporalmente sin handle visible en el canvas hasta que lo reconectes en Etapa 3. Agregar o quitar
            clasificaciones sigue siendo una etapa posterior.
          </p>
        </div>
      )}
    </>
  );
}

function SaveDataEditor({ node, onChange }: { node: SaveDataNode; onChange: OnConfigChange }) {
  function updateMapping(index: number, mapping: SaveDataMapping) {
    const next = node.config.mappings.map((m, j) => (j === index ? mapping : m));
    onChange({ mappings: next });
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist">Mapeos</p>
      <div className="flex flex-col gap-2">
        {node.config.mappings.map((m, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-[10px] border border-edge bg-ink px-3 py-2">
            <input className={inputClass} placeholder="variable" value={m.variable} onChange={(e) => updateMapping(i, { ...m, variable: e.target.value })} />
            <select className={inputClass} value={m.target} onChange={(e) => updateMapping(i, { ...m, target: e.target.value as SaveDataMapping["target"] })}>
              <option value="lead">lead</option>
              <option value="custom_field">custom_field</option>
              <option value="webhook_body">webhook_body</option>
            </select>
            {m.target === "custom_field" && (
              <input
                className={inputClass}
                placeholder="targetKey"
                value={m.targetKey ?? ""}
                onChange={(e) => updateMapping(i, { ...m, targetKey: e.target.value })}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionEditor({ node, onChange }: { node: FlowNode & { type: "action" }; onChange: OnConfigChange }) {
  const config = node.config;
  return (
    <>
      <ReadOnlyField label="Tipo de acción" value={config.actionType} hint="No editable en esta etapa." />
      {"semanticTag" in config && (
        <Field label="Tag semántico (opcional)">
          <input
            className={inputClass}
            value={config.semanticTag ?? ""}
            onChange={(e) => onChange({ ...config, semanticTag: e.target.value || undefined } as ActionNodeConfig)}
          />
        </Field>
      )}
      {config.actionType === "webhook_http" && (
        <>
          <Field label="URL">
            <input className={inputClass} value={config.url} onChange={(e) => onChange({ ...config, url: e.target.value })} />
          </Field>
          <Field label="Método">
            <select
              className={inputClass}
              value={config.method ?? "POST"}
              onChange={(e) => onChange({ ...config, method: e.target.value as "GET" | "POST" | "PUT" | "PATCH" })}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
            </select>
          </Field>
        </>
      )}
      {config.actionType === "enviar_plantilla" && (
        <Field label="Nombre de plantilla">
          <input className={inputClass} value={config.templateName} onChange={(e) => onChange({ ...config, templateName: e.target.value })} />
        </Field>
      )}
      {config.actionType === "etiquetar_conversacion" && (
        <Field label="Tag ID">
          <input className={inputClass} value={config.tagId} onChange={(e) => onChange({ ...config, tagId: e.target.value })} />
        </Field>
      )}
      {config.actionType === "asignar_miembro" && (
        <Field label="Member ID">
          <input className={inputClass} value={config.memberId} onChange={(e) => onChange({ ...config, memberId: e.target.value })} />
        </Field>
      )}
      {config.actionType === "transferir_soporte" && (
        <Field label="Pausa (horas)">
          <input
            type="number"
            className={inputClass}
            value={config.pauseDurationHours ?? ""}
            onChange={(e) => onChange({ ...config, pauseDurationHours: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Field>
      )}
      {"params" in config && config.params && Object.keys(config.params).length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist">Parámetros</p>
          <div className="flex flex-col gap-2">
            {Object.entries(config.params).map(([key, value]) => (
              <Field key={key} label={key}>
                <input
                  className={inputClass}
                  value={value}
                  onChange={(e) => onChange({ ...config, params: { ...config.params, [key]: e.target.value } })}
                />
              </Field>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function HumanEditor({ node, onChange }: { node: HumanNode; onChange: OnConfigChange }) {
  return (
    <>
      <Field label="Mensaje (opcional)">
        <textarea
          className={cn(inputClass, "min-h-20 resize-y")}
          value={node.config.message ?? ""}
          onChange={(e) => onChange({ ...node.config, message: e.target.value || undefined })}
        />
      </Field>
      <Field label="Pausa (horas)">
        <input
          type="number"
          className={inputClass}
          value={node.config.pauseDurationHours}
          onChange={(e) => onChange({ ...node.config, pauseDurationHours: Number(e.target.value) })}
        />
      </Field>
      <Field label="Asignar a (opcional)">
        <input
          className={inputClass}
          value={node.config.assignTo ?? ""}
          onChange={(e) => onChange({ ...node.config, assignTo: e.target.value || undefined })}
        />
      </Field>
    </>
  );
}

function EndEditor({ node, onChange }: { node: EndNode; onChange: OnConfigChange }) {
  return (
    <>
      <Field label="Mensaje (opcional)">
        <textarea
          className={cn(inputClass, "min-h-16 resize-y")}
          value={node.config.message ?? ""}
          onChange={(e) => onChange({ ...node.config, message: e.target.value || undefined })}
        />
      </Field>
      <Field label="Tags (separados por coma)">
        <input
          className={inputClass}
          value={node.config.tags?.join(", ") ?? ""}
          onChange={(e) => onChange({ ...node.config, tags: csvOrUndefined(e.target.value) })}
        />
      </Field>
    </>
  );
}

/**
 * Etapa 3 (Flow Builder, autorizado) — ayuda visual: salidas que el nodo
 * declara (sourceHandlesForNode, vía connection-rules.orphanHandles) pero
 * que todavía no tienen ningún edge. No es una validación nueva -- la
 * oficial sigue siendo la del servidor (BUTTON_MISSING_EDGE/
 * CONDITION_MISSING_BRANCH/AI_MISSING_BRANCH en validate-graph.ts); esto
 * solo hace visible en el Builder lo que ese validador reportaría al
 * publicar.
 */
function OrphanHandlesNotice({ node, flow }: { node: FlowNode; flow: FlowDefinition }) {
  const missing = orphanHandles(node, flow);
  if (missing.length === 0) return null;
  return (
    <div className="rounded-[10px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
      Sin conexión: {missing.map((h) => h.label).join(", ")}. El validador del servidor lo bloqueará al publicar mientras
      falte.
    </div>
  );
}

/**
 * Etapa 4 (Flow Builder, autorizado) — errores del validador de SERVIDOR
 * (POST /api/flows/[id]/validate) para el nodo seleccionado, ya filtrados
 * por el caller vía errorsForNode() (lib/flow-builder/validation-markers.ts).
 * Deliberadamente en un bloque SEPARADO de `errors` (los locales/schema de
 * validateNodeEdit, ya vistos por campo dentro de ConfigEditor): son dos
 * validadores distintos, con ciclos de vida distintos (uno instantáneo y
 * local, el otro requiere ida y vuelta a la API) -- nunca se mezclan.
 */
function ServerErrorsNotice({ errors }: { errors: FlowValidationError[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="rounded-[10px] border border-red-500/40 bg-red-500/10 p-3">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-danger-text">
        Errores del validador ({errors.length})
      </p>
      <ul className="space-y-1">
        {errors.map((e, i) => (
          <li key={i} className="text-[11px] leading-relaxed text-danger-text">
            {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Fase 3 (Triggers + Event Routing, autorizado) — reemplaza el viejo
 * resumen estático "trigger: manual" del nodo Inicio por la lista REAL de
 * triggers configurados (tabla dulabs_flow_triggers, ver lib/flow/flow-store.ts).
 * Deliberadamente NO gestiona su propio fetch -- `triggers` y los callbacks
 * vienen del padre ([id]/page.tsx, que ya tiene flowId/session), igual que
 * el resto de este panel nunca mantiene estado propio de red. StartEditor
 * (arriba) sigue intacto: StartNodeConfig.triggerType/keywords son un campo
 * del schema de FlowDefinition que NO se toca ni se reemplaza -- este es un
 * mecanismo nuevo y aparte, no una migración de aquel.
 */
function TriggersSection({
  triggers,
  onAdd,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  triggers: FlowTrigger[] | null;
  onAdd: () => void;
  onEdit: (trigger: FlowTrigger) => void;
  onDelete: (trigger: FlowTrigger) => void;
  onToggleEnabled: (trigger: FlowTrigger) => void;
}) {
  const activos = triggers?.filter((t) => t.enabled).length ?? 0;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-mist">
          Triggers{triggers ? ` (${activos} activo${activos === 1 ? "" : "s"})` : ""}
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 rounded-lg border border-edge px-2 py-1 text-[11px] font-medium text-fg hover:bg-ink-2"
        >
          <Plus className="size-3" /> Agregar trigger
        </button>
      </div>
      {triggers === null ? (
        <p className="text-xs text-mist">Cargando triggers…</p>
      ) : triggers.length === 0 ? (
        <p className="text-xs leading-relaxed text-mist">
          Sin triggers configurados todavía. Sin al menos uno activo, este Flow nunca se activará automáticamente para un
          evento entrante.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {triggers.map((trigger) => (
            <div
              key={trigger.id}
              className={cn(
                "flex items-center justify-between gap-2 rounded-[10px] border px-3 py-2",
                trigger.enabled ? "border-edge bg-ink" : "border-edge/50 bg-ink/40 opacity-60",
              )}
            >
              <button type="button" onClick={() => onEdit(trigger)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-xs text-fg">{describeTriggerConfig(trigger.config)}</p>
                <p className="text-[10px] text-mist">
                  prioridad {trigger.priority}
                  {!trigger.enabled ? " · inactivo" : ""}
                </p>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onToggleEnabled(trigger)}
                  className="rounded p-1 text-mist hover:bg-ink-2 hover:text-fg"
                  title={trigger.enabled ? "Desactivar" : "Activar"}
                >
                  {trigger.enabled ? <ToggleRight className="size-4 text-lime-text" /> : <ToggleLeft className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(trigger)}
                  className="rounded p-1 text-mist hover:bg-red-500/10 hover:text-red-400"
                  title="Eliminar"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigEditor({ node, onChange, errors }: { node: FlowNode; onChange: OnConfigChange; errors: NodeFieldError[] }) {
  switch (node.type) {
    case "start":
      return <StartEditor node={node} onChange={onChange} />;
    case "message":
      return <MessageEditor node={node} onChange={onChange} errors={errors} />;
    case "question":
      return <QuestionEditor node={node} onChange={onChange} errors={errors} />;
    case "buttons":
      return <ButtonsEditor node={node} onChange={onChange} errors={errors} />;
    case "condition":
      return <ConditionEditor node={node} onChange={onChange} errors={errors} />;
    case "ai":
      return <AiEditor node={node} onChange={onChange} errors={errors} />;
    case "save_data":
      return <SaveDataEditor node={node} onChange={onChange} />;
    case "action":
      return <ActionEditor node={node} onChange={onChange} />;
    case "human":
      return <HumanEditor node={node} onChange={onChange} />;
    case "end":
      return <EndEditor node={node} onChange={onChange} />;
  }
}

/**
 * Etapa 2 (Flow Builder, autorizado) — panel derecho, ahora EDITOR. Cada
 * cambio construye un FlowNode["config"] completo y lo sube vía onConfigChange
 * -- FlowDefinition sigue siendo la única fuente de verdad, este panel nunca
 * mantiene su propio estado paralelo de nodos.
 */
export function FlowInfoPanel({
  node,
  flow,
  errors,
  serverErrors,
  onLabelChange,
  onConfigChange,
  triggers,
  onAddTrigger,
  onEditTrigger,
  onDeleteTrigger,
  onToggleTriggerEnabled,
}: {
  node: FlowNode | null;
  /** Necesario solo para OrphanHandlesNotice (qué edges salientes ya existen). */
  flow: FlowDefinition | null;
  errors: NodeFieldError[];
  /** Errores del validador de servidor YA filtrados para este nodo (ver errorsForNode) -- [] mientras no haya validación vigente. */
  serverErrors: FlowValidationError[];
  onLabelChange: (label: string) => void;
  onConfigChange: OnConfigChange;
  /** Fase 3 -- triggers del Flow completo (no solo del nodo seleccionado), null mientras cargan. Solo se muestran cuando el nodo seleccionado es "start". */
  triggers: FlowTrigger[] | null;
  onAddTrigger: () => void;
  onEditTrigger: (trigger: FlowTrigger) => void;
  onDeleteTrigger: (trigger: FlowTrigger) => void;
  onToggleTriggerEnabled: (trigger: FlowTrigger) => void;
}) {
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-edge bg-card p-4">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-widest text-mist">Propiedades</p>
      {!node || !flow ? (
        <p className="text-xs leading-relaxed text-mist">Selecciona un nodo para editarlo.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold text-fg">{TYPE_LABEL[node.type]}</p>
            <p className="font-mono text-[11px] text-mist">ID: {node.id}</p>
          </div>
          <Field label="Etiqueta">
            <input
              className={inputClass}
              value={node.label ?? ""}
              placeholder="(sin etiqueta)"
              onChange={(e) => onLabelChange(e.target.value)}
            />
          </Field>
          <ServerErrorsNotice errors={serverErrors} />
          <OrphanHandlesNotice node={node} flow={flow} />
          {node.type === "start" && (
            <TriggersSection
              triggers={triggers}
              onAdd={onAddTrigger}
              onEdit={onEditTrigger}
              onDelete={onDeleteTrigger}
              onToggleEnabled={onToggleTriggerEnabled}
            />
          )}
          <ConfigEditor node={node} onChange={onConfigChange} errors={errors} />
        </div>
      )}
    </aside>
  );
}
