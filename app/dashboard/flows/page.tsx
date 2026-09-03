"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus, Workflow } from "lucide-react";
import { PageHeader, Pill } from "@/components/dashboard/shell/ui";
import { CreateFlowModal } from "@/components/dashboard/flows/CreateFlowModal";
import { createFlow as createFlowRequest } from "@/lib/flow-builder/create-flow";
import { useDashboard } from "@/lib/dashboard-session";
import { useI18n } from "@/lib/i18n";
import type { FlowRow } from "@/lib/flow/flow-store-types";

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Listado de Flows (Flow Builder, autorizado) — reutiliza GET/POST
 * /api/flows tal cual existen, sin ninguna lógica de persistencia nueva.
 * Mismo patrón visual que /dashboard/surveys y /dashboard/marketplace
 * (PageHeader + Pill + tabla con fila-a-detalle).
 */
export default function FlowsListPage() {
  const { session, rol } = useDashboard();
  const { t } = useI18n();
  const router = useRouter();
  const [flows, setFlows] = useState<FlowRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const cargar = useCallback(() => {
    if (!session) return;
    fetch("/api/flows", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? t("Error cargando los flows", "Error loading flows"));
        setFlows((json.flows ?? []) as FlowRow[]);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session, t]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // POST /api/flows exige admin (mismo rol que Guardar/Publicar dentro del
  // editor, ver lib/flow-builder/permissions.ts) -- se oculta el botón para
  // que nadie intente crear uno y se encuentre con un 403.
  const puedeCrear = rol === "admin";

  const crearFlow = useCallback(
    async (nombre: string, descripcion: string) => {
      if (!session) return;
      setCreando(true);
      setCreateError(null);
      const result = await createFlowRequest({
        name: nombre,
        description: descripcion || undefined,
        accessToken: session.access_token,
      });
      if (result.ok) {
        setModalOpen(false);
        router.push(`/dashboard/flows/${result.flow.id}`);
        return;
      }
      setCreando(false);
      setCreateError(result.error.message);
    },
    [session, router],
  );

  const header = (
    <PageHeader
      eyebrow="Flow Builder"
      title={t("Flows", "Flows")}
      description={t(
        "Crea y edita flujos de conversación visualmente, sin programar cada bot a mano.",
        "Create and edit conversation flows visually, without hand-coding every bot.",
      )}
    >
      {puedeCrear && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" /> {t("Crear Flow", "Create Flow")}
        </button>
      )}
    </PageHeader>
  );

  const modal = (
    <CreateFlowModal
      open={modalOpen}
      creating={creando}
      error={createError}
      onClose={() => {
        if (creando) return;
        setModalOpen(false);
        setCreateError(null);
      }}
      onSubmit={crearFlow}
    />
  );

  if (error) {
    return (
      <div className="pb-12">
        {header}
        <div className="px-4 pt-6 md:px-8">
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">{error}</p>
        </div>
        {modal}
      </div>
    );
  }

  if (!flows) {
    return (
      <div className="pb-12">
        {header}
        <div className="px-4 pt-6 md:px-8">
          <p className="text-sm text-mist">{t("Cargando…", "Loading…")}</p>
        </div>
        {modal}
      </div>
    );
  }

  return (
    <div className="pb-12">
      {header}
      <div className="px-4 pt-6 md:px-8">
        {flows.length === 0 ? (
          <div className="rounded-xl border border-edge bg-card p-10 text-center">
            <Workflow className="mx-auto size-10 text-mist/40" strokeWidth={1.2} />
            <p className="mt-3 text-sm font-semibold text-fg">
              {t("Todavía no tienes ningún Flow", "You don't have any Flow yet")}
            </p>
            <p className="mt-1 text-sm text-mist">
              {t(
                "Crea tu primer flujo visual para automatizar una conversación de WhatsApp.",
                "Create your first visual flow to automate a WhatsApp conversation.",
              )}
            </p>
            {puedeCrear && (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg hover:bg-lime-hover"
              >
                <Plus className="size-3.5" /> {t("Crear Flow →", "Create Flow →")}
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-edge">
            <table className="w-full">
              <thead className="bg-ink text-left font-mono text-[10.5px] uppercase tracking-widest text-mist">
                <tr>
                  <th className="px-5 py-3 font-medium">{t("Nombre", "Name")}</th>
                  <th className="hidden px-3 py-3 font-medium sm:table-cell">{t("Estado", "Status")}</th>
                  <th className="hidden px-3 py-3 font-medium md:table-cell">{t("Actualizado", "Updated")}</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {flows.map((flow) => (
                  <FilaFlow key={flow.id} flow={flow} t={t} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {modal}
    </div>
  );
}

function FilaFlow({ flow, t }: { flow: FlowRow; t: (es: string, en: string) => string }) {
  const publicado = Boolean(flow.published_version_id);
  return (
    <tr className="border-t border-edge transition-colors hover:bg-card/50">
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <Workflow className="size-4 shrink-0 text-mist" />
          <div className="min-w-0">
            <div className="font-medium text-fg">{flow.name}</div>
            {flow.description && <div className="truncate text-sm text-mist">{flow.description}</div>}
          </div>
        </div>
      </td>
      <td className="hidden px-3 py-4 sm:table-cell">
        <Pill tone={flow.status === "archived" ? "danger" : publicado ? "success" : "neutral"}>
          {flow.status === "archived"
            ? t("Archivado", "Archived")
            : publicado
              ? t("Publicado", "Published")
              : t("Borrador", "Draft")}
        </Pill>
      </td>
      <td className="hidden px-3 py-4 text-sm text-mist md:table-cell">{formatFecha(flow.updated_at)}</td>
      <td className="px-5 py-4 text-right">
        <Link
          href={`/dashboard/flows/${flow.id}`}
          className="inline-flex items-center gap-1 rounded-lg border border-lime/50 px-4 py-2 text-sm font-medium text-lime-text transition-colors hover:bg-lime/10"
        >
          {t("Abrir", "Open")}
          <ChevronRight className="size-3.5" />
        </Link>
      </td>
    </tr>
  );
}
