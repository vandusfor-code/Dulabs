"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ClipboardPaste, Copy, Files, Maximize, Pencil, Plus, Trash2 } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import {
  applyEdit,
  createBuilderState,
  discardChanges,
  isValidationStale,
  loadDefinitionForEdit,
  markSaved,
  markValidated,
  restoreFromHistory,
  type BuilderState,
} from "@/lib/flow-builder/builder-state";
import { applyCanvasPositions, flowDefinitionToCanvas } from "@/lib/flow-builder/canvas-adapter";
import { allOrphanHandles, isValidConnection as isValidConnectionForFlow } from "@/lib/flow-builder/connection-rules";
import { copySelection, duplicateSelection, pasteIntoFlow, type ClipboardPayload } from "@/lib/flow-builder/clipboard";
import { addEdge, addNode, deleteEdges, deleteNodes, updateNodeConfig, updateNodeLabel } from "@/lib/flow-builder/edit-flow";
import { canRedo as historyCanRedo, canUndo as historyCanUndo, createHistory, pushHistory, redo as historyRedo, resetHistory, undo as historyUndo, type EditHistory } from "@/lib/flow-builder/history";
import { useFlowKeyboardShortcuts } from "@/lib/flow-builder/keyboard-shortcuts";
import { ensureInitialVersion } from "@/lib/flow-builder/create-flow";
import { buildFlowLoadResult, findNodeById, type FlowLoadResult } from "@/lib/flow-builder/load-flow";
import { createTrigger, deleteTrigger, listTriggers, updateTrigger } from "@/lib/flow-builder/triggers";
import { createDefaultNode, generateEdgeId } from "@/lib/flow-builder/node-factory";
import { canPublishFlow, canPublishNow, canSaveFlow, canValidateFlow, publishDisabledReason } from "@/lib/flow-builder/permissions";
import { fetchFlowVersions, publishFlowVersion } from "@/lib/flow-builder/publish-flow";
import { saveFlowVersion, validateFlowDefinition } from "@/lib/flow-builder/save-flow";
import { searchNodes } from "@/lib/flow-builder/search-nodes";
import { validateNodeEdit } from "@/lib/flow-builder/validate-node-edit";
import { errorsForNode, globalErrors } from "@/lib/flow-builder/validation-markers";
import { hasNewerDraftThanPublished } from "@/lib/flow-builder/version-history";
import { describeTriggerConfig } from "@/lib/flow-triggers/describe-trigger";
import type { FlowTrigger } from "@/lib/flow-triggers/types";
import type { FlowValidationError } from "@/lib/flow/errors";
import type { FlowRow, FlowVersionRow } from "@/lib/flow/flow-store-types";
import type { FlowDefinition, FlowEdge, FlowNode, FlowNodeType, NodePosition } from "@/lib/flow/types";
import { FlowCanvas, type FlowCanvasHandle } from "@/components/dashboard/flows/FlowCanvas";
import { FlowContextMenu, type FlowContextMenuState } from "@/components/dashboard/flows/FlowContextMenu";
import { FlowInfoPanel } from "@/components/dashboard/flows/FlowInfoPanel";
import { FlowNodePalette } from "@/components/dashboard/flows/FlowNodePalette";
import { FlowQuickAddMenu } from "@/components/dashboard/flows/FlowQuickAddMenu";
import { FlowSearchBar } from "@/components/dashboard/flows/FlowSearchBar";
import { FlowStateScreen, type FlowStateScreenKind } from "@/components/dashboard/flows/FlowStateScreen";
import { FlowTopbar, type PublishStatus, type SaveStatus, type ValidationStatus } from "@/components/dashboard/flows/FlowTopbar";
import { FlowValidationPanel } from "@/components/dashboard/flows/FlowValidationPanel";
import { FlowVersionHistory } from "@/components/dashboard/flows/FlowVersionHistory";
import { TriggerModal, type TriggerModalSubmit } from "@/components/dashboard/flows/TriggerModal";

interface Selection {
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
}

const EMPTY_SELECTION: Selection = { nodeIds: new Set(), edgeIds: new Set() };

function sameIds(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id));
}

/**
 * Etapa 2 (Flow Builder, autorizado) — el canvas de Etapa 1 más edición
 * LOCAL de propiedades de nodo. FlowDefinition (dentro de BuilderState) es
 * la única fuente de verdad; React Flow solo la representa
 * (flowDefinitionToCanvas). Nada de esto llama a la API para guardar --
 * sigue cargando exactamente igual que Etapa 1 (GET /api/flows/[id] +
 * GET /api/flows/[id]/versions), y todo lo que el usuario edite vive
 * únicamente en el estado de este componente hasta que se recarga la página.
 *
 * Professional Flow Editor UX (autorizado) — agrega historial de edición
 * (undo/redo), selección múltiple, copiar/pegar/duplicar, atajos de
 * teclado, menú contextual, agregar nodo rápido, buscador y un panel de
 * validación ampliado (errores + advertencias). BuilderState y
 * FlowDefinition NO cambian de forma -- `editorState` es un envoltorio que
 * las mantiene a AMBAS (builder + historial) en un solo setState atómico,
 * para que un undo/redo nunca pueda quedar desincronizado del resto del
 * estado del editor. El historial es puramente local (lib/flow-builder/
 * history.ts): nunca depende de guardar una versión en el backend.
 */
export default function FlowBuilderPage() {
  const params = useParams();
  const flowId = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");
  const { session, rol } = useDashboard();

  const [result, setResult] = useState<FlowLoadResult | { kind: "loading" }>({ kind: "loading" });
  const [editorState, setEditorState] = useState<{ builder: BuilderState; history: EditHistory<FlowDefinition> } | null>(null);
  const builderState = editorState?.builder ?? null;
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);

  // --- Professional Editor UX (autorizado) — clipboard interno, menús, buscador, minimapa ---
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);
  const [contextMenu, setContextMenu] = useState<FlowContextMenuState | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ x: number; y: number; flowPosition: NodePosition } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [minimapVisible, setMinimapVisible] = useState(true);
  const canvasRef = useRef<FlowCanvasHandle>(null);

  // --- Etapa 4 (autorizado): Guardar y Validar -----------------------------
  // Dos ejes de estado INDEPENDIENTES (decisión aprobada #3): saving/validating
  // nunca se bloquean entre sí, cada botón se deshabilita únicamente por su
  // propia operación en curso. *RequestError es SOLO para fallos de la
  // petición en sí (red/401/403/500) -- nunca se usa para un resultado de
  // validación con errores de contenido, eso vive en builderState.lastValidation.
  const [saving, setSaving] = useState(false);
  const [saveRequestError, setSaveRequestError] = useState<string | null>(null);
  // Decisión aprobada #4: "Guardado" se queda hasta el próximo edit, sin
  // timers -- justSaved se pone en true al guardar y se limpia en edit().
  const [justSaved, setJustSaved] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationRequestError, setValidationRequestError] = useState<string | null>(null);

  // --- Etapa 5 (autorizado): Publicar + Historial + Restaurar ---------------
  // `publishedFlow` es el FlowRow actualizado tras un publish exitoso dentro
  // de esta sesión (status/published_version_id) -- null hasta el primer
  // publish, momento en el que reemplaza a `result.flow` (que quedó fijo
  // desde la carga inicial) para que "qué versión está publicada" se vea
  // correcta SIN recargar la página. `allVersions` es el historial completo
  // (ya se pedía en la carga inicial vía GET /versions -- Etapa 1 -- ahora
  // también se reutiliza para el banner de "borrador más reciente" y se
  // mantiene al día localmente tras cada Guardar, sin pedirlo de nuevo).
  const [publishedFlow, setPublishedFlow] = useState<FlowRow | null>(null);
  const [allVersions, setAllVersions] = useState<FlowVersionRow[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishRequestError, setPublishRequestError] = useState<string | null>(null);
  const [justPublished, setJustPublished] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !flowId) return;
    let cancelled = false;

    async function cargar() {
      const headers = { Authorization: `Bearer ${session!.access_token}` };
      const [flowRes, versionsRes] = await Promise.all([
        fetch(`/api/flows/${flowId}`, { headers }),
        fetch(`/api/flows/${flowId}/versions`, { headers }),
      ]);
      const [flowJson, versionsJson] = await Promise.all([
        flowRes.json().catch(() => ({})) as Promise<{ flow?: FlowRow; error?: string }>,
        versionsRes.json().catch(() => ({})) as Promise<{ versions?: FlowVersionRow[]; error?: string }>,
      ]);

      if (cancelled) return;
      const loadResult = buildFlowLoadResult(
        { ok: flowRes.ok, status: flowRes.status, json: flowJson },
        { ok: versionsRes.ok, status: versionsRes.status, json: versionsJson },
      );
      setResult(loadResult);
      if (loadResult.kind === "loaded") {
        const definition = loadResult.version.definition_json as unknown as FlowDefinition;
        setEditorState({ builder: createBuilderState(definition), history: createHistory(definition) });
      } else {
        setEditorState(null);
      }
      setSelection(EMPTY_SELECTION);
      setClipboard(null);
      setPublishedFlow(null);
      setAllVersions(loadResult.kind === "loaded" ? (versionsJson.versions ?? []) : []);
      setPublishing(false);
      setPublishRequestError(null);
      setJustPublished(false);
      setVersionsOpen(false);
      setVersionsError(null);
    }

    cargar().catch((err) => {
      if (!cancelled) {
        setResult({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        setEditorState(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [session, flowId]);

  // --- Flow sin versión (autorizado): auto-reparación -----------------------
  // Recuperación para un Flow que existe pero no tiene ninguna versión (ver
  // FlowLoadResult "no_versions" en load-flow.ts) -- ya sea porque quedó así
  // de antes de este fix, o porque el paso automático de POST /api/flows
  // falló a mitad de camino. Solo quien puede guardar (admin, mismo rol que
  // ya exige el backend en /initial-version) dispara el intento, y solo UNA
  // vez automáticamente (bootstrapAttemptedRef) -- reintentos siguientes son
  // manuales (botón "Reintentar" de FlowStateScreen), nunca un loop. Como ya
  // se tiene `result.flow` y la version que devuelve el endpoint trae la
  // definición completa, no hace falta volver a pedir nada: se arma
  // "loaded" directamente, sin una segunda ronda de fetch.
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const bootstrapAttemptedRef = useRef(false);

  const intentarPrepararFlow = useCallback(async () => {
    if (!session || result.kind !== "no_versions") return;
    const flowSinVersion = result.flow;
    setBootstrapError(null);
    const res = await ensureInitialVersion({ flowId, accessToken: session.access_token });
    if (res.ok) {
      const definition = res.version.definition_json as unknown as FlowDefinition;
      setResult({ kind: "loaded", flow: flowSinVersion, version: res.version });
      setEditorState({ builder: createBuilderState(definition), history: createHistory(definition) });
      setAllVersions([res.version]);
    } else {
      setBootstrapError(res.error.message);
    }
  }, [session, flowId, result]);

  useEffect(() => {
    if (result.kind !== "no_versions") {
      bootstrapAttemptedRef.current = false;
      return;
    }
    if (rol !== "admin" || bootstrapAttemptedRef.current) return;
    bootstrapAttemptedRef.current = true;
    void intentarPrepararFlow();
  }, [result, rol, intentarPrepararFlow]);

  // Advierte antes de cerrar/recargar la pestaña si hay cambios locales sin
  // guardar -- no hay forma de interceptar la navegación interna de Next sin
  // una librería adicional, así que esto cubre el caso "razonablemente
  // posible": cerrar o recargar la pestaña.
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (!builderState?.isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [builderState?.isDirty]);

  const definition = builderState?.definition ?? null;

  const canvas = useMemo(() => {
    if (!definition) return null;
    return flowDefinitionToCanvas(definition);
  }, [definition]);

  // --- Fase 3 (Triggers + Event Routing, autorizado) ------------------------
  // Estado y CRUD de triggers del Flow. Deliberadamente SEPARADO de
  // FlowDefinition/BuilderState -- un trigger es una fila real en
  // dulabs_flow_triggers (ver lib/flow/flow-store.ts), nunca parte del
  // grafo, nunca pasa por edit()/applyEdit ni afecta isDirty/Guardar.
  const [triggers, setTriggers] = useState<FlowTrigger[] | null>(null);
  const [triggerModal, setTriggerModal] = useState<{ mode: "create" } | { mode: "edit"; trigger: FlowTrigger } | null>(null);
  const [triggerSaving, setTriggerSaving] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || result.kind !== "loaded") return;
    let cancelled = false;
    listTriggers({ flowId, accessToken: session.access_token }).then((res) => {
      if (cancelled) return;
      setTriggers(res.ok ? res.triggers : []);
    });
    return () => {
      cancelled = true;
    };
  }, [session, flowId, result.kind]);

  function handleAddTrigger() {
    setTriggerError(null);
    setTriggerModal({ mode: "create" });
  }

  function handleEditTrigger(trigger: FlowTrigger) {
    setTriggerError(null);
    setTriggerModal({ mode: "edit", trigger });
  }

  async function handleDeleteTrigger(trigger: FlowTrigger) {
    if (!session) return;
    const confirmado = window.confirm(`¿Eliminar este trigger?\n\n${describeTriggerConfig(trigger.config)}`);
    if (!confirmado) return;
    const result = await deleteTrigger({ flowId, triggerId: trigger.id, accessToken: session.access_token });
    if (result.ok) setTriggers((prev) => prev?.filter((t) => t.id !== trigger.id) ?? prev);
  }

  async function handleToggleTriggerEnabled(trigger: FlowTrigger) {
    if (!session) return;
    const result = await updateTrigger({ flowId, triggerId: trigger.id, enabled: !trigger.enabled, accessToken: session.access_token });
    if (result.ok) setTriggers((prev) => prev?.map((t) => (t.id === trigger.id ? result.trigger : t)) ?? prev);
  }

  async function handleSubmitTrigger(input: TriggerModalSubmit) {
    if (!session || !triggerModal) return;
    setTriggerSaving(true);
    setTriggerError(null);
    const result =
      triggerModal.mode === "create"
        ? await createTrigger({ flowId, config: input.config, priority: input.priority, enabled: input.enabled, accessToken: session.access_token })
        : await updateTrigger({
            flowId,
            triggerId: triggerModal.trigger.id,
            config: input.config,
            priority: input.priority,
            enabled: input.enabled,
            accessToken: session.access_token,
          });
    setTriggerSaving(false);
    if (result.ok) {
      setTriggers((prev) => {
        if (!prev) return [result.trigger];
        const existe = prev.some((t) => t.id === result.trigger.id);
        return existe ? prev.map((t) => (t.id === result.trigger.id ? result.trigger : t)) : [...prev, result.trigger];
      });
      setTriggerModal(null);
    } else {
      setTriggerError(result.error.message);
    }
  }

  // El nodo Inicio en el CANVAS muestra el resumen de triggers REALES (no
  // el viejo StartNodeConfig.triggerType) -- flowDefinitionToCanvas
  // (canvas-adapter.ts) es puro y no sabe de triggers, así que esto es un
  // post-procesamiento deliberado, solo sobre el nodo start, para no
  // enseñarle async a esa función pura ni a FlowCanvas.tsx.
  const canvasConTriggers = useMemo(() => {
    if (!canvas || !definition) return canvas;
    const startNode = definition.nodes.find((n) => n.type === "start");
    if (!startNode || triggers === null) return canvas;
    const activos = triggers.filter((t) => t.enabled);
    const summary =
      activos.length === 0
        ? "Sin triggers activos"
        : `${activos.length} trigger${activos.length === 1 ? "" : "s"} activo${activos.length === 1 ? "" : "s"}: ${activos
            .slice(0, 2)
            .map((t) => describeTriggerConfig(t.config))
            .join(" · ")}${activos.length > 2 ? "…" : ""}`;
    return {
      ...canvas,
      nodes: canvas.nodes.map((n) => (n.id === startNode.id ? { ...n, data: { ...n.data, summary } } : n)),
    };
  }, [canvas, definition, triggers]);

  // Un solo nodo/edge seleccionado (y nada más) es lo único que FlowInfoPanel
  // sabe editar -- selección múltiple simplemente no muestra nada en el
  // panel (no existe edición de propiedades en lote, no se pidió).
  const selectedNodeId = selection.nodeIds.size === 1 && selection.edgeIds.size === 0 ? [...selection.nodeIds][0]! : null;
  const selectedNode: FlowNode | null = definition ? findNodeById(definition, selectedNodeId) : null;
  const errors = useMemo(() => (selectedNode ? validateNodeEdit(selectedNode) : []), [selectedNode]);

  // --- Etapa 4 (autorizado): errores del validador de SERVIDOR -------------
  // Vigentes SOLO si lastValidation no quedó stale (isValidationStale, por
  // REFERENCIA de definition -- ver builder-state.ts). Si están obsoletos,
  // se tratan como si no existiera ninguna validación: nunca se muestra un
  // resultado/marca vieja como si fuera del estado actual (decisión
  // aprobada #5). NO se reimplementa ninguna regla -- son exactamente los
  // errors[] que devolvió POST /validate, sin reinterpretar.
  const validationErrors: FlowValidationError[] = useMemo(
    () => (builderState && !isValidationStale(builderState) ? builderState.lastValidation!.result.errors : []),
    [builderState],
  );
  const nodeIdsWithErrors = useMemo(() => new Set(validationErrors.filter((e) => e.nodeId).map((e) => e.nodeId!)), [validationErrors]);
  const edgeIdsWithErrors = useMemo(() => new Set(validationErrors.filter((e) => e.edgeId).map((e) => e.edgeId!)), [validationErrors]);
  const globalValidationErrors = useMemo(() => globalErrors(validationErrors), [validationErrors]);
  const nodeAndEdgeErrors = useMemo(() => validationErrors.filter((e) => e.nodeId || e.edgeId), [validationErrors]);
  const serverErrorsForSelectedNode = useMemo(
    () => (selectedNodeId ? errorsForNode(validationErrors, selectedNodeId) : []),
    [validationErrors, selectedNodeId],
  );
  // Professional Editor UX (autorizado) -- advertencias estructurales del
  // propio Builder (handles sin conectar), NUNCA bloquean publicar, distintas
  // de validationErrors (servidor). Ver allOrphanHandles en connection-rules.ts.
  const orphanWarnings = useMemo(() => (definition ? allOrphanHandles(definition) : []), [definition]);
  const nodeLabelById = (nodeId: string) => (definition ? (findNodeById(definition, nodeId)?.label ?? nodeId) : nodeId);

  // Professional Editor UX (autorizado) -- resultados de búsqueda en vivo.
  const searchResults = useMemo(() => (definition ? searchNodes(definition, searchQuery) : []), [definition, searchQuery]);

  /**
   * Único punto de mutación de FlowDefinition (sin cambios de contrato). Ahora
   * también empuja al historial LOCAL de undo/redo -- ambos (builder +
   * history) se actualizan en la MISMA transición de estado para que nunca
   * puedan desincronizarse. `group` permite fusionar ediciones continuas
   * (escribir letra por letra en un campo) en un solo paso de undo -- ver
   * lib/flow-builder/history.ts. `null` (default) = paso discreto siempre.
   */
  function edit(updater: (flow: FlowDefinition) => FlowDefinition, group: string | null = null) {
    setEditorState((prev) => {
      if (!prev) return prev;
      const nextBuilder = applyEdit(prev.builder, updater);
      const nextHistory = pushHistory(prev.history, nextBuilder.definition, group);
      return { builder: nextBuilder, history: nextHistory };
    });
    // Cualquier edición hace obsoleto el resultado de guardado/validación
    // mostrado -- "Guardado" se queda hasta el próximo edit (decisión
    // aprobada #4), y un error de la ÚLTIMA petición (red/401/403) tampoco
    // debe seguir mostrándose indefinidamente una vez la clienta ya siguió
    // editando. La vigencia del RESULTADO de validación (válido/N errores)
    // ya se resuelve aparte, por referencia, vía isValidationStale.
    setJustSaved(false);
    setSaveRequestError(null);
    setValidationRequestError(null);
    // Etapa 5 (autorizado): mismo criterio -- "Publicado" y su error de red
    // no deben seguir mostrándose indefinidamente una vez la clienta ya
    // volvió a editar (publicar en sí NO se invalida, pero el PILL de "recién
    // publicado" sí deja de tener sentido mostrarse tras un cambio nuevo).
    setJustPublished(false);
    setPublishRequestError(null);
  }

  function handleDiscard() {
    setEditorState((prev) => (prev ? { builder: discardChanges(prev.builder), history: resetHistory(prev.builder.original) } : prev));
    setSelection(EMPTY_SELECTION);
    setJustSaved(false);
    setSaveRequestError(null);
    setJustPublished(false);
    setPublishRequestError(null);
  }

  // --- Professional Editor UX (autorizado): Undo/Redo -----------------------
  // Puramente local (lib/flow-builder/history.ts) -- nunca toca la API, nunca
  // depende de una versión guardada. Deshacer hasta la referencia ORIGINAL
  // exacta hace que isDirty vuelva a false (restoreFromHistory, distinto de
  // Restaurar/loadDefinitionForEdit) -- ver builder-state.ts.
  function handleUndo() {
    setEditorState((prev) => {
      if (!prev) return prev;
      const nextHistory = historyUndo(prev.history);
      if (nextHistory === prev.history) return prev;
      return { builder: restoreFromHistory(prev.builder, nextHistory.present), history: nextHistory };
    });
    setJustSaved(false);
    setSaveRequestError(null);
    setValidationRequestError(null);
    setJustPublished(false);
    setPublishRequestError(null);
  }

  function handleRedo() {
    setEditorState((prev) => {
      if (!prev) return prev;
      const nextHistory = historyRedo(prev.history);
      if (nextHistory === prev.history) return prev;
      return { builder: restoreFromHistory(prev.builder, nextHistory.present), history: nextHistory };
    });
    setJustSaved(false);
    setSaveRequestError(null);
    setValidationRequestError(null);
    setJustPublished(false);
    setPublishRequestError(null);
  }

  // Guardar y Validar son acciones independientes (decisión aprobada #1):
  // cada una solo revisa/toca su propio flag de "en curso", nunca el del
  // otro (decisión #3).
  async function handleSave() {
    if (!builderState || !session || saving) return;
    // Se captura ACÁ, antes del await -- es la referencia EXACTA que viaja
    // al servidor. Si la clienta sigue editando mientras esto está en
    // vuelo, markSaved compara contra esto (no contra el state más
    // reciente) para no marcar como "guardado" algo que nunca se mandó.
    const definitionBeingSaved = builderState.definition;
    setSaving(true);
    setSaveRequestError(null);
    const result = await saveFlowVersion({
      flowId,
      definition: definitionBeingSaved,
      accessToken: session.access_token,
    });
    setSaving(false);
    if (result.ok) {
      setEditorState((prev) =>
        prev
          ? { ...prev, builder: markSaved(prev.builder, { id: result.version.id, versionNumber: result.version.version_number, definition: definitionBeingSaved }) }
          : prev,
      );
      setJustSaved(true);
      // Etapa 5 (autorizado): mantiene el historial local al día sin pedirlo
      // de nuevo -- saveFlowVersion ya devuelve la fila completa. No
      // reemplaza la lista (podría haber otras filas ya cargadas), solo
      // agrega/actualiza esta.
      setAllVersions((prev) => [result.version, ...prev.filter((v) => v.id !== result.version.id)]);
    } else {
      setSaveRequestError(result.error.message);
    }
  }

  async function handleValidate() {
    if (!builderState || !session || validating) return;
    setValidating(true);
    setValidationRequestError(null);
    const result = await validateFlowDefinition({
      flowId,
      definition: builderState.definition,
      accessToken: session.access_token,
    });
    setValidating(false);
    if (result.ok) {
      // markValidated guarda result.result JUNTO con la referencia de
      // definition vigente en ESE momento -- si hubo una edición mientras
      // la petición estaba en vuelo, esa referencia ya no es
      // state.definition y isValidationStale lo detecta solo, sin lógica
      // extra acá.
      setEditorState((prev) => (prev ? { ...prev, builder: markValidated(prev.builder, result.result) } : prev));
    } else {
      // Error de red/API: nunca se inventa un resultado de validación
      // (decisión aprobada #10) -- lastValidation NO se toca.
      setValidationRequestError(result.error.message);
    }
  }

  // --- Etapa 5 (autorizado): Publicar + Historial + Restaurar --------------
  // Eje de estado INDEPENDIENTE de Guardar/Validar (mismo principio que
  // decisión aprobada #1 de Etapa 4): publishing/justPublished/
  // publishRequestError nunca se derivan de saving/validating.

  async function refreshVersions() {
    if (!session) return;
    setVersionsLoading(true);
    setVersionsError(null);
    const result = await fetchFlowVersions({ flowId, accessToken: session.access_token });
    setVersionsLoading(false);
    if (result.ok) {
      setAllVersions(result.versions);
    } else {
      setVersionsError(result.error.message);
    }
  }

  function handleOpenHistory() {
    setVersionsOpen(true);
    void refreshVersions();
  }

  // Publicar SIEMPRE manda lastSavedVersion.id -- nunca builderState.definition
  // directamente (decisión aprobada, sección 3). canPublishNow ya es el único
  // gate (rol + referencias); este guard repite la misma condición acá solo
  // como defensa en profundidad, no como una segunda fuente de verdad -- el
  // botón real ya viene deshabilitado por exactamente esta misma función.
  async function handlePublish() {
    if (!builderState || !session || publishing) return;
    if (!canPublishNow(builderState, rol)) return;
    const versionId = builderState.lastSavedVersion!.id;
    setPublishing(true);
    setPublishRequestError(null);
    const result = await publishFlowVersion({ flowId, versionId, accessToken: session.access_token });
    setPublishing(false);
    if (result.ok) {
      // Publicar NO toca BuilderState (ni definition ni lastSavedVersion) --
      // solo cambia cuál versión ya guardada está "en vivo". `publishedFlow`
      // reemplaza a `result.flow` (fijo desde la carga inicial) para que el
      // status/published_version_id mostrados queden correctos sin recargar.
      setPublishedFlow(result.flow);
      setJustPublished(true);
      if (versionsOpen) void refreshVersions();
    } else {
      setPublishRequestError(result.error.message);
    }
  }

  // Restaurar (opción A aprobada): SOLO carga la definición histórica en el
  // canvas como cambio local sin guardar -- nunca escribe a Supabase, nunca
  // publica. Pide confirmación siempre (nunca descarta cambios en curso en
  // silencio), mismo patrón ya usado en este módulo para borrar nodos/edges
  // con conexiones (FlowCanvas.tsx, window.confirm). También queda como un
  // paso más del historial local -- un Undo después de Restaurar vuelve a lo
  // que había antes, igual que cualquier otra edición.
  function handleRestoreRequest(versionToRestore: FlowVersionRow) {
    const confirmado = window.confirm(
      `¿Restaurar la versión ${versionToRestore.version_number}?\n\nSe cargará esta versión en el editor como un cambio sin guardar. Tus cambios actuales no guardados serán reemplazados.`,
    );
    if (!confirmado) return;

    const definicionHistorica = versionToRestore.definition_json as unknown as FlowDefinition;
    setEditorState((prev) =>
      prev ? { builder: loadDefinitionForEdit(prev.builder, definicionHistorica), history: pushHistory(prev.history, definicionHistorica, null) } : prev,
    );
    setSelection(EMPTY_SELECTION);
    setJustSaved(false);
    setSaveRequestError(null);
    setValidationRequestError(null);
    setJustPublished(false);
    setPublishRequestError(null);
    setVersionsOpen(false);
  }

  function selectNode(nodeId: string | null) {
    setSelection(nodeId ? { nodeIds: new Set([nodeId]), edgeIds: new Set() } : EMPTY_SELECTION);
  }

  function selectEdge(edgeId: string | null) {
    setSelection(edgeId ? { nodeIds: new Set(), edgeIds: new Set([edgeId]) } : EMPTY_SELECTION);
  }

  function selectNodeAndCenter(nodeId: string) {
    selectNode(nodeId);
    canvasRef.current?.centerOnNode(nodeId);
  }

  // --- Etapa 3 (autorizado): crear/eliminar nodos y edges ------------------
  // Todo pasa por edit() -> applyEdit(BuilderState) -> FlowDefinition sigue
  // siendo la única fuente de verdad; el canvas (arriba, `canvas`) siempre se
  // deriva de `definition` vía flowDefinitionToCanvas, nunca al revés.

  function handleNodeDrop(type: FlowNodeType, position: NodePosition) {
    if (!definition) return;
    const node = createDefaultNode(type, position, definition);
    edit((f) => addNode(f, node));
    selectNode(node.id); // el nodo nuevo queda inmediatamente editable en FlowInfoPanel
  }

  function handleConnect(connection: { source: string; target: string; sourceHandle: string | null }) {
    if (!definition) return;
    if (!isValidConnectionForFlow(definition, connection)) return; // defensivo: isValidConnection del canvas ya filtra esto antes
    const edge: FlowEdge = {
      id: generateEdgeId(new Set(definition.edges.map((e) => e.id))),
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
    };
    edit((f) => addEdge(f, edge));
  }

  function handleDeleteNodes(nodeIds: string[]) {
    if (nodeIds.length === 0) return;
    edit((f) => deleteNodes(f, nodeIds));
    setSelection((prev) => ({
      nodeIds: new Set([...prev.nodeIds].filter((id) => !nodeIds.includes(id))),
      edgeIds: prev.edgeIds,
    }));
  }

  function handleDeleteEdges(edgeIds: string[]) {
    if (edgeIds.length === 0) return;
    edit((f) => deleteEdges(f, edgeIds));
    setSelection((prev) => ({
      nodeIds: prev.nodeIds,
      edgeIds: new Set([...prev.edgeIds].filter((id) => !edgeIds.includes(id))),
    }));
  }

  // --- Professional Editor UX (autorizado): selección múltiple, copiar/pegar/duplicar ---

  function handleNodesDragStop(positions: { id: string; position: NodePosition }[]) {
    if (positions.length === 0) return;
    // applyCanvasPositions ya existía (canvas-adapter.ts) para el spike de
    // Etapa 0 -- se reutiliza tal cual para el drag de UNO o VARIOS nodos a
    // la vez (React Flow entrega el grupo completo cuando hay selección
    // múltiple), en vez de una función nueva casi idéntica.
    edit((f) => applyCanvasPositions(f, positions));
  }

  function copyIds(ids: ReadonlySet<string>) {
    if (!definition || ids.size === 0) return;
    setClipboard(copySelection(definition, ids, definition.id));
  }

  function duplicateIds(ids: ReadonlySet<string>) {
    if (!definition || ids.size === 0) return;
    const { flow: nextFlow, newNodeIds } = duplicateSelection(definition, ids);
    edit(() => nextFlow);
    setSelection({ nodeIds: new Set(newNodeIds), edgeIds: new Set() });
  }

  function handlePaste() {
    if (!definition || !clipboard) return;
    const { flow: nextFlow, newNodeIds } = pasteIntoFlow(definition, clipboard);
    if (newNodeIds.length === 0) return;
    edit(() => nextFlow);
    setSelection({ nodeIds: new Set(newNodeIds), edgeIds: new Set() });
  }

  function handleSelectAll() {
    if (!definition) return;
    setSelection({ nodeIds: new Set(definition.nodes.map((n) => n.id)), edgeIds: new Set() });
  }

  function handleEscape() {
    setSearchOpen(false);
    setContextMenu(null);
    setQuickAdd(null);
  }

  function handleQuickAddPick(type: FlowNodeType) {
    if (!definition || !quickAdd) return;
    handleNodeDrop(type, quickAdd.flowPosition);
  }

  function handleSearchSelect(nodeId: string) {
    selectNodeAndCenter(nodeId);
    setSearchOpen(false);
    setSearchQuery("");
  }

  // --- Professional Editor UX (autorizado): menú contextual -----------------
  // Un solo componente (FlowContextMenu) para los tres casos -- este archivo
  // decide QUÉ acciones mostrar según se haya abierto sobre un nodo, una
  // selección existente, o el canvas vacío.

  function openNodeContextMenu(nodeId: string, x: number, y: number) {
    const yaEnLaSeleccion = selection.nodeIds.has(nodeId);
    if (!yaEnLaSeleccion) selectNode(nodeId);
    const ids = yaEnLaSeleccion ? selection.nodeIds : new Set([nodeId]);
    const n = ids.size > 1 ? ` (${ids.size})` : "";
    setContextMenu({
      x,
      y,
      items: [
        { label: "Editar", icon: Pencil, onClick: () => selectNode(nodeId) },
        { label: `Duplicar${n}`, icon: Files, onClick: () => duplicateIds(ids) },
        { label: `Copiar${n}`, icon: Copy, onClick: () => copyIds(ids) },
        { label: `Eliminar${n}`, icon: Trash2, danger: true, onClick: () => handleDeleteNodes([...ids]) },
      ],
    });
  }

  function openSelectionContextMenu(x: number, y: number) {
    if (selection.nodeIds.size === 0) return;
    const n = ` (${selection.nodeIds.size})`;
    setContextMenu({
      x,
      y,
      items: [
        { label: `Copiar${n}`, icon: Copy, onClick: () => copyIds(selection.nodeIds) },
        { label: `Duplicar${n}`, icon: Files, onClick: () => duplicateIds(selection.nodeIds) },
        { label: `Eliminar${n}`, icon: Trash2, danger: true, onClick: () => handleDeleteNodes([...selection.nodeIds]) },
      ],
    });
  }

  function openPaneContextMenu(x: number, y: number, flowPosition: NodePosition) {
    setContextMenu({
      x,
      y,
      items: [
        { label: "Agregar nodo", icon: Plus, onClick: () => setQuickAdd({ x, y, flowPosition }) },
        ...(clipboard ? [{ label: "Pegar", icon: ClipboardPaste, onClick: handlePaste }] : []),
        { label: "Encuadrar todo", icon: Maximize, onClick: () => canvasRef.current?.fitView() },
      ],
    });
  }

  useFlowKeyboardShortcuts({
    undo: handleUndo,
    redo: handleRedo,
    copy: () => copyIds(selection.nodeIds),
    paste: handlePaste,
    duplicate: () => duplicateIds(selection.nodeIds),
    selectAll: handleSelectAll,
    escape: handleEscape,
    find: () => setSearchOpen(true),
    fitView: () => canvasRef.current?.fitView(),
  });

  // --- Etapa 4 (autorizado): permisos (solo reflejo visual -- la
  // autorización real sigue siendo la de las APIs, que vuelven a exigir el
  // rol correcto en cada request) y estados combinados para el Topbar.
  const canSave = canSaveFlow(rol);
  const canValidate = canValidateFlow(rol);

  const saveStatus: SaveStatus = saving ? "saving" : saveRequestError ? "error" : justSaved ? "saved" : "idle";
  const validationStatus: ValidationStatus = validating
    ? "validating"
    : validationRequestError
      ? "error"
      : !builderState || isValidationStale(builderState)
        ? "idle"
        : builderState.lastValidation!.result.valid
          ? "valid"
          : "invalid";

  // Etapa 5 (autorizado): mismo criterio -- rol es reflejo visual, la API
  // sigue siendo la autoridad real (POST /publish exige admin de nuevo).
  const canPublish = canPublishFlow(rol);
  const publishReadyReason = publishDisabledReason(builderState, rol);
  const publishStatus: PublishStatus = publishing ? "publishing" : publishRequestError ? "error" : justPublished ? "published" : "idle";

  if (result.kind !== "loaded" || !builderState || !editorState) {
    // "no_versions" tiene 3 sub-estados reales, nunca un detalle técnico:
    // preparándose (spinner, intento automático en curso), sin permiso de
    // edición (lectura/agente -- no se intenta nada, solo se informa), o el
    // intento automático falló (mensaje real + botón Reintentar).
    let screenKind: FlowStateScreenKind = result.kind === "loaded" ? "loading" : result.kind;
    let screenMessage: string | undefined = result.kind === "error" ? result.message : undefined;
    let onRetry: (() => void) | undefined;
    if (result.kind === "no_versions") {
      if (rol !== "admin") {
        screenKind = "no_content";
      } else if (bootstrapError) {
        screenKind = "error";
        screenMessage = bootstrapError;
        onRetry = () => {
          bootstrapAttemptedRef.current = false;
          void intentarPrepararFlow();
        };
      } else {
        screenKind = "no_versions";
      }
    }
    return (
      <div className="flex flex-col">
        <header className="flex items-center gap-4 border-b border-edge bg-card px-5 py-3">
          <Link href="/dashboard/flows" className="flex items-center gap-1.5 text-sm text-mist hover:text-fg">
            <ArrowLeft className="size-4" />
            Flows
          </Link>
          <div className="h-5 w-px bg-edge" />
          <h1 className="text-sm font-semibold text-fg">Flow Builder</h1>
        </header>
        <div className="flex h-[75vh] min-h-[560px]">
          <FlowStateScreen kind={screenKind} message={screenMessage} onRetry={onRetry} />
        </div>
      </div>
    );
  }

  const { version } = result;
  // Etapa 5 (autorizado): `publishedFlow` (actualizado tras un publish en
  // esta sesión) reemplaza a `result.flow`, que quedó fijo desde la carga
  // inicial y nunca se actualizaría solo por publicar.
  const flow = publishedFlow ?? result.flow;

  // "Versión activa" = lo último GUARDADO en esta sesión (lastSavedVersion),
  // o si nunca se guardó todavía, la que se cargó originalmente. Esto es lo
  // que decide si "el canvas está mostrando la publicada" -- la auditoría
  // confirmó que `version.published_at !== null` NO es una fuente confiable
  // (queda en true en versiones que ya no son la publicada actual), y
  // además acá hace falta reflejar un Guardar/Publicar hechos DENTRO de esta
  // sesión, que `version`/`result.flow` (fijos desde el load) no capturan.
  const activeVersionId = builderState.lastSavedVersion?.id ?? version.id;
  const activeVersionNumber = builderState.lastSavedVersion?.versionNumber ?? version.version_number;
  const isPublishedVersionShown = flow.published_version_id === activeVersionId;
  // Banner (decisión aprobada #3): solo si el canvas muestra la publicada Y
  // existe alguna versión guardada con número mayor -- nunca cambia sola la
  // versión visible, solo informa (ver hasNewerDraftThanPublished).
  const showNewerDraftBanner = isPublishedVersionShown && hasNewerDraftThanPublished(allVersions, flow.published_version_id);
  // Mismo rol que ya exige GET /versions en el backend (admin|agente) --
  // reutiliza canValidateFlow por ser exactamente el mismo predicado, no
  // porque "ver historial" y "validar" sean la misma acción.
  const canViewHistory = canValidate;

  return (
    <div className="flex flex-col">
      <FlowTopbar
        flowName={flow.name}
        status={flow.status}
        versionNumber={activeVersionNumber}
        isPublishedVersionShown={isPublishedVersionShown}
        isDirty={builderState.isDirty}
        onDiscard={handleDiscard}
        saveStatus={saveStatus}
        validationStatus={validationStatus}
        errorCount={validationErrors.length}
        onSave={handleSave}
        onValidate={handleValidate}
        canSave={canSave}
        canValidate={canValidate}
        publishStatus={publishStatus}
        onPublish={handlePublish}
        canPublish={canPublish}
        publishDisabledReason={publishReadyReason}
        onOpenHistory={handleOpenHistory}
        canViewHistory={canViewHistory}
        canUndo={historyCanUndo(editorState.history)}
        canRedo={historyCanRedo(editorState.history)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen((v) => !v)}
        minimapVisible={minimapVisible}
        onToggleMinimap={() => setMinimapVisible((v) => !v)}
      />
      {showNewerDraftBanner && (
        <div className="flex items-center justify-between gap-3 border-b border-edge bg-amber-400/10 px-5 py-2 text-xs text-amber-400">
          <span>Existe una versión más reciente sin publicar.</span>
          <button
            type="button"
            onClick={handleOpenHistory}
            className="shrink-0 font-medium underline underline-offset-2 hover:text-amber-300"
          >
            Ver versión
          </button>
        </div>
      )}
      <FlowValidationPanel
        globalErrors={globalValidationErrors}
        nodeAndEdgeErrors={nodeAndEdgeErrors}
        warnings={orphanWarnings}
        nodeLabel={nodeLabelById}
        onSelectNode={selectNodeAndCenter}
        onSelectEdge={selectEdge}
      />
      <div className="relative flex h-[75vh] min-h-[560px]">
        <FlowNodePalette />
        <div className="relative min-w-0 flex-1">
          {canvasConTriggers && (
            <FlowCanvas
              ref={canvasRef}
              nodes={canvasConTriggers.nodes}
              edges={canvasConTriggers.edges}
              selectedNodeIds={selection.nodeIds}
              selectedEdgeIds={selection.edgeIds}
              onSelectionChange={({ nodeIds, edgeIds }) => {
                // FlowCanvas.tsx deriva esto de los NodeChange/EdgeChange
                // "select" reales que aplicó (onNodesChange/onEdgesChange) --
                // ya no del onSelectionChange nativo de @xyflow/react, que
                // resultó desincronizado de su propio store interno (ver el
                // comentario de handleNodesChange en FlowCanvas.tsx). Este
                // guard por VALOR se conserva como defensa en profundidad:
                // nunca crea un Set nuevo si el contenido reportado es
                // idéntico al actual, para no generar una referencia nueva
                // sin necesidad.
                setSelection((prev) => {
                  if (sameIds(prev.nodeIds, nodeIds) && sameIds(prev.edgeIds, edgeIds)) return prev;
                  return { nodeIds: new Set(nodeIds), edgeIds: new Set(edgeIds) };
                });
              }}
              onPaneClick={() => setContextMenu(null)}
              onPaneDoubleClick={(x, y, flowPosition) => setQuickAdd({ x, y, flowPosition })}
              onNodesDragStop={handleNodesDragStop}
              onConnect={handleConnect}
              isValidConnection={(connection) => (definition ? isValidConnectionForFlow(definition, connection) : false)}
              onNodeDrop={handleNodeDrop}
              onDeleteNodes={handleDeleteNodes}
              onDeleteEdges={handleDeleteEdges}
              onNodeContextMenu={openNodeContextMenu}
              onSelectionContextMenu={openSelectionContextMenu}
              onPaneContextMenu={openPaneContextMenu}
              nodeIdsWithErrors={nodeIdsWithErrors}
              edgeIdsWithErrors={edgeIdsWithErrors}
              minimapVisible={minimapVisible}
            />
          )}
          <FlowSearchBar
            open={searchOpen}
            query={searchQuery}
            onQueryChange={setSearchQuery}
            results={searchResults}
            onSelect={handleSearchSelect}
            onClose={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
          />
        </div>
        <FlowInfoPanel
          node={selectedNode}
          flow={definition}
          errors={errors}
          serverErrors={serverErrorsForSelectedNode}
          onLabelChange={(label) => selectedNodeId && edit((f) => updateNodeLabel(f, selectedNodeId, label), `node:${selectedNodeId}`)}
          onConfigChange={(config) => selectedNodeId && edit((f) => updateNodeConfig(f, selectedNodeId, config), `node:${selectedNodeId}`)}
          triggers={triggers}
          onAddTrigger={handleAddTrigger}
          onEditTrigger={handleEditTrigger}
          onDeleteTrigger={handleDeleteTrigger}
          onToggleTriggerEnabled={handleToggleTriggerEnabled}
        />
      </div>
      <TriggerModal
        open={triggerModal !== null}
        trigger={triggerModal?.mode === "edit" ? triggerModal.trigger : null}
        saving={triggerSaving}
        error={triggerError}
        onClose={() => setTriggerModal(null)}
        onSubmit={handleSubmitTrigger}
      />
      <FlowVersionHistory
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        versions={allVersions}
        loading={versionsLoading}
        error={versionsError}
        publishedVersionId={flow.published_version_id}
        canRestore={canSave}
        onRestore={handleRestoreRequest}
      />
      <FlowContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <FlowQuickAddMenu
        state={quickAdd}
        onPick={handleQuickAddPick}
        onClose={() => setQuickAdd(null)}
      />
    </div>
  );
}
