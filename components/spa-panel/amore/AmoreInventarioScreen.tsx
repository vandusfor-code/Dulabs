"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Plus, Pencil, ShoppingBag, Upload, Download, Receipt } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { ProductoModal } from "@/components/spa-panel/modals/ProductoModal";
import { ImportarInventarioModal } from "@/components/spa-panel/modals/ImportarInventarioModal";
import { VentaModal } from "@/components/spa-panel/modals/VentaModal";
import { AmoreScreenTitle, AmoreCard, AmoreSearchInput, AmoreBadge, AmorePrimaryButton, AmoreSecondaryButton, AmoreEmptyState } from "./ui";
import type { ProductoInventarioUI } from "@/app/amoreweb/(app)/inventario/page";

// AMORE (autorizado) — Inventario móvil, MISMO Design System de la Fase 5
// (AmoreCard/AmoreScreenTitle/AmoreSearchInput...) que ya usa
// AmoreServiciosScreen, conectado a la MISMA API real que ya usa Inventario
// desktop (app/amoreweb/(app)/inventario/page.tsx) -- web y móvil consultan
// y modifican EXACTAMENTE los mismos productos, nunca una segunda fuente de
// verdad. "+ Nuevo"/"Editar"/"Importar Excel" reutilizan tal cual los
// mismos modales reales que ya usa la versión web (ProductoModal,
// ImportarInventarioModal) -- solo se reskinean por estar dentro de
// .amore-scope, cero componente nuevo para esas 3 funciones. "Registrar
// venta" (NUEVO) abre VentaModal -- ver ese archivo para el flujo completo.
function estadoProducto(p: ProductoInventarioUI): { texto: string; tono: "success" | "neutral" | "danger" } {
  if (p.stock === 0) return { texto: "Agotado", tono: "danger" };
  if (!p.activo) return { texto: "Inactivo", tono: "neutral" };
  return { texto: "Activo", tono: "success" };
}

export function AmoreInventarioScreen() {
  const { token } = useAgenda();
  const [productos, setProductos] = useState<ProductoInventarioUI[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [editando, setEditando] = useState<ProductoInventarioUI | null | "nuevo">(null);
  const [importando, setImportando] = useState(false);
  const [vendiendo, setVendiendo] = useState(false);

  const cargarProductos = useCallback(() => {
    fetch(`/api/agenda/${token}/inventario`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) {
          setError(body.error);
          return;
        }
        setProductos(body.productos);
      })
      .catch(() => setError("No se pudo cargar el inventario"));
  }, [token]);

  useEffect(() => {
    cargarProductos();
  }, [cargarProductos]);

  const categorias = useMemo(
    () => Array.from(new Set((productos ?? []).map((p) => p.categoria).filter((c): c is string => Boolean(c)))),
    [productos],
  );

  const filtrados = useMemo(() => {
    if (!productos) return null;
    const texto = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      if (categoria && p.categoria !== categoria) return false;
      if (texto && !p.nombre.toLowerCase().includes(texto)) return false;
      return true;
    });
  }, [productos, busqueda, categoria]);

  const productosVendibles = useMemo(() => (productos ?? []).filter((p) => p.activo && p.stock > 0), [productos]);

  return (
    <div className="flex flex-col gap-5">
      <AmoreScreenTitle
        title="Inventario"
        subtitle="Productos, precios y existencias reales"
        action={
          <AmorePrimaryButton onClick={() => setEditando("nuevo")}>
            <Plus className="size-4" /> Nuevo
          </AmorePrimaryButton>
        }
      />

      <AmoreSecondaryButton onClick={() => setVendiendo(true)} className="w-full" disabled={productosVendibles.length === 0}>
        <Receipt className="size-4" /> Registrar venta
      </AmoreSecondaryButton>

      {productos && productos.length > 0 && (
        <AmoreSearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar producto..." icon={<Search className="size-4 shrink-0 text-mist" />} />
      )}

      {categorias.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setCategoria(null)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium ${
              categoria === null ? "border-lime/40 bg-lime-soft text-lime-text" : "border-edge bg-card text-mist"
            }`}
          >
            Todas
          </button>
          {categorias.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategoria(c)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium ${
                categoria === c ? "border-lime/40 bg-lime-soft text-lime-text" : "border-edge bg-card text-mist"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!productos && !error ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-mist" />
        </div>
      ) : filtrados && filtrados.length === 0 ? (
        <AmoreEmptyState
          icono={<ShoppingBag className="size-6 text-mist" />}
          mensaje={productos && productos.length === 0 ? "Todavía no tienes productos creados." : "Ningún producto coincide con la búsqueda."}
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtrados?.map((p) => {
            const estado = estadoProducto(p);
            return (
              <AmoreCard key={p.id} className="flex items-center gap-3 p-3.5">
                <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-edge bg-lime-soft">
                  {p.fotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL dinámica de Storage
                    <img src={p.fotoUrl} alt={p.nombre} className="size-full object-cover" />
                  ) : (
                    <ShoppingBag className="size-4 text-lime-text/50" strokeWidth={1.25} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{p.nombre}</p>
                  <p className="truncate text-xs text-mist">
                    {p.categoria ? `${p.categoria} · ` : ""}
                    {formatearPrecioCop(p.precio)} · Stock {p.stock}
                  </p>
                </div>
                <AmoreBadge tono={estado.tono}>{estado.texto}</AmoreBadge>
                <button
                  type="button"
                  onClick={() => setEditando(p)}
                  aria-label="Editar"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-mist active:bg-ink-2"
                >
                  <Pencil className="size-4" />
                </button>
              </AmoreCard>
            );
          })}
        </div>
      )}

      <div className="flex gap-2.5">
        <AmoreSecondaryButton onClick={() => setImportando(true)} className="flex-1">
          <Upload className="size-4" /> Importar Excel
        </AmoreSecondaryButton>
        <a
          href="/plantillas/Plantilla_Inventario_AMORE.xlsx"
          download
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-lime-soft px-4 py-3 text-sm font-medium text-lime-text"
        >
          <Download className="size-4" /> Plantilla
        </a>
      </div>

      {editando && (
        <ProductoModal
          token={token}
          producto={editando === "nuevo" ? null : editando}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            cargarProductos();
          }}
        />
      )}

      {importando && (
        <ImportarInventarioModal
          token={token}
          onClose={() => setImportando(false)}
          onImportado={() => {
            cargarProductos();
          }}
        />
      )}

      {vendiendo && (
        <VentaModal
          token={token}
          productos={productosVendibles}
          onClose={() => setVendiendo(false)}
          onVendido={() => {
            setVendiendo(false);
            cargarProductos();
          }}
        />
      )}
    </div>
  );
}
