"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList, FileSpreadsheet, PackagePlus, Plus, Search, Tags, X } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { CatalogCategory, CatalogProduct, ProductPage, StatusFilter } from "@/lib/catalogo/domain";
import { LINEA_SIN, materialConLinea } from "@/lib/catalogo/lineas";
import { CatalogLinks } from "@/components/dashboard/catalogo/CatalogLinks";
import { CategoriasDialog } from "@/components/dashboard/catalogo/CategoriasDialog";
import { ProductList, ProductListSkeleton } from "@/components/dashboard/catalogo/ProductList";
import { useLineasDelNegocio } from "@/components/dashboard/catalogo/use-lineas";
import { actionBtn, cn, inputCls, primaryBtn, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";

const PAGE_SIZE = 30;

type Resultado = { key: string; page: ProductPage | null; error: string | null };

export default function CatalogoPage() {
  const { t } = useI18n();
  const { client, cms, canWrite } = useCatalogAccess();
  const toast = useCatalogToast();
  // Las líneas de la tienda (Plata, Rodio…), solo en negocios que las tienen: sin ellas esta pantalla es exactamente la de siempre.
  const lineas = useLineasDelNegocio(client);

  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [linea, setLinea] = useState("");
  // Productos cuya línea se está guardando desde la lista (id -> línea elegida).
  const [asignando, setAsignando] = useState<ReadonlyMap<string, string>>(new Map());
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [categoriasAbierto, setCategoriasAbierto] = useState(false);
  // Sube cuando cambian las categorías: los productos de una categoría eliminada cambiaron de categoría, así que el listado se vuelve a pedir.
  const [recarga, setRecarga] = useState(0);
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

  const key = useMemo(() => JSON.stringify({ q, categoryId, status, linea, page, recarga }), [q, categoryId, status, linea, page, recarga]);

  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client.listProducts({ q: q || undefined, categoryId: categoryId || undefined, status, linea: linea || undefined, page, pageSize: PAGE_SIZE }).then((r) => {
      if (!vivo) return; // respuesta vieja: nunca pisa a la actual
      setResultado({ key, page: r.ok ? r.data : null, error: r.ok ? null : r.error.message });
    });
    return () => {
      vivo = false;
    };
  }, [client, key, q, categoryId, status, linea, page]);

  const cargando = resultado?.key !== key;
  const data = resultado?.page ?? null;
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hayFiltros = Boolean(q || categoryId || status !== "ALL" || linea);

  // El filtro de línea de AHORA: al terminar de guardar se mira este y no el de cuando se empezó (la persona pudo cambiarlo mientras tanto).
  const lineaDelFiltro = useRef(linea);
  useEffect(() => {
    lineaDelFiltro.current = linea;
  }, [linea]);

  /**
   * Cambia la línea de una pieza desde la lista: la línea ES su «Material», así que se escribe ahí y se guarda como cualquier edición del producto. Con un filtro de línea puesto la pieza puede
   * dejar de pertenecer a esta lista (p. ej. ya no está «sin línea»), así que se vuelve a pedir la página: la lista de pendientes se va vaciando sola. Sin filtro, solo se cambia la fila.
   */
  const asignarLinea = async (producto: CatalogProduct, clave: string) => {
    if (!client || asignando.has(producto.id)) return;
    const material = materialConLinea(producto.material, clave, lineas);
    if (material === (producto.material ?? "")) return;
    setAsignando((m) => new Map(m).set(producto.id, clave));
    const r = await client.updateProduct(producto.id, { material: material === "" ? null : material });
    setAsignando((m) => {
      const resto = new Map(m);
      resto.delete(producto.id);
      return resto;
    });
    if (!r.ok) {
      toast(r.error.message, "error");
      return;
    }
    const nombre = lineas.find((l) => l.clave === clave)?.etiqueta ?? clave;
    toast(t(`«${producto.name}» quedó en la línea ${nombre}.`, `“${producto.name}” is now in the ${nombre} line.`));
    const actualizado = r.data.product;
    if (lineaDelFiltro.current) setRecarga((n) => n + 1);
    else setResultado((previo) => (previo?.page ? { ...previo, page: { ...previo.page, items: previo.page.items.map((x) => (x.id === actualizado.id ? actualizado : x)) } } : previo));
  };

  const cambiarPagina = (p: number) => {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const alEliminarCategoria = (id: string) => {
    // Un filtro puesto en la categoría que acaba de desaparecer no tiene sentido: se quita.
    if (categoryId === id) {
      setCategoryId("");
      setPage(1);
    }
    setCategories((todas) => todas.filter((c) => c.id !== id));
    setRecarga((n) => n + 1);
  };

  const limpiar = () => {
    setBusqueda("");
    setQ("");
    setCategoryId("");
    setStatus("ALL");
    setLinea("");
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
            <button type="button" onClick={() => setCategoriasAbierto(true)} className={actionBtn}>
              <Tags className="size-4" />
              {t("Categorías", "Categories")}
            </button>
          </>
        )}
      </PageHeader>

      <CategoriasDialog abierto={categoriasAbierto} client={client} cms={cms} onCerrar={() => setCategoriasAbierto(false)} onEliminada={alEliminarCategoria} />

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
            {lineas.length > 0 && (
              <select
                value={linea}
                onChange={(e) => {
                  setLinea(e.target.value);
                  setPage(1);
                }}
                aria-label={t("Filtrar por línea", "Filter by line")}
                className={cn(inputCls, "sm:w-44")}
              >
                <option value="">{t("Todas las líneas", "All lines")}</option>
                <option value={LINEA_SIN}>{t("Sin línea", "No line")}</option>
                {lineas.map((l) => (
                  <option key={l.clave} value={l.clave}>
                    {l.etiqueta}
                  </option>
                ))}
              </select>
            )}
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
                {linea === LINEA_SIN && !q && !categoryId && status === "ALL" ? (
                  <>
                    <p className="mt-3 text-sm font-medium text-fg">{t("Todas tus piezas ya están en una línea", "All your pieces are already in a line")}</p>
                    <p className="mt-1 text-sm text-mist">{t("No queda ninguna sin clasificar.", "None are left to classify.")}</p>
                  </>
                ) : (
                  <>
                    <p className="mt-3 text-sm font-medium text-fg">{t("Sin resultados", "No results")}</p>
                    <p className="mt-1 text-sm text-mist">{t("Prueba con otro nombre, referencia o filtro.", "Try another name, reference or filter.")}</p>
                  </>
                )}
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
            <ProductList products={data.items} dimmed={cargando} clasificacion={lineas.length > 0 ? { lineas, puedeAsignar: canWrite, asignando, onAsignar: asignarLinea } : undefined} />
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
