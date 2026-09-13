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
  FlowMediaRef,
  FlowMediaType,
  FlowNode,
  HumanNode,
  MessageNode,
  QuestionNode,
  QuestionValidation,
  QuestionValidationKind,
  SaveDataMapping,
  SaveDataNode,
  StartNode,
  VariableDefinition,
} from "@/lib/flow/types";
import { errorsForPath, type NodeFieldError } from "@/lib/flow-builder/validate-node-edit";
import { orphanHandles } from "@/lib/flow-builder/connection-rules";
import type { FlowValidationError } from "@/lib/flow/errors";
import { SAAS_ACTION_TYPES, type SaasActionType } from "@/lib/flow/action-capabilities";
import type { FlowIntegrationRow } from "@/lib/flow/flow-store-types";
import type { AgenteResumen } from "@/lib/flow-builder/agentes-client";

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

// FASE F8.4 (WhatsApp Media, autorizado) -- los 5 tipos reales que Meta
// Cloud API acepta en outbound (ver lib/flow/types.ts::FlowMediaType).
const MEDIA_TYPE_LABEL: Record<FlowMediaType, string> = {
  image: "Imagen",
  video: "Video",
  audio: "Audio",
  document: "Documento",
  sticker: "Sticker",
};
const MEDIA_TYPES_CON_CAPTION = new Set<FlowMediaType>(["image", "video", "document"]);

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

// FASE F8.4 (WhatsApp Media, autorizado) -- editor de FlowMediaRef dentro de
// un nodo "message" (único nodo cuyo config es FlowMessageContent completo
// -- ver flow-engine.ts, "case message" hace `content: {...node.config}`).
// Fuente mutuamente excluyente (URL pública que Meta descarga por su
// cuenta, o un mediaId ya subido) -- mismo criterio que
// flowMediaRefSchema.superRefine (lib/flow/schemas.ts): exactamente uno de
// los dos, nunca ambos.
function MediaEditor({
  media,
  onChange,
  errors,
  allowedTypes,
  label = "Media adjunta",
}: {
  media: FlowMediaRef;
  onChange: (media: FlowMediaRef | undefined) => void;
  errors: NodeFieldError[];
  /** FASE F8.4 (autorizado) -- restringe el selector de tipo (ej. nodo "buttons": Meta solo admite header de imagen). Default: los 5 tipos. */
  allowedTypes?: FlowMediaType[];
  label?: string;
}) {
  const fuente: "url" | "mediaId" = media.mediaId ? "mediaId" : "url";
  const soportaCaption = MEDIA_TYPES_CON_CAPTION.has(media.type);
  const tipos = allowedTypes ?? (Object.keys(MEDIA_TYPE_LABEL) as FlowMediaType[]);
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-edge/60 bg-ink/40 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-mist">{label}</p>
        <button
          type="button"
          className="text-[11px] text-danger-text hover:underline"
          onClick={() => onChange(undefined)}
        >
          Quitar
        </button>
      </div>
      {tipos.length > 1 && (
        <Field label="Tipo">
          <select
            className={inputClass}
            value={media.type}
            onChange={(e) => {
              const type = e.target.value as FlowMediaType;
              onChange({
                ...media,
                type,
                caption: MEDIA_TYPES_CON_CAPTION.has(type) ? media.caption : undefined,
                filename: type === "document" ? media.filename : undefined,
              });
            }}
          >
            {tipos.map((t) => (
              <option key={t} value={t}>
                {MEDIA_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
      )}
      <ErrorText errors={errorsForPath(errors, "config.media.type")} />
      <Field label="Origen">
        <select
          className={inputClass}
          value={fuente}
          onChange={(e) => {
            if (e.target.value === "url") onChange({ ...media, url: media.url ?? "", mediaId: undefined });
            else onChange({ ...media, mediaId: media.mediaId ?? "", url: undefined });
          }}
        >
          <option value="url">URL pública</option>
          <option value="mediaId">Media ID (ya subido a Meta)</option>
        </select>
      </Field>
      {fuente === "url" ? (
        <>
          <Field label="URL (https://...)">
            <input
              className={inputClass}
              value={media.url ?? ""}
              placeholder="https://..."
              onChange={(e) => onChange({ ...media, url: e.target.value, mediaId: undefined })}
            />
          </Field>
          <ErrorText errors={errorsForPath(errors, "config.media.url")} />
        </>
      ) : (
        <>
          <Field label="Media ID">
            <input
              className={inputClass}
              value={media.mediaId ?? ""}
              onChange={(e) => onChange({ ...media, mediaId: e.target.value, url: undefined })}
            />
          </Field>
          <ErrorText errors={errorsForPath(errors, "config.media.mediaId")} />
        </>
      )}
      {soportaCaption && (
        <>
          <Field label="Caption (opcional)">
            <input className={inputClass} value={media.caption ?? ""} onChange={(e) => onChange({ ...media, caption: e.target.value || undefined })} />
          </Field>
          <ErrorText errors={errorsForPath(errors, "config.media.caption")} />
        </>
      )}
      {media.type === "document" && (
        <>
          <Field label="Nombre de archivo (opcional)">
            <input
              className={inputClass}
              value={media.filename ?? ""}
              placeholder="factura.pdf"
              onChange={(e) => onChange({ ...media, filename: e.target.value || undefined })}
            />
          </Field>
          <ErrorText errors={errorsForPath(errors, "config.media.filename")} />
        </>
      )}
      <ErrorText errors={errorsForPath(errors, "config.media")} />
    </div>
  );
}

function MessageEditor({ node, onChange, errors }: { node: MessageNode; onChange: OnConfigChange; errors: NodeFieldError[] }) {
  const role = node.config.messageRole ?? "informational";
  const media = node.config.media;
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
      {media ? (
        <MediaEditor
          media={media}
          onChange={(next) => onChange({ ...node.config, media: next })}
          errors={errors}
        />
      ) : (
        <button
          type="button"
          className="self-start rounded-[10px] border border-edge/60 px-3 py-1.5 text-[11px] font-medium text-fg hover:bg-ink/40"
          onClick={() => onChange({ ...node.config, media: { type: "image", url: "" } })}
        >
          + Adjuntar media
        </button>
      )}
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
      {/* FASE F8.4 (WhatsApp Media, autorizado) -- solo imagen: es el único
          header de media que Meta admite en un mensaje interactivo de
          botones (ver flowNodeSchema/SendMessageExecutor). */}
      {node.config.media ? (
        <MediaEditor
          media={node.config.media}
          onChange={(next) => onChange({ ...node.config, media: next })}
          errors={errors}
          allowedTypes={["image"]}
          label="Imagen del encabezado"
        />
      ) : (
        <button
          type="button"
          className="self-start rounded-[10px] border border-edge/60 px-3 py-1.5 text-[11px] font-medium text-fg hover:bg-ink/40"
          onClick={() => onChange({ ...node.config, media: { type: "image", url: "" } })}
        >
          + Agregar imagen al encabezado
        </button>
      )}
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

/** Fase 6 (IA configurable, autorizado) -- display-only, nunca editable: el modelo real lo decide el servidor (ver lib/flow/claude/anthropic-client.ts / lib/flow/gemini/gemini-client.ts). Un string duplicado acá es intencional para no importar esos módulos (SDKs) al bundle del cliente. */
const AI_PROVIDER_MODEL_LABEL: Record<"claude" | "gemini", string> = {
  claude: "claude-sonnet-5",
  gemini: "gemini-3.6-flash",
};

function AiEditor({
  node,
  onChange,
  errors,
  agentes,
  flowVariables,
}: {
  node: FlowNode & { type: "ai" };
  onChange: OnConfigChange;
  errors: NodeFieldError[];
  /** Fase 6 (IA configurable, autorizado) -- agentes del tenant, de GET /api/dashboard/agentes (ya existente). */
  agentes: { id: number; nombre: string; prompt_sistema: string | null; base_conocimiento_nombre_archivo: string | null }[];
  /** Fase 6 (IA configurable, autorizado) -- variables declaradas del Flow, solo informativo (ya llegan TODAS automáticamente al contexto de la IA). */
  flowVariables: { key: string; label: string }[];
}) {
  const agenteSeleccionado = node.config.agentId ? agentes.find((a) => String(a.id) === node.config.agentId) : undefined;
  const provider = node.config.provider ?? "claude";

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

      <Field label="Proveedor de IA" hint="Si no eliges ninguno, se usa Claude -- el mismo comportamiento de siempre.">
        <select
          className={inputClass}
          value={provider}
          onChange={(e) => onChange({ ...node.config, provider: e.target.value as AiNodeConfig["provider"] } satisfies AiNodeConfig)}
        >
          <option value="claude">Claude (Anthropic)</option>
          <option value="gemini">Gemini (Google)</option>
        </select>
      </Field>
      <ReadOnlyField label="Modelo" value={AI_PROVIDER_MODEL_LABEL[provider]} hint="El modelo exacto lo fija el servidor -- no es un valor libre." />

      <Field label="Agente" hint="Reutiliza un agente ya configurado en Ajustes → Agentes de IA (prompt del sistema + conocimiento). Opcional.">
        <select
          className={inputClass}
          value={node.config.agentId ?? ""}
          onChange={(e) => onChange({ ...node.config, agentId: e.target.value || undefined } satisfies AiNodeConfig)}
        >
          <option value="">(ninguno -- solo la instrucción de este nodo)</option>
          {agentes.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.nombre}
            </option>
          ))}
        </select>
      </Field>
      {agenteSeleccionado && (
        <div className="rounded-lg border border-edge bg-ink p-3 text-xs text-mist">
          <p className="mb-1 font-semibold text-fg">Agente seleccionado: {agenteSeleccionado.nombre}</p>
          {agenteSeleccionado.prompt_sistema ? (
            <p className="mb-1 line-clamp-3 whitespace-pre-wrap">{agenteSeleccionado.prompt_sistema}</p>
          ) : (
            <p className="mb-1 italic">Sin prompt de sistema configurado.</p>
          )}
          <p>
            Conocimiento disponible:{" "}
            {agenteSeleccionado.base_conocimiento_nombre_archivo ? `sí (${agenteSeleccionado.base_conocimiento_nombre_archivo})` : "no"}
          </p>
        </div>
      )}

      <Field label="Instrucción">
        <textarea
          className={cn(inputClass, "min-h-28 resize-y")}
          value={node.config.instruction}
          onChange={(e) => onChange({ ...node.config, instruction: e.target.value } satisfies AiNodeConfig)}
          placeholder="Ej: Eres un asistente amable y directo. Tu objetivo es resolver la duda del cliente en pocas frases. Si no sabes la respuesta, dilo con honestidad y ofrece transferir con un humano."
        />
      </Field>
      <p className="-mt-2 text-[11px] leading-relaxed text-mist/70">
        Personalidad, tono y objetivo se escriben aquí, en texto libre -- no hay campos separados para eso.
      </p>
      <ErrorText errors={errorsForPath(errors, "config.instruction")} />

      {flowVariables.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-mist">Variables de entrada disponibles</p>
          <p className="mb-1.5 text-[11px] text-mist/70">Ya llegan automáticamente a la IA -- no hace falta configurarlas.</p>
          <div className="flex flex-wrap gap-1.5">
            {flowVariables.map((v) => (
              <span key={v.key} className="rounded-full bg-ink px-2 py-0.5 font-mono text-[10.5px] text-mist">
                {v.key}
              </span>
            ))}
          </div>
        </div>
      )}

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

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist">
          Contexto para la IA (FASE F7.3)
        </p>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-xs text-mist">
            <input
              type="checkbox"
              checked={node.config.contextConfig?.includeVariables ?? true}
              onChange={(e) =>
                onChange({
                  ...node.config,
                  contextConfig: { ...node.config.contextConfig, includeVariables: e.target.checked },
                } satisfies AiNodeConfig)
              }
            />
            Variables del Flow (activado por defecto)
          </label>
          <label className="flex items-center gap-2 text-xs text-mist">
            <input
              type="checkbox"
              checked={node.config.contextConfig?.includeContactFields ?? false}
              onChange={(e) =>
                onChange({
                  ...node.config,
                  contextConfig: { ...node.config.contextConfig, includeContactFields: e.target.checked },
                } satisfies AiNodeConfig)
              }
            />
            Datos del contacto (custom_fields guardados)
          </label>
          <label className="flex items-center gap-2 text-xs text-mist">
            <input
              type="checkbox"
              checked={node.config.contextConfig?.includeContactTags ?? false}
              onChange={(e) =>
                onChange({
                  ...node.config,
                  contextConfig: { ...node.config.contextConfig, includeContactTags: e.target.checked },
                } satisfies AiNodeConfig)
              }
            />
            Tags ya asignadas a esta conversación
          </label>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-mist/70">
          Solo del contacto de ESTA conversación -- nunca de otro contacto ni de otro tenant. Se le pasa a la IA como
          dato, no como instrucción.
        </p>
      </div>

      <div className="rounded-lg border border-edge bg-ink p-3 text-[11px] leading-relaxed text-mist">
        <p className="mb-1 font-semibold text-fg">Fallback (cuando la IA no sabe qué responder)</p>
        <p>
          Usa modo <span className="font-mono">classify</span> con una clasificación tipo{" "}
          <span className="font-mono">no_se</span>/<span className="font-mono">otro</span>, y conecta ese handle a un
          nodo que ofrezca ayuda alternativa o transferencia a humano. En modo <span className="font-mono">respond</span>,
          basta con indicarlo en la Instrucción (ej. &quot;si no sabes la respuesta, dilo con honestidad&quot;).
        </p>
      </div>

      <div className="rounded-lg border border-edge bg-ink p-3 text-[11px] leading-relaxed text-mist">
        <p className="mb-1 font-semibold text-fg">Transferencia a humano</p>
        <p>
          Agrega <span className="font-mono">transferir_soporte</span> en &quot;Herramientas permitidas&quot; abajo, y
          conecta este nodo (rama de éxito) a un nodo Acción con ese tipo (o a un nodo Humano). La IA solo puede
          proponer transferir si esa conexión ya existe en el Flow -- nunca lo hace por su cuenta.
        </p>
      </div>

      <Field
        label="Herramientas permitidas (separadas por coma)"
        hint="FASE F7.3: incluye 'get_contact' para que la IA pueda consultar el contacto actual, o 'etiquetar_conversacion' para agregar/quitar una tag -- en ambos casos, conecta este nodo (rama de éxito) a un nodo Acción de ese tipo, igual que con transferir_soporte."
      >
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

const SAAS_ACTION_LABEL: Record<SaasActionType, string> = {
  webhook_http: "HTTP Request / Integración externa",
  enviar_plantilla: "Enviar plantilla de WhatsApp",
  etiquetar_conversacion: "Etiquetar conversación",
  asignar_miembro: "Asignar a miembro del equipo",
  transferir_soporte: "Transferir a humano",
  crear_lead_enterprise: "Crear lead (empresarial)",
  crear_lead_campana: "Crear lead (campaña)",
  // FASE F7.3 (Contacto + Tags + IA, autorizado).
  get_contact: "Consultar contacto (tool de IA)",
};

/** Config por defecto al CAMBIAR a este actionType desde el selector -- Fase 5 (autorizado). */
function defaultConfigForSaasActionType(actionType: SaasActionType): ActionNodeConfig {
  switch (actionType) {
    case "webhook_http":
      return { actionType, url: "", method: "POST", integrationId: undefined };
    case "enviar_plantilla":
      return { actionType, templateName: "" };
    case "etiquetar_conversacion":
      return { actionType, tagId: "" };
    case "asignar_miembro":
      return { actionType, memberId: "" };
    case "transferir_soporte":
      return { actionType, pauseDurationHours: 1 };
    case "crear_lead_enterprise":
    case "crear_lead_campana":
    case "get_contact":
      return { actionType };
  }
}

/** Fase 5 (Actions + Integrations, autorizado) -- lista simple de nombres de variable, agregar/quitar. */
function OutputVariablesEditor({ config, onChange }: { config: ActionNodeConfig; onChange: OnConfigChange }) {
  const values = config.outputVariables ?? [];
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist">
        Variables de salida <span className="font-normal normal-case text-mist/70">(vacío = usa todo el resultado)</span>
      </p>
      <div className="flex flex-col gap-1.5">
        {values.map((name, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange({ ...config, outputVariables: next } as ActionNodeConfig);
              }}
            />
            <button
              type="button"
              onClick={() => onChange({ ...config, outputVariables: values.filter((_, j) => j !== i) } as ActionNodeConfig)}
              className="shrink-0 rounded p-1 text-mist hover:bg-red-500/10 hover:text-red-400"
              title="Quitar"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange({ ...config, outputVariables: [...values, ""] } as ActionNodeConfig)}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-lime-text hover:opacity-80"
      >
        <Plus className="size-3.5" /> Agregar variable
      </button>
    </div>
  );
}

function ActionEditor({
  node,
  onChange,
  integrations,
}: {
  node: FlowNode & { type: "action" };
  onChange: OnConfigChange;
  /** Fase 5 (Actions + Integrations, autorizado) -- integraciones del tenant (todas, no solo aprobadas: se muestra el estado). */
  integrations: FlowIntegrationRow[];
}) {
  const config = node.config;
  const isSaasType = SAAS_ACTION_TYPES.includes(config.actionType as SaasActionType);
  const selectedIntegration = "integrationId" in config ? integrations.find((i) => i.id === config.integrationId) : undefined;

  return (
    <>
      <Field label="Tipo de acción">
        <select
          className={inputClass}
          value={config.actionType}
          onChange={(e) => onChange(defaultConfigForSaasActionType(e.target.value as SaasActionType))}
        >
          {!isSaasType && (
            <option value={config.actionType} disabled>
              {config.actionType} (tipo interno, no seleccionable como nuevo)
            </option>
          )}
          {SAAS_ACTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {SAAS_ACTION_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>
      {config.actionType === "webhook_http" && (
        <>
          <Field label="Integración">
            <select
              className={inputClass}
              value={config.integrationId ?? ""}
              onChange={(e) => {
                const integ = integrations.find((i) => i.id === e.target.value);
                onChange({
                  ...config,
                  integrationId: e.target.value || undefined,
                  semanticTag: integ?.capability,
                  url: integ?.url ?? config.url,
                  method: (integ?.http_method as "GET" | "POST" | "PUT" | "PATCH" | undefined) ?? config.method,
                } as ActionNodeConfig);
              }}
            >
              <option value="">(ninguna seleccionada)</option>
              {integrations.map((integ) => (
                <option key={integ.id} value={integ.id}>
                  {integ.display_name} {integ.status !== "approved" ? `(${integ.status})` : ""}
                </option>
              ))}
            </select>
          </Field>
          {config.integrationId && selectedIntegration?.status !== "approved" && (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-400">
              Esta integración todavía no está aprobada -- la Action fallará hasta que se apruebe.
            </p>
          )}
          <ReadOnlyField label="URL (de la integración)" value={config.url || "(elige una integración)"} />
          <ReadOnlyField label="Método (de la integración)" value={config.method ?? "POST"} />
        </>
      )}
      {config.actionType === "enviar_plantilla" && (
        <Field label="Nombre de plantilla">
          <input className={inputClass} value={config.templateName} onChange={(e) => onChange({ ...config, templateName: e.target.value })} />
        </Field>
      )}
      {config.actionType === "etiquetar_conversacion" && (
        <Field
          label="Tag ID"
          hint="Déjalo vacío para que la IA elija la etiqueta por nombre en tiempo de ejecución (propose_action con argumento tagName) -- requiere que el nodo AI de origen tenga 'etiquetar_conversacion' en Herramientas permitidas."
        >
          <input
            className={inputClass}
            value={config.tagId ?? ""}
            onChange={(e) => onChange({ ...config, tagId: e.target.value || undefined })}
          />
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
      {config.actionType === "webhook_http" && <OutputVariablesEditor config={config} onChange={onChange} />}
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

function ConfigEditor({
  node,
  onChange,
  errors,
  integrations,
  agentes,
  flowVariables,
}: {
  node: FlowNode;
  onChange: OnConfigChange;
  errors: NodeFieldError[];
  integrations: FlowIntegrationRow[];
  /** Fase 6 (IA configurable, autorizado). */
  agentes: AgenteResumen[];
  flowVariables: VariableDefinition[];
}) {
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
      return <AiEditor node={node} onChange={onChange} errors={errors} agentes={agentes} flowVariables={flowVariables} />;
    case "save_data":
      return <SaveDataEditor node={node} onChange={onChange} />;
    case "action":
      return <ActionEditor node={node} onChange={onChange} integrations={integrations} />;
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
  integrations,
  agentes,
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
  /** Fase 5 (Actions + Integrations, autorizado) -- integraciones del tenant, para el selector de Action HTTP. */
  integrations: FlowIntegrationRow[];
  /** Fase 6 (IA configurable, autorizado) -- agentes del tenant (GET /api/dashboard/agentes), para el selector del nodo IA. */
  agentes: AgenteResumen[];
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
          <ConfigEditor
            node={node}
            onChange={onConfigChange}
            errors={errors}
            integrations={integrations}
            agentes={agentes}
            flowVariables={flow.variables}
          />
        </div>
      )}
    </aside>
  );
}
