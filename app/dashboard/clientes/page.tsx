"use client";

// Bloque 33 — módulo "Clientes": un cliente por contacto de WhatsApp (quien eligió detal / por mayor
// o hizo un pedido), con sus compras. Búsqueda, filtros y paginación los hace el backend.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, RefreshCw, Search, StickyNote } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import { claveCliente, esMayoristaNuevo, type ClienteFila, type FiltroClientes } from "@/lib/catalogo/clientes/modelo";
import { actionBtn, cn, formatPrice, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";
import { Badge, MODALIDAD, estadoPedido, fechaCorta, telefonoVisible } from "@/components/dashboard/clientes/ui";

const FILTROS: Array<{ id: FiltroClientes; es: string; en: string }> = [
  { id: "todos", es: "Todos", en: "All" },
  { id: "detal", es: "Detal", en: "Retail" },
  { id: "mayorista", es: "Mayorista", en: "Wholesale" },
  { id: "compraron", es: "Ya compraron", en: "Bought" },
  { id: "sin_compras", es: "Aún no compran", en: "Not yet bought" },
];

type Pagina = { filas: ClienteFila[]; total: number; pagina: number; paginas: number };

export default function ClientesPage() {
  const { t } = useI18n();
  const { client } = useCatalogAccess();
  const toast = useCatalogToast();
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<FiltroClientes>("todos");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<{ clave: string; r: Pagina } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [exportando, setExportando] = useState(false);
  const clave = JSON.stringify({ q, filtro, pagina });

  // La búsqueda se aplica al dejar de escribir.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(busqueda.trim());
      setPagina(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [busqueda]);

  // Una respuesta vieja nunca pisa la nueva.
  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client.listClients({ q, filtro, pagina }).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setDatos({ clave, r: r.data });
        setError(null);
      } else setError(r.error.message);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `clave` resume q, filtro y página
  }, [client, clave, version]);

  const actual = datos?.clave === clave ? datos.r : null;

  async function exportar() {
    if (!client || exportando) return;
    setExportando(true);
    const r = await client.exportClients({ q, filtro });
    setExportando(false);
    if (!r.ok) return toast(r.error.message, "error");
    const url = URL.createObjectURL(r.data.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.data.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow={t("Operación", "Operations")}
        title={t("Clientes", "Customers")}
        description={t(
          "Cada cliente una sola vez, con su modalidad, sus pedidos y lo que ha comprado. Aparecen cuando eligen detal o por mayor, o cuando hacen un pedido.",
          "Each customer once, with their type, orders and purchases. They appear when they choose retail or wholesale, or place an order.",
        )}
      >
        <button type="button" onClick={() => setVersion((v) => v + 1)} className={actionBtn}>
          <RefreshCw className="size-4" />
          {t("Actualizar", "Refresh")}
        </button>
        <button type="button" onClick={() => void exportar()} disabled={exportando} className={actionBtn}>
          <Download className="size-4" />
          {exportando ? t("Exportando…", "Exporting…") : t("Exportar a Excel", "Export to Excel")}
        </button>
      </PageHeader>

      <div className="flex flex-col gap-3 px-4 pt-6 md:px-8 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" aria-hidden />
          <input
            type="search"
            maxLength={60}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={t("Buscar por nombre o teléfono", "Search by name or phone")}
            aria-label={t("Buscar clientes", "Search customers")}
            className="w-full rounded-xl border border-edge bg-card py-1.5 pl-9 pr-3 text-sm text-fg"
          />
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-edge p-0.5" role="group" aria-label={t("Filtrar clientes", "Filter customers")}>
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filtro === f.id}
              onClick={() => {
                setFiltro(f.id);
                setPagina(1);
              }}
              className={cn("rounded-lg px-3 py-1 text-sm transition-colors", filtro === f.id ? "bg-card font-medium text-fg" : "text-mist hover:text-fg")}
            >
              {t(f.es, f.en)}
            </button>
          ))}
        </div>
        {actual && (
          <span className="text-sm text-mist">
            {actual.total} {actual.total === 1 ? t("cliente", "customer") : t("clientes", "customers")}
          </span>
        )}
      </div>

      <div className="space-y-3 px-4 pt-4 md:px-8">
        {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
        {!actual && !error && <div className="h-32 animate-pulse rounded-2xl bg-card" aria-hidden />}
        {actual && actual.filas.length === 0 && (
          <div className="rounded-2xl border border-edge bg-card p-8 text-center text-sm text-mist">
            {q || filtro !== "todos"
              ? t("Ningún cliente coincide con la búsqueda.", "No customers match your search.")
              : t("Todavía no hay clientes. Aparecen cuando alguien elige detal o por mayor, o hace un pedido.", "No customers yet. They appear when someone chooses retail or wholesale, or places an order.")}
          </div>
        )}
        {actual?.filas.map((c) => {
          const ult = c.ultimoPedido ? estadoPedido(c.ultimoEstado, c.ultimaEtapa, t) : null;
          return (
            <Link
              key={claveCliente(c.phoneNumberId, c.waId)}
              href={`/dashboard/clientes/${claveCliente(c.phoneNumberId, c.waId)}`}
              className="block rounded-2xl border border-edge bg-card p-4 transition hover:border-fg/40 sm:p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-fg">{c.nombre ?? t("Sin nombre", "No name")}</span>
                {c.canal && <Badge tone={MODALIDAD[c.canal].tone}>{t(MODALIDAD[c.canal].es, MODALIDAD[c.canal].en)}</Badge>}
                {esMayoristaNuevo(c) && <Badge tone="bg-amber-500/15 text-amber-500">{t("Mayorista nuevo", "New wholesale")}</Badge>}
                {c.tieneNota && <StickyNote className="size-3.5 text-mist" aria-label={t("Tiene nota", "Has a note")} />}
                <span className="ml-auto font-semibold tabular-nums text-fg">{formatPrice(c.totalComprado)}</span>
                <ChevronRight className="size-4 text-mist" aria-hidden />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mist">
                <span className="tabular-nums">{telefonoVisible(c.waId)}</span>
                <span>
                  {c.compras} {c.compras === 1 ? t("compra", "purchase") : t("compras", "purchases")} · {c.pedidos} {c.pedidos === 1 ? t("pedido", "order") : t("pedidos", "orders")}
                </span>
                {c.ultimoPedido && ult && (
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono">{c.ultimoPedido}</span>
                    <Badge tone={ult.tone}>{ult.texto}</Badge>
                  </span>
                )}
                {c.ciudad && <span>{c.ciudad}</span>}
                <span>
                  {t("Último contacto", "Last contact")} {fechaCorta(c.ultimoContacto)}
                </span>
              </div>
            </Link>
          );
        })}
        {actual && actual.paginas > 1 && (
          <div className="flex items-center justify-between pt-2 text-sm text-mist">
            <button type="button" disabled={pagina <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))} className={actionBtn}>
              <ChevronLeft className="size-4" />
              {t("Anterior", "Previous")}
            </button>
            <span>
              {t("Página", "Page")} {actual.pagina} / {actual.paginas}
            </span>
            <button type="button" disabled={pagina >= actual.paginas} onClick={() => setPagina((p) => p + 1)} className={actionBtn}>
              {t("Siguiente", "Next")}
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
