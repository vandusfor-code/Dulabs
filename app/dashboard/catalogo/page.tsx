"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList, FileSpreadsheet, PackagePlus, Plus, Search, X } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { CatalogCategory, ProductPage, StatusFilter } from "@/lib/catalogo/domain";
import { CatalogLinks } from "@/components/dashboard/catalogo/CatalogLinks";
import { ProductList, ProductListSkeleton } from "@/components/dashboard/catalogo/ProductList";
import { actionBtn, cn, inputCls, primaryBtn, useCatalogAccess } from "@/components/dashboard/catalogo/ui";

const PAGE_SIZE = 30;

type Resultado = { key: string; page: ProductPage | null; error: string | null };

export default function CatalogoPage() {
  const { t } = useI18n();
  const { client, canWrite } = useCatalogAccess();

  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  // Búsqueda con debounce: una consulta por pausa de escritura, no por tecla.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(busqueda.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [busqueda]);

  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client.listCategories().then((r) => {
      if (vivo && r.ok) setCategories(r.data.categories);
    });
    return () => {
      vivo = false;
    };
  }, [client]);

  const key = useMemo(() => JSON.stringify({ q, categoryId, status, page }), [q, categoryId, status, page]);

  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client.listProducts({ q: q || undefined, categoryId: categoryId || undefined, status, page, pageSize: PAGE_SIZE }).then((r) => {
      if (!vivo) return; // respuesta vieja: nunca pisa a la actual
      setResultado({ key, page: r.ok ? r.data : null, error: r.ok ? null : r.error.message });
    });
    return () => {
      vivo = false;
    };
  }, [client, key, q, categoryId, status, page]);

  const cargando = resultado?.key !== key;
  const data = resultado?.page ?? null;
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hayFiltros = Boolean(q || categoryId || status !== "ALL");

  const cambiarPagina = (p: number) => {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const limpiar = () => {
    setBusqueda("");
    setQ("");
    setCategoryId("");
    setStatus("ALL");
    setPage(1);
  };

  const estados: Array<{ value: StatusFilter; label: string }> = [
    { value: "ALL", label: t("Todos", "All") },
    { value: "ACTIVE", label: t("Activos", "Active") },
    { value: "INACTIVE", label: t("Inactivos", "Inactive") },
  ];

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow={t("Catálogo", "Catalog")}
        title={t("Carga de productos", "Product loading")}
        description={t(
          "Aquí registras y administras tus productos: fotografía, referencia y precios. Tus clientes los ven en el link del catálogo, y es la información que usará tu agente de IA.",
          "Register and manage your products here: photo, reference and prices. Your customers see them on the catalog link, and it is the information your AI agent will use.",
        )}
      >
        <Link href="/dashboard/catalogo/pedidos" className={actionBtn}>
          <ClipboardList className="size-4" />
          {t("Pedidos", "Orders")}
        </Link>
        {canWrite && (
          <>
            <Link href="/dashboard/catalogo/nuevo" className={primaryBtn}>
              <Plus className="size-4" />
              {t("Nuevo producto", "New product")}
            </Link>
            <Link href="/dashboard/catalogo/importar" className={actionBtn}>
              <FileSpreadsheet className="size-4" />
              {t("Carga masiva", "Bulk upload")}
            </Link>
          </>
        )}
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        <CatalogLinks client={client} canWrite={canWrite} />

        {/* Barra de búsqueda y filtros */}
        <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t("Buscar por nombre o referencia (ej. DL-000184)", "Search by name or reference (e.g. DL-000184)")}
              aria-label={t("Buscar productos", "Search products")}
              className={cn(inputCls, "pl-9 pr-9")}
            />
            {busqueda && (
              <button type="button" onClick={() => setBusqueda("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-mist hover:text-fg" aria-label={t("Limpiar búsqueda", "Clear search")}>
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
              aria-label={t("Filtrar por categoría", "Filter by category")}
              className={cn(inputCls, "sm:w-52")}
            >
              <option value="">{t("Todas las categorías", "All categories")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div role="radiogroup" aria-label={t("Estado", "Status")} className="inline-flex shrink-0 rounded-lg border border-edge bg-ink p-1">
              {estados.map((e) => (
                <button
                  key={e.value}
                  type="button"
                  role="radio"
                  aria-checked={status === e.value}
                  onClick={() => {
                    setStatus(e.value);
                    setPage(1);
                  }}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-sm transition-colors",
                    status === e.value ? "bg-card font-medium text-fg shadow-sm" : "text-mist hover:text-fg",
                  )}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex h-5 items-center justify-between text-xs text-mist">
          <span aria-live="polite">
            {data && !cargando
              ? data.total === 1
                ? t("1 producto", "1 product")
                : t(`${data.total.toLocaleString("es-CO")} productos`, `${data.total.toLocaleString("en-US")} products`)
              : ""}
          </span>
          {hayFiltros && (
            <button type="button" onClick={limpiar} className="text-mist underline-offset-2 hover:text-fg hover:underline">
              {t("Limpiar filtros", "Clear filters")}
            </button>
          )}
        </div>

        <div className="mt-3">
          {resultado?.error && !cargando ? (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">{resultado.error}</p>
          ) : cargando && !data ? (
            <ProductListSkeleton />
          ) : data && data.items.length === 0 ? (
            hayFiltros ? (
              <div className="rounded-2xl border border-edge bg-card px-6 py-14 text-center">
                <Search className="mx-auto size-6 text-mist" />
                <p className="mt-3 text-sm font-medium text-fg">{t("Sin resultados", "No results")}</p>
                <p className="mt-1 text-sm text-mist">{t("Prueba con otro nombre, referencia o filtro.", "Try another name, reference or filter.")}</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-edge bg-card px-6 py-16 text-center">
                <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-lime/10 text-lime-text">
                  <PackagePlus className="size-7" />
                </div>
                <p className="mt-4 text-base font-semibold text-fg">{t("Aún no has cargado productos", "You have not loaded products yet")}</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-mist">
                  {t("Registra tu primer producto con su foto y precios. DuLabs le asigna la referencia automáticamente.", "Register your first product with its photo and prices. DuLabs assigns its reference automatically.")}
                </p>
                {canWrite && (
                  <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
                    <Link href="/dashboard/catalogo/nuevo" className={primaryBtn}>
                      <Plus className="size-4" />
                      {t("Crear primer producto", "Create first product")}
                    </Link>
                    <Link href="/dashboard/catalogo/importar" className={actionBtn}>
                      <FileSpreadsheet className="size-4" />
                      {t("Cargar muchos desde Excel", "Load many from Excel")}
                    </Link>
                  </div>
                )}
              </div>
            )
          ) : data ? (
            <ProductList products={data.items} dimmed={cargando} />
          ) : null}
        </div>

        {data && totalPaginas > 1 && (
          <nav className="mt-8 flex items-center justify-center gap-3" aria-label={t("Paginación", "Pagination")}>
            <button
              type="button"
              disabled={page <= 1 || cargando}
              onClick={() => cambiarPagina(page - 1)}
              className="flex items-center gap-1 rounded-lg border border-edge px-3 py-2 text-sm text-fg transition-colors hover:border-lime/40 disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
              {t("Anterior", "Previous")}
            </button>
            <span className="text-sm tabular-nums text-mist">
              {t(`Página ${page} de ${totalPaginas}`, `Page ${page} of ${totalPaginas}`)}
            </span>
            <button
              type="button"
              disabled={page >= totalPaginas || cargando}
              onClick={() => cambiarPagina(page + 1)}
              className="flex items-center gap-1 rounded-lg border border-edge px-3 py-2 text-sm text-fg transition-colors hover:border-lime/40 disabled:opacity-40"
            >
              {t("Siguiente", "Next")}
              <ChevronRight className="size-4" />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
