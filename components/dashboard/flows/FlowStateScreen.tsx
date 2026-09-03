"use client";

import Link from "next/link";
import { AlertTriangle, FileQuestion, Loader2, PackageOpen, type LucideIcon } from "lucide-react";

export type FlowStateScreenKind = "loading" | "not_found" | "error" | "no_versions" | "no_content";
type Kind = FlowStateScreenKind;

const CONFIG: Record<Kind, { icon: LucideIcon; spin?: boolean; title: string; body: string }> = {
  loading: { icon: Loader2, spin: true, title: "Cargando Flow…", body: "Obteniendo la definición desde la API." },
  not_found: {
    icon: FileQuestion,
    title: "Flow no encontrado",
    body: "No existe, no tienes acceso, o pertenece a otro tenant.",
  },
  error: { icon: AlertTriangle, title: "No se pudo cargar el Flow", body: "Ocurrió un error inesperado." },
  // Autorreparable: el editor intenta preparar la primera versión Draft
  // automáticamente en cuanto detecta este estado (ver [id]/page.tsx) --
  // nunca se le muestra a la usuaria un detalle técnico como un endpoint.
  no_versions: {
    icon: PackageOpen,
    spin: true,
    title: "Preparando tu Flow…",
    body: "Estamos dejando tu Flow listo para editar.",
  },
  no_content: {
    icon: PackageOpen,
    title: "Este Flow todavía no tiene contenido",
    body: "Pide a un administrador que lo abra primero para prepararlo.",
  },
};

/** Etapa 1 (Flow Builder, autorizado) — estados no-cargados, sin pantallas genéricas. */
export function FlowStateScreen({ kind, message, onRetry }: { kind: Kind; message?: string; onRetry?: () => void }) {
  const config = CONFIG[kind];
  const Icon = config.icon;

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-ink text-mist">
          <Icon className={`size-5 ${config.spin ? "animate-spin" : ""}`} />
        </div>
        <p className="text-sm font-semibold text-fg">{config.title}</p>
        <p className="text-xs leading-relaxed text-mist">{message ?? config.body}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg hover:bg-ink-2"
          >
            Reintentar
          </button>
        )}
        {kind !== "loading" && (
          <Link href="/dashboard/flows" className="mt-1 text-xs font-medium text-lime-text hover:underline">
            ← Volver a Flows
          </Link>
        )}
      </div>
    </div>
  );
}
