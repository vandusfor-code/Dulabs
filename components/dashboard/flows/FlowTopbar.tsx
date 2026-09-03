"use client";

import Link from "next/link";
import { ArrowLeft, Check, History, Loader2, Map, Redo2, Search, ShieldAlert, TriangleAlert, Undo2 } from "lucide-react";
import { Pill } from "@/components/dashboard/shell/ui";
import type { FlowRecordStatus } from "@/lib/flow/flow-store-types";

const STATUS_LABEL: Record<FlowRecordStatus, string> = {
  draft: "Borrador",
  published: "Publicado",
  archived: "Archivado",
};

const STATUS_TONE: Record<FlowRecordStatus, "neutral" | "success" | "danger"> = {
  draft: "neutral",
  published: "success",
  archived: "danger",
};

export type SaveStatus = "idle" | "saving" | "saved" | "error";
export type ValidationStatus = "idle" | "validating" | "valid" | "invalid" | "error";
export type PublishStatus = "idle" | "publishing" | "published" | "error";

/** Pill de guardado -- "idle" cae al indicador de dirty existente (isDirty), los demás estados lo reemplazan. */
function SavePill({ saveStatus, isDirty }: { saveStatus: SaveStatus; isDirty: boolean }) {
  if (saveStatus === "saving") {
    return (
      <Pill tone="neutral">
        <Loader2 className="size-3 animate-spin" /> Guardando…
      </Pill>
    );
  }
  if (saveStatus === "saved") {
    return (
      <Pill tone="success">
        <Check className="size-3" /> Guardado
      </Pill>
    );
  }
  if (saveStatus === "error") {
    return (
      <Pill tone="danger">
        <TriangleAlert className="size-3" /> Error al guardar
      </Pill>
    );
  }
  return <Pill tone={isDirty ? "warning" : "neutral"}>{isDirty ? "● Cambios sin guardar" : "● Sin cambios"}</Pill>;
}

/** Pill de validación -- "idle" cubre tanto "nunca se validó" como "el resultado anterior quedó obsoleto por un edit" (ver isValidationStale en builder-state.ts; el caller ya resuelve eso antes de pasar el status acá). */
function ValidationPill({ validationStatus, errorCount }: { validationStatus: ValidationStatus; errorCount: number }) {
  if (validationStatus === "validating") {
    return (
      <Pill tone="neutral">
        <Loader2 className="size-3 animate-spin" /> Validando…
      </Pill>
    );
  }
  if (validationStatus === "valid") {
    return (
      <Pill tone="success">
        <Check className="size-3" /> Válido
      </Pill>
    );
  }
  if (validationStatus === "invalid") {
    return (
      <Pill tone="danger">
        <TriangleAlert className="size-3" /> {errorCount} error{errorCount === 1 ? "" : "es"} de validación
      </Pill>
    );
  }
  if (validationStatus === "error") {
    return (
      <Pill tone="danger">
        <ShieldAlert className="size-3" /> Error al validar
      </Pill>
    );
  }
  return <Pill tone="neutral">Sin validar desde el último cambio</Pill>;
}

/**
 * Pill de publicación -- Etapa 5 (autorizado). "idle" no renderiza nada: el
 * estado real del Flow (Borrador/Publicado) ya lo muestra el Pill de status
 * al final del topbar, y duplicarlo acá sería ruido. Eje de estado
 * INDEPENDIENTE de Guardar/Validar (mismo principio que decisión aprobada #3
 * de Etapa 4): publishStatus nunca se deriva de saveStatus/validationStatus.
 */
function PublishPill({ publishStatus }: { publishStatus: PublishStatus }) {
  if (publishStatus === "publishing") {
    return (
      <Pill tone="neutral">
        <Loader2 className="size-3 animate-spin" /> Publicando…
      </Pill>
    );
  }
  if (publishStatus === "published") {
    return (
      <Pill tone="success">
        <Check className="size-3" /> Publicado
      </Pill>
    );
  }
  if (publishStatus === "error") {
    return (
      <Pill tone="danger">
        <ShieldAlert className="size-3" /> Error al publicar
      </Pill>
    );
  }
  return null;
}

/**
 * Etapa 4 (Flow Builder, autorizado) — agrega Guardar/Validar como acciones
 * INDEPENDIENTES (decisión aprobada #3: cada botón se deshabilita únicamente
 * por su propia operación en curso, nunca por la del otro). Los permisos acá
 * son solo reflejo visual (canSave/canValidate, ya resueltos por el caller
 * desde el `rol` real de useDashboard()) -- la autorización real sigue
 * siendo la de las APIs (POST /versions exige admin, POST /validate exige
 * admin o agente), esta UI no la reemplaza.
 */
export function FlowTopbar({
  flowName,
  status,
  versionNumber,
  isPublishedVersionShown,
  isDirty,
  onDiscard,
  saveStatus,
  validationStatus,
  errorCount,
  onSave,
  onValidate,
  canSave,
  canValidate,
  publishStatus,
  onPublish,
  canPublish,
  publishDisabledReason,
  onOpenHistory,
  canViewHistory,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  searchOpen,
  onToggleSearch,
  minimapVisible,
  onToggleMinimap,
}: {
  flowName: string;
  status: FlowRecordStatus;
  versionNumber: number;
  isPublishedVersionShown: boolean;
  isDirty: boolean;
  onDiscard: () => void;
  saveStatus: SaveStatus;
  validationStatus: ValidationStatus;
  /** Cantidad de errores de la última validación vigente (0 cuando no aplica). */
  errorCount: number;
  onSave: () => void;
  onValidate: () => void;
  canSave: boolean;
  canValidate: boolean;
  publishStatus: PublishStatus;
  onPublish: () => void;
  /** Rol -- si es false, el botón Publicar ni se muestra (solo admin, mismo criterio que el resto de esta etapa). */
  canPublish: boolean;
  /** null = listo para publicar. Si no es null, explica por qué el botón está deshabilitado (se muestra como `title`). */
  publishDisabledReason: string | null;
  onOpenHistory: () => void;
  /** admin y agente pueden ver el historial; lectura no. */
  canViewHistory: boolean;
  /** Professional Editor UX (autorizado) -- historial LOCAL de edición, nunca depende de guardar versiones. */
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  minimapVisible: boolean;
  onToggleMinimap: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-edge bg-card px-5 py-3">
      <Link href="/dashboard/flows" className="flex shrink-0 items-center gap-1.5 text-sm text-mist hover:text-fg">
        <ArrowLeft className="size-4" />
        Flows
      </Link>
      <div className="h-5 w-px shrink-0 bg-edge" />
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{flowName}</h1>

      {/* Herramientas del editor -- distintas de las acciones de persistencia
          de abajo (Guardar/Validar/Publicar): nunca tocan el backend. */}
      <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-edge p-0.5">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Deshacer (Ctrl/Cmd+Z)"
          className="rounded-md p-1.5 text-mist transition-colors hover:bg-ink hover:text-fg disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Undo2 className="size-4" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Rehacer (Ctrl/Cmd+Shift+Z)"
          className="rounded-md p-1.5 text-mist transition-colors hover:bg-ink hover:text-fg disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Redo2 className="size-4" />
        </button>
        <div className="mx-0.5 h-4 w-px bg-edge" />
        <button
          type="button"
          onClick={onToggleSearch}
          title="Buscar nodo (Ctrl/Cmd+F)"
          className={`rounded-md p-1.5 transition-colors hover:bg-ink hover:text-fg ${searchOpen ? "bg-ink text-fg" : "text-mist"}`}
        >
          <Search className="size-4" />
        </button>
        <button
          type="button"
          onClick={onToggleMinimap}
          title={minimapVisible ? "Ocultar minimapa" : "Mostrar minimapa"}
          className={`rounded-md p-1.5 transition-colors hover:bg-ink hover:text-fg ${minimapVisible ? "bg-ink text-fg" : "text-mist"}`}
        >
          <Map className="size-4" />
        </button>
      </div>

      <ValidationPill validationStatus={validationStatus} errorCount={errorCount} />
      <SavePill saveStatus={saveStatus} isDirty={isDirty} />
      <PublishPill publishStatus={publishStatus} />

      {canViewHistory && (
        <button
          type="button"
          onClick={onOpenHistory}
          className="shrink-0 flex items-center gap-1.5 rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-lime/40 hover:text-fg"
        >
          <History className="size-3.5" /> Historial
        </button>
      )}

      {isDirty && (
        <button
          type="button"
          onClick={onDiscard}
          className="shrink-0 rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-red-500/50 hover:text-red-400"
        >
          Descartar cambios
        </button>
      )}

      {canValidate && (
        <button
          type="button"
          onClick={onValidate}
          disabled={validationStatus === "validating"}
          className="shrink-0 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {validationStatus === "validating" ? "Validando…" : "Validar"}
        </button>
      )}
      {canSave && (
        <button
          type="button"
          onClick={onSave}
          disabled={saveStatus === "saving"}
          className="btn-shine shrink-0 rounded-lg bg-lime px-3.5 py-1.5 text-xs font-semibold text-lime-fg transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-lime-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saveStatus === "saving" ? "Guardando…" : "Guardar"}
        </button>
      )}
      {canPublish && (
        <button
          type="button"
          onClick={onPublish}
          disabled={publishStatus === "publishing" || publishDisabledReason !== null}
          title={publishDisabledReason ?? undefined}
          className="shrink-0 rounded-lg border border-lime/40 px-3.5 py-1.5 text-xs font-semibold text-lime-text transition-colors hover:bg-lime/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {publishStatus === "publishing" ? "Publicando…" : "Publicar"}
        </button>
      )}

      <Pill tone={STATUS_TONE[status]}>● {STATUS_LABEL[status]}</Pill>
      <span className="shrink-0 font-mono text-xs text-mist">
        v{versionNumber}
        {!isPublishedVersionShown && " · más reciente sin publicar"}
      </span>
    </header>
  );
}
