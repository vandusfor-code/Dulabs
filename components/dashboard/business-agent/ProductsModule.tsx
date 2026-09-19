"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDashboard } from "@/lib/dashboard-session";
import {
  createBusinessAgentProduct,
  deleteBusinessAgentProduct,
  listBusinessAgentProducts,
  updateBusinessAgentProduct,
  type ProductInput,
} from "@/lib/business-agent-client";
import type { BusinessAgentProduct } from "@/lib/business-agent-products";
import { actionBtn, Field, inputCls, primaryBtn, SectionCard } from "@/components/dashboard/business-agent/ui";
import { Pill } from "@/components/dashboard/shell/ui";

/**
 * Módulo de productos estructurados (dulabs_inventario_productos) del Business Agent (R6).
 * CRUD inmediato contra la API (mismo patrón que ServicesModule). El precio y el stock quedan
 * en datos estructurados: la cotización los lee y CALCULA en el servidor -- el agente no los
 * inventa. Se muestra solo cuando el negocio eligió "Usar productos" en el catálogo.
 */
function emptyDraft(): ProductInput {
  return { nombre: "", categoria: "", descripcion: "", precio: 0, stock: 0, activo: true };
}

function formatCOP(precio: number): string {
  return `$${precio.toLocaleString("es-CO")}`;
}

export function ProductsModule() {
  const { t } = useI18n();
  const { session } = useDashboard();
  const [products, setProducts] = useState<BusinessAgentProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<ProductInput>(emptyDraft());

  const cargar = useCallback(async () => {
    if (!session) return;
    const r = await listBusinessAgentProducts({ accessToken: session.access_token });
    if (r.ok) {
      setProducts(r.data.products);
      setError(null);
    } else {
      setError(r.error.message);
    }
  }, [session]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const abrirNuevo = () => {
    setDraft(emptyDraft());
    setEditingId("new");
    setError(null);
  };
  const abrirEditar = (p: BusinessAgentProduct) => {
    setDraft({ nombre: p.nombre, categoria: p.categoria ?? "", descripcion: p.descripcion ?? "", precio: p.precio, stock: p.stock, activo: p.activo });
    setEditingId(p.id);
    setError(null);
  };

  const guardar = async () => {
    if (!session || !editingId) return;
    setBusy(true);
    setError(null);
    const input: ProductInput = {
      nombre: draft.nombre.trim(),
      categoria: (draft.categoria || "").trim() || null,
      descripcion: (draft.descripcion || "").trim() || null,
      precio: Number(draft.precio),
      stock: Number(draft.stock ?? 0),
      activo: draft.activo ?? true,
    };
    const r =
      editingId === "new"
        ? await createBusinessAgentProduct({ accessToken: session.access_token, input })
        : await updateBusinessAgentProduct({ accessToken: session.access_token, id: editingId, input });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setEditingId(null);
    await cargar();
  };

  const eliminar = async (p: BusinessAgentProduct) => {
    if (!session) return;
    if (!window.confirm(t(`¿Eliminar el producto "${p.nombre}"?`, `Delete the product "${p.nombre}"?`))) return;
    setBusy(true);
    setError(null);
    const r = await deleteBusinessAgentProduct({ accessToken: session.access_token, id: p.id });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    await cargar();
  };

  const formulario = (
    <div className="space-y-3 rounded-lg border border-edge bg-ink p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Nombre del producto", "Product name")} required>
          <input className={inputCls} value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} placeholder={t("Esmalte rojo", "Red nail polish")} />
        </Field>
        <Field label={t("Categoría (opcional)", "Category (optional)")}>
          <input className={inputCls} value={draft.categoria ?? ""} onChange={(e) => setDraft({ ...draft, categoria: e.target.value })} placeholder={t("Esmaltes", "Polishes")} />
        </Field>
        <Field label={t("Precio (COP)", "Price (COP)")} required>
          <input type="number" min={0} step={500} className={inputCls} value={draft.precio} onChange={(e) => setDraft({ ...draft, precio: Number(e.target.value) })} placeholder="12000" />
        </Field>
        <Field label={t("Stock (unidades)", "Stock (units)")} hint={t("Lo administras tú: el agente avisa si piden más de lo disponible.", "You manage it: the agent warns if more than available is requested.")}>
          <input type="number" min={0} step={1} className={inputCls} value={draft.stock ?? 0} onChange={(e) => setDraft({ ...draft, stock: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label={t("Descripción (opcional)", "Description (optional)")}>
        <textarea className={inputCls} rows={2} value={draft.descripcion ?? ""} onChange={(e) => setDraft({ ...draft, descripcion: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={draft.activo ?? true} onChange={(e) => setDraft({ ...draft, activo: e.target.checked })} />
        {t("Activo (visible para los clientes)", "Active (visible to customers)")}
      </label>
      <div className="flex items-center gap-2">
        <button type="button" onClick={guardar} disabled={busy} className={primaryBtn}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("Guardar producto", "Save product")}
        </button>
        <button type="button" onClick={() => setEditingId(null)} disabled={busy} className={actionBtn}>
          {t("Cancelar", "Cancel")}
        </button>
      </div>
    </div>
  );

  return (
    <SectionCard
      title={t("Productos", "Products")}
      description={t(
        "Los productos que tus clientes pueden consultar y cotizar. El precio queda estructurado y la cotización la calcula el sistema -- el agente nunca inventa precios ni totales.",
        "The products your customers can ask about and get quotes for. Price is stored as structured data and quotes are calculated by the system -- the agent never makes up prices or totals.",
      )}
    >
      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400">{error}</p>}

      {products === null ? (
        <p className="text-sm text-mist">{t("Cargando…", "Loading…")}</p>
      ) : (
        <div className="space-y-3">
          {products.length === 0 && editingId !== "new" && (
            <p className="text-sm text-mist">{t("Todavía no has agregado productos.", "You haven't added any products yet.")}</p>
          )}

          {products.length > 0 && (
            <ul className="space-y-1.5">
              {products.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-fg">{p.nombre}</span>
                      {!p.activo && <Pill tone="neutral">{t("Inactivo", "Inactive")}</Pill>}
                      {p.activo && p.stock === 0 && <Pill tone="neutral">{t("Agotado", "Out of stock")}</Pill>}
                    </div>
                    <p className="text-xs text-mist">
                      {formatCOP(p.precio)} · {t("stock", "stock")} {p.stock}
                      {p.categoria ? ` · ${p.categoria}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => abrirEditar(p)} disabled={busy} className={actionBtn} aria-label={t("Editar", "Edit")}>
                      <Pencil className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => eliminar(p)} disabled={busy} className={actionBtn} aria-label={t("Eliminar", "Delete")}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {editingId !== null ? (
            formulario
          ) : (
            <button type="button" onClick={abrirNuevo} className={actionBtn}>
              <Plus className="size-3.5" /> {t("Agregar producto", "Add product")}
            </button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
