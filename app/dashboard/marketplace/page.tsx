"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight, ShoppingCart } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { AgenteIcono } from "@/components/dashboard/marketplace/AgenteIcono";
import type { MarketplaceEstado, AgenteVista } from "@/components/dashboard/marketplace/tipos";

export default function MarketplacePage() {
  const { session } = useDashboard();
  const { t } = useI18n();
  const [estado, setEstado] = useState<MarketplaceEstado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [soloActivos, setSoloActivos] = useState(false);

  const cargar = useCallback(() => {
    if (!session) return;
    fetch("/api/dashboard/marketplace", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? t("Error cargando el marketplace", "Error loading the marketplace"));
        setEstado(json as MarketplaceEstado);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session, t]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const categorias = useMemo(
    () => [...new Set((estado?.agentes ?? []).map((a) => a.categoria))],
    [estado]
  );

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (estado?.agentes ?? []).filter((a) => {
      if (categoria && a.categoria !== categoria) return false;
      if (soloActivos && !a.activacion) return false;
      if (!q) return true;
      return a.nombre.toLowerCase().includes(q) || a.categoria.toLowerCase().includes(q);
    });
  }, [estado, busqueda, categoria, soloActivos]);

  const header = (
    <PageHeader
      eyebrow="Marketplace"
      title="Marketplace"
      description={t(
        "Explora agentes listos para instalar en tus números de WhatsApp.",
        "Browse agents ready to install on your WhatsApp numbers."
      )}
    />
  );

  if (error) {
    return (
      <div className="pb-12">
        {header}
        <div className="px-4 pt-6 md:px-8">
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-12">
      {header}
      <div className="px-4 pt-6 md:px-8">
        {/* Buscador + filtros */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-11 w-full max-w-[340px] items-center gap-2.5 rounded-xl border border-edge bg-ink px-3.5">
            <Search className="size-4 text-mist" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t("Buscar agente o rubro…", "Search agent or category…")}
              className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-mist"
            />
          </div>
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="h-11 rounded-xl border border-edge bg-ink px-3.5 text-sm text-fg outline-none"
          >
            <option value="">{t("Todas las categorías", "All categories")}</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center rounded-xl border border-edge bg-ink p-1 text-sm">
            <button
              onClick={() => setSoloActivos(false)}
              className={`rounded-lg px-3 py-1.5 transition-colors ${!soloActivos ? "bg-card text-fg" : "text-mist hover:text-fg"}`}
            >
              {t("Todos", "All")}
            </button>
            <button
              onClick={() => setSoloActivos(true)}
              className={`rounded-lg px-3 py-1.5 transition-colors ${soloActivos ? "bg-card text-fg" : "text-mist hover:text-fg"}`}
            >
              {t("Los que tengo activos", "My active ones")}
            </button>
          </div>
        </div>

        {/* Tabla */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-edge">
          <table className="w-full">
            <thead className="bg-ink text-left font-mono text-[10.5px] uppercase tracking-widest text-mist">
              <tr>
                <th className="px-5 py-3 font-medium">{t("Agente", "Agent")}</th>
                <th className="hidden px-3 py-3 font-medium md:table-cell">{t("Categoría", "Category")}</th>
                <th className="px-3 py-3 font-medium">{t("Precio", "Price")}</th>
                <th className="hidden px-3 py-3 font-medium sm:table-cell">{t("Estado", "Status")}</th>
                <th className="px-5 py-3 font-medium">{t("Acción", "Action")}</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center">
                    <ShoppingCart className="mx-auto size-9 text-mist/40" strokeWidth={1.2} />
                    <p className="mt-3 text-sm text-mist">
                      {soloActivos
                        ? t("Todavía no tienes agentes activos.", "You don't have any active agents yet.")
                        : t("No hay agentes que coincidan con tu búsqueda.", "No agents match your search.")}
                    </p>
                  </td>
                </tr>
              ) : (
                filtrados.map((a) => <FilaAgente key={a.slug} agente={a} t={t} />)
              )}
            </tbody>
          </table>
        </div>
        {filtrados.length > 0 && (
          <p className="mt-4 text-xs text-mist">
            {t(`Mostrando ${filtrados.length} de ${estado?.agentes.length ?? 0} agentes`, `Showing ${filtrados.length} of ${estado?.agentes.length ?? 0} agents`)}
          </p>
        )}
      </div>
    </div>
  );
}

function FilaAgente({ agente, t }: { agente: AgenteVista; t: (es: string, en: string) => string }) {
  const activo = agente.activacion;
  return (
    <tr className="border-t border-edge transition-colors hover:bg-card/50">
      <td className="px-5 py-4">
        <div className="flex items-center gap-4">
          <AgenteIcono icono={agente.icono} />
          <div className="min-w-0">
            <div className="font-medium text-fg">{agente.nombre}</div>
            <div className="truncate text-sm text-mist">{agente.descripcion.split(".")[0]}.</div>
          </div>
        </div>
      </td>
      <td className="hidden px-3 py-4 text-sm text-mist md:table-cell">{agente.categoria}</td>
      <td className="px-3 py-4">
        <div className="font-semibold text-lime-text">${agente.precioRecurrente.toLocaleString("es-CO")} {t("/ mes", "/ mo")}</div>
        <div className="text-xs text-mist">{t(`o $${agente.precioMes.toLocaleString("es-CO")} por 1 mes`, `or $${agente.precioMes.toLocaleString("es-CO")} for 1 month`)}</div>
      </td>
      <td className="hidden px-3 py-4 sm:table-cell">
        {activo ? (
          <>
            <div className="text-sm font-medium text-lime-text">{t("Activo", "Active")}</div>
            <div className="text-xs text-mist">{t("En", "On")} {activo.nombre_negocio}</div>
          </>
        ) : (
          <div className="text-sm text-mist">{t("Disponible", "Available")}</div>
        )}
      </td>
      <td className="px-5 py-4">
        <Link
          href={`/dashboard/marketplace/${agente.slug}`}
          className="inline-flex items-center gap-1 rounded-lg border border-lime/50 px-4 py-2 text-sm font-medium text-lime-text transition-colors hover:bg-lime/10"
        >
          {activo ? t("Administrar", "Manage") : t("Ver detalles", "View details")}
          <ChevronRight className="size-3.5" />
        </Link>
      </td>
    </tr>
  );
}
