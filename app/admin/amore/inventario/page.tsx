"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShoppingBag, Plus, Pencil, Upload, Download } from "lucide-react";
import { useAdminWeb } from "@/components/admin-web/AdminWebContext";
import { AdminOnlyDesktop } from "@/components/admin-web/AdminOnlyDesktop";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { ProductoModal } from "@/components/spa-panel/modals/ProductoModal";
import { ImportarInventarioModal } from "@/components/spa-panel/modals/ImportarInventarioModal";

// Módulo Inventario (autorizado) -- admin desktop de AMORE. Mismo patrón
// exacto que app/admin/amore/servicios/page.tsx (AdminOnlyDesktop, fetch
// directo a /api/agenda/[token]/..., ProductoModal reutilizando
// spa-panel/ui.tsx).
export interface ProductoInventarioUI {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  stock: number;
  categoria: string | null;
  fotoUrl: string | null;
  activo: boolean;
  updatedAt: string;
}

type Resumen = { total: number; activos: number; agotados: number; unidades: number };

function estadoProducto(p: ProductoInventarioUI): { texto: string; clase: string } {
  if (p.stock === 0) return { texto: "Agotado", clase: "bg-danger text-danger-text" };
  if (!p.activo) return { texto: "Inactivo", clase: "bg-ink-2 text-mist" };
  return { texto: "Activo", clase: "bg-success text-success-text" };
}

export default function AdminAmoreInventarioPage() {
  return (
    <AdminOnlyDesktop>
      <InventarioContenido />
    </AdminOnlyDesktop>
  );
}

function InventarioContenido() {
  const { token } = useAdminWeb();
  const [productos, setProductos] = useState<ProductoInventarioUI[] | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ modo: "crear" } | { modo: "editar"; producto: ProductoInventarioUI } | null>(null);
  const [importando, setImportando] = useState(false);

  const recargar = useCallback(() => {
    fetch(`/api/agenda/${token}/inventario`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) {
          setError(body.error);
          return;
        }
        setProductos(body.productos);
        setResumen(body.resumen);
      })
      .catch(() => setError("No se pudo cargar el inventario"));
  }, [token]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">Inventario</h1>
          <p className="text-sm text-mist">Administra tus productos, precios y existencias.</p>
        </div>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setImportando(true)}
            className="flex items-center gap-1.5 rounded-xl border border-edge bg-card px-4 py-2.5 text-sm font-medium text-fg hover:bg-ink-2"
          >
            <Upload className="size-4" /> Importar Excel
          </button>
          <a
            href="/plantillas/Plantilla_Inventario_AMORE.xlsx"
            download
            className="flex items-center gap-1.5 rounded-xl border border-edge bg-card px-4 py-2.5 text-sm font-medium text-fg hover:bg-ink-2"
          >
            <Download className="size-4" /> Descargar plantilla
          </a>
          <button
            type="button"
            onClick={() => setModal({ modo: "crear" })}
            className="flex items-center gap-1.5 rounded-xl bg-lime px-4 py-2.5 text-sm font-medium text-lime-fg hover:bg-lime-hover"
          >
            <Plus className="size-4" /> Nuevo producto
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {resumen && (
        <div className="grid grid-cols-4 gap-3">
          <IndicadorCard etiqueta="Total productos" valor={resumen.total} />
          <IndicadorCard etiqueta="Productos activos" valor={resumen.activos} />
          <IndicadorCard etiqueta="Productos agotados" valor={resumen.agotados} tono={resumen.agotados > 0 ? "danger" : undefined} />
          <IndicadorCard etiqueta="Unidades en inventario" valor={resumen.unidades} />
        </div>
      )}

      <div className="rounded-2xl border border-edge bg-card shadow-sm">
        {!productos && !error ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : productos && productos.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <ShoppingBag className="size-6 text-mist" />
            <p className="mt-2 text-sm text-mist">Todavía no tienes productos creados.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-mist">
                <th className="px-5 py-3 font-medium">Foto</th>
                <th className="px-5 py-3 font-medium">Producto</th>
                <th className="px-5 py-3 font-medium">Categoría</th>
                <th className="px-5 py-3 font-medium">Precio</th>
                <th className="px-5 py-3 font-medium">Stock</th>
                <th className="px-5 py-3 font-medium">Estado</th>
                <th className="px-5 py-3 font-medium">Actualizado</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {productos?.map((p) => {
                const estado = estadoProducto(p);
                return (
                  <tr key={p.id}>
                    <td className="px-5 py-3">
                      <div className="flex size-10 items-center justify-center overflow-hidden rounded-lg border border-edge bg-lime-soft">
                        {p.fotoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- URL dinámica de Storage
                          <img src={p.fotoUrl} alt={p.nombre} className="size-full object-cover" />
                        ) : (
                          <ShoppingBag className="size-4 text-lime-text/50" strokeWidth={1.25} />
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 font-medium text-fg">{p.nombre}</td>
                    <td className="px-5 py-3 text-fg">{p.categoria ?? "—"}</td>
                    <td className="px-5 py-3 text-fg">{formatearPrecioCop(p.precio)}</td>
                    <td className="px-5 py-3 text-fg">{p.stock}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${estado.clase}`}>{estado.texto}</span>
                    </td>
                    <td className="px-5 py-3 text-fg">{new Date(p.updatedAt).toLocaleDateString("es-CO")}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setModal({ modo: "editar", producto: p })}
                        aria-label="Editar"
                        className="flex size-8 items-center justify-center rounded-lg text-mist hover:bg-ink-2 hover:text-fg"
                      >
                        <Pencil className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <ProductoModal
          token={token}
          producto={modal.modo === "editar" ? modal.producto : null}
          onClose={() => setModal(null)}
          onGuardado={() => {
            setModal(null);
            recargar();
          }}
        />
      )}

      {importando && (
        <ImportarInventarioModal
          token={token}
          onClose={() => setImportando(false)}
          onImportado={() => {
            recargar();
          }}
        />
      )}
    </div>
  );
}

function IndicadorCard({ etiqueta, valor, tono }: { etiqueta: string; valor: number; tono?: "danger" }) {
  return (
    <div className="rounded-2xl border border-edge bg-card p-4 shadow-sm">
      <p className={`text-2xl font-semibold ${tono === "danger" && valor > 0 ? "text-danger-text" : "text-fg"}`}>{valor}</p>
      <p className="mt-0.5 text-xs text-mist">{etiqueta}</p>
    </div>
  );
}
