"use client";

/**
 * Fase 2 (Execution Inspector, autorizado) — panel de solo lectura sobre
 * ejecuciones REALES de producción. Habla EXCLUSIVAMENTE con
 * `GET /api/flows/[id]/executions` y `GET /api/flows/[id]/executions/[executionId]`
 * (vía lib/flow-builder/executions-client.ts) -- ningún método de escritura
 * existe en este componente (nada de reanudar/cancelar/reintentar/editar).
 *
 * Separado deliberadamente del Simulador de Fase 1 (`FlowSimulatorPanel.tsx`):
 * viven en componentes distintos, consumen endpoints distintos, y este NUNCA
 * muestra datos de una simulación (que nunca se escribe en
 * `dulabs_flow_executions`, ver reporte de Fase 2).
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  RefreshCw,
  X,
} from "lucide-react";
import { listExecutions, getExecutionDetail } from "@/lib/flow-builder/executions-client";
import type { FlowExecutionRow } from "@/lib/flow/flow-store-types";
import type { ExecutionInspectorDetail } from "@/lib/flow/execution-inspector";
import type { FlowEngineStatus } from "@/lib/flow/engine-types";

const STATUS_LABEL: Record<FlowEngineStatus, string> = {
  running: "Ejecutando",
  waiting_input: "Esperando respuesta",
  waiting_effect: "Esperando efecto",
  completed: "Completado",
  failed: "Falló",
  transferred: "Transferido",
};

const STATUS_TONE: Record<FlowEngineStatus, string> = {
  running: "text-lime-text",
  waiting_input: "text-amber-400",
  waiting_effect: "text-amber-400",
  completed: "text-lime-text",
  failed: "text-red-400",
  transferred: "text-sky-400",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

export interface FlowExecutionsPanelProps {
  open: boolean;
  onClose: () => void;
  flowId: string;
  accessToken: string;
  /** El Builder resalta este camino sobre FlowCanvas (spec: "Visualización sobre el canvas") -- null cuando no hay ejecución seleccionada. */
  onPathChange: (path: { nodeIds: ReadonlySet<string>; edgeIds: ReadonlySet<string> } | null) => void;
  onCenterNode: (nodeId: string) => void;
}

const PAGE_SIZE = 20;

export function FlowExecutionsPanel({ open, onClose, flowId, accessToken, onPathChange, onCenterNode }: FlowExecutionsPanelProps) {
  const [executions, setExecutions] = useState<FlowExecutionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<FlowEngineStatus | "">("");
  const [telefonoFilter, setTelefonoFilter] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ExecutionInspectorDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"timeline" | "nodes" | "variables" | "events" | "effects">("timeline");

  async function fetchList(): Promise<void> {
    setLoadingList(true);
    setListError(null);
    const result = await listExecutions({
      flowId,
      accessToken,
      status: statusFilter || undefined,
      telefono: telefonoFilter || undefined,
      page,
      pageSize: PAGE_SIZE,
    });
    setLoadingList(false);
    if (result.ok) {
      setExecutions(result.executions);
      setTotal(result.total);
    } else {
      setListError(result.error.message);
    }
  }

  // Mismo patrón que app/dashboard/flows/[id]/page.tsx (carga inicial del
  // Flow): función async DEFINIDA DENTRO del efecto, con guard `cancelled`
  // para nunca actualizar estado tras desmontar/cambiar de filtro a mitad de
  // un fetch en vuelo -- se dispara por `open`/`page`/filtros, cada uno ya
  // resuelto en el closure de esta misma pasada de render.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function cargar() {
      setLoadingList(true);
      setListError(null);
      const result = await listExecutions({
        flowId,
        accessToken,
        status: statusFilter || undefined,
        telefono: telefonoFilter || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      if (cancelled) return;
      setLoadingList(false);
      if (result.ok) {
        setExecutions(result.executions);
        setTotal(result.total);
      } else {
        setListError(result.error.message);
      }
    }

    void cargar();
    return () => {
      cancelled = true;
    };
  }, [open, page, statusFilter, telefonoFilter, flowId, accessToken]);

  async function openDetail(execution: FlowExecutionRow) {
    setLoadingDetail(true);
    setDetailError(null);
    setSelected(null);
    const result = await getExecutionDetail({ flowId, executionId: execution.id, accessToken });
    setLoadingDetail(false);
    if (result.ok) {
      setSelected(result.execution);
      onPathChange({ nodeIds: new Set(result.execution.path.nodeIds), edgeIds: new Set(result.execution.path.edgeIds) });
    } else {
      setDetailError(result.error.message);
    }
  }

  function backToList() {
    setSelected(null);
    onPathChange(null);
  }

  function handleClose() {
    setSelected(null);
    onPathChange(null);
    onClose();
  }

  if (!open) return null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50" role="dialog" aria-modal="true">
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-edge bg-card shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-edge px-5 py-3">
          {selected && (
            <button type="button" onClick={backToList} className="rounded-lg p-1.5 text-mist hover:bg-ink hover:text-fg" title="Volver al listado">
              <ArrowLeft className="size-4" />
            </button>
          )}
          <h2 className="flex-1 text-sm font-semibold text-fg">{selected ? `Ejecución #${selected.execution.executionId}` : "Ejecuciones"}</h2>
          {!selected && (
            <button
              type="button"
              onClick={() => void fetchList()}
              disabled={loadingList}
              className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-mist transition-colors hover:border-lime/40 hover:text-fg disabled:opacity-40"
            >
              <RefreshCw className={`size-3.5 ${loadingList ? "animate-spin" : ""}`} /> Actualizar
            </button>
          )}
          <button type="button" onClick={handleClose} title="Cerrar" className="rounded-lg p-1.5 text-mist transition-colors hover:bg-ink hover:text-fg">
            <X className="size-4" />
          </button>
        </div>

        {!selected ? (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-5 py-3">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setPage(1);
                  setStatusFilter(e.target.value as FlowEngineStatus | "");
                }}
                className="rounded-md border border-edge bg-ink px-2 py-1.5 text-xs text-fg"
              >
                <option value="">Todos los estados</option>
                {(Object.keys(STATUS_LABEL) as FlowEngineStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <input
                value={telefonoFilter}
                onChange={(e) => {
                  setPage(1);
                  setTelefonoFilter(e.target.value);
                }}
                placeholder="Filtrar por teléfono…"
                className="rounded-md border border-edge bg-ink px-2 py-1.5 text-xs text-fg placeholder:text-mist/50"
              />
            </div>

            <div className="flex-1 overflow-y-auto">
              {listError && <p className="px-5 py-4 text-xs text-danger-text">{listError}</p>}
              {!listError && loadingList && <p className="px-5 py-4 text-xs text-mist">Cargando…</p>}
              {!listError && !loadingList && executions.length === 0 && <p className="px-5 py-4 text-xs text-mist">No hay ejecuciones para estos filtros.</p>}
              {!listError && !loadingList && executions.length > 0 && (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-card text-[11px] uppercase tracking-wide text-mist">
                    <tr>
                      <th className="px-5 py-2">Estado</th>
                      <th className="px-2 py-2">Contacto</th>
                      <th className="px-2 py-2">Inicio</th>
                      <th className="px-2 py-2">Duración</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executions.map((ex) => (
                      <tr
                        key={ex.id}
                        onClick={() => void openDetail(ex)}
                        className="cursor-pointer border-t border-edge hover:bg-ink/50"
                      >
                        <td className={`px-5 py-2.5 font-medium ${STATUS_TONE[ex.status]}`}>{STATUS_LABEL[ex.status]}</td>
                        <td className="px-2 py-2.5 font-mono text-mist">{ex.telefono_cliente}</td>
                        <td className="px-2 py-2.5 text-mist">{formatDate(ex.created_at)}</td>
                        <td className="px-2 py-2.5 text-mist">{formatDuration(new Date(ex.last_activity_at).getTime() - new Date(ex.created_at).getTime())}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-edge px-5 py-2.5 text-xs text-mist">
              <span>
                {total} ejecución{total === 1 ? "" : "es"} — página {page} de {totalPages}
              </span>
              <div className="flex gap-1">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md p-1 hover:bg-ink disabled:opacity-30">
                  <ChevronLeft className="size-4" />
                </button>
                <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-md p-1 hover:bg-ink disabled:opacity-30">
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {loadingDetail && <p className="px-5 py-4 text-xs text-mist">Cargando detalle…</p>}
            {detailError && <p className="px-5 py-4 text-xs text-danger-text">{detailError}</p>}
            {!loadingDetail && !detailError && (
              <>
                <div className="shrink-0 border-b border-edge px-5 py-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <span className="text-mist">
                      Estado: <span className={`font-medium ${STATUS_TONE[selected.execution.status]}`}>{STATUS_LABEL[selected.execution.status]}</span>
                    </span>
                    <span className="text-mist">
                      Duración: <span className="text-fg">{formatDuration(selected.execution.durationMs)}</span>
                    </span>
                    <span className="text-mist">
                      Contacto: <span className="font-mono text-fg">{selected.execution.telefonoCliente}</span>
                    </span>
                    <span className="text-mist">
                      Versión: <span className="text-fg">v{selected.execution.flowVersionNumber ?? "?"}</span>
                    </span>
                    <span className="flex items-center gap-1 text-mist">
                      Nodo actual:{" "}
                      <button type="button" onClick={() => onCenterNode(selected.execution.currentNodeId ?? "")} className="flex items-center gap-1 text-fg underline underline-offset-2">
                        {selected.execution.currentNodeLabel} <MapPin className="size-3" />
                      </button>
                    </span>
                    <span className="text-mist">
                      Inicio: <span className="text-fg">{formatDate(selected.execution.createdAt)}</span>
                    </span>
                  </div>

                  {selected.error && (
                    <div className="mt-3 rounded-lg bg-red-500/10 p-3 text-xs">
                      <p className="flex items-center gap-1.5 font-semibold text-danger-text">
                        <AlertTriangle className="size-3.5" /> {selected.error.friendly}
                      </p>
                      <p className="mt-1 text-danger-text/80">{selected.error.technical}</p>
                      <button
                        type="button"
                        onClick={() => onCenterNode(selected.error!.nodeId ?? "")}
                        className="mt-1 flex items-center gap-1 text-danger-text underline underline-offset-2"
                      >
                        <MapPin className="size-3" /> Ir al nodo ({selected.error.nodeLabel})
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 border-b border-edge text-[11px] font-medium">
                  {(["timeline", "nodes", "variables", "events", "effects"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setDetailTab(tab)}
                      className={`flex-1 px-2 py-2 uppercase tracking-wide ${detailTab === tab ? "border-b-2 border-lime text-fg" : "text-mist hover:text-fg"}`}
                    >
                      {tab === "timeline" ? "Timeline" : tab === "nodes" ? "Nodos" : tab === "variables" ? "Variables" : tab === "events" ? "Eventos" : "Efectos"}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-3">
                  {detailTab === "timeline" && (
                    <ol className="space-y-3">
                      {selected.timeline.map((entry, i) => (
                        <li key={i} className="flex gap-2 text-xs">
                          <Clock className="mt-0.5 size-3 shrink-0 text-mist" />
                          <div>
                            <p className="text-fg">{entry.title}</p>
                            <p className="text-[10px] text-mist">{formatDate(entry.timestamp)}</p>
                          </div>
                        </li>
                      ))}
                      {selected.timeline.length === 0 && <p className="text-xs text-mist">Sin eventos registrados.</p>}
                    </ol>
                  )}

                  {detailTab === "nodes" && (
                    <ol className="space-y-2">
                      {selected.nodeSteps.map((step, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs">
                          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] text-mist">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <button type="button" onClick={() => onCenterNode(step.nodeId)} className="text-fg underline-offset-2 hover:underline">
                              {step.nodeLabel}
                            </button>
                            {step.inferred && <span className="ml-1 text-[10px] text-mist">(intermedio, deducido)</span>}
                            {step.durationMs !== null && <span className="ml-1 text-[10px] text-mist">— {formatDuration(step.durationMs)}</span>}
                          </div>
                        </li>
                      ))}
                      {selected.nodeSteps.length === 0 && <p className="text-xs text-mist">Sin transiciones registradas.</p>}
                    </ol>
                  )}

                  {detailTab === "variables" && (
                    <div className="space-y-1.5">
                      {Object.entries(selected.variables).map(([key, value]) => (
                        <div key={key} className="flex items-start justify-between gap-2 text-xs">
                          <span className="font-mono text-mist">{key}</span>
                          <span className="truncate text-right text-fg">{value === undefined || value === "" ? "—" : String(value)}</span>
                        </div>
                      ))}
                      {Object.keys(selected.variables).length === 0 && <p className="text-xs text-mist">Sin variables.</p>}
                    </div>
                  )}

                  {detailTab === "events" && (
                    <div className="space-y-2">
                      {selected.events.map((ev) => (
                        <div key={ev.id} className="text-xs">
                          <p className="text-fg">{ev.eventType}</p>
                          <p className="text-[10px] text-mist">{formatDate(ev.timestamp)}</p>
                        </div>
                      ))}
                      {selected.events.length === 0 && <p className="text-xs text-mist">Sin eventos.</p>}
                    </div>
                  )}

                  {detailTab === "effects" && (
                    <div className="space-y-2">
                      {selected.effects.map((eff) => (
                        <div key={eff.id} className="flex items-start gap-1.5 text-xs">
                          {eff.status === "succeeded" ? (
                            <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-lime-text" />
                          ) : (
                            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-red-400" />
                          )}
                          <div>
                            <p className="text-fg">
                              {eff.kind} — {eff.nodeLabel}
                            </p>
                            <p className="text-[10px] text-mist">
                              {eff.status} {eff.durationMs !== null ? `· ${formatDuration(eff.durationMs)}` : ""}
                            </p>
                          </div>
                        </div>
                      ))}
                      {selected.effects.length === 0 && <p className="text-xs text-mist">Sin efectos.</p>}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
