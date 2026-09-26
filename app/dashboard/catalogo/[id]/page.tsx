"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, ImagePlus, Loader2, Power, Star, Trash2 } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { CatalogCategory, CatalogImage, CatalogProductDetail } from "@/lib/catalogo/domain";
import { diffProductForm, productFormFrom, validateProductForm, type ProductFormErrors, type ProductFormState } from "@/lib/catalogo/form";
import type { UploadStage } from "@/lib/catalogo-client";
import { ProductFields, ReferenceField } from "@/components/dashboard/catalogo/ProductFields";
import { ProductImage, StatusBadge, actionBtn, cn, primaryBtn, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";

const MAX_IMAGES = 12;

export default function ProductoPage() {
  const { t } = useI18n();
  const toast = useCatalogToast();
  const { id } = useParams<{ id: string }>();
  const { client, canWrite } = useCatalogAccess();

  const [product, setProduct] = useState<CatalogProductDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [original, setOriginal] = useState<ProductFormState | null>(null);
  const [form, setForm] = useState<ProductFormState | null>(null);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Bloque 29: descargar la foto con la referencia estampada (módulo "marca_referencia" del negocio).
  const marcaReferencia = useDashboard().modulos.includes("marca_referencia");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const aplicar = useCallback((p: CatalogProductDetail, resetForm: boolean) => {
    setProduct(p);
    if (resetForm) {
      const f = productFormFrom(p);
      setOriginal(f);
      setForm(f);
    }
  }, []);

  const recargar = useCallback(
    async (resetForm: boolean) => {
      if (!client || !id) return;
      const r = await client.getProduct(id);
      if (r.ok) aplicar(r.data.product, resetForm);
      else setLoadError(r.error.message);
    },
    [client, id, aplicar],
  );

  useEffect(() => {
    if (!client || !id) return;
    let vivo = true;
    void Promise.all([client.getProduct(id), client.listCategories()]).then(([p, c]) => {
      if (!vivo) return;
      if (p.ok) aplicar(p.data.product, true);
      else setLoadError(p.error.message);
      if (c.ok) setCategories(c.data.categories);
    });
    return () => {
      vivo = false;
    };
  }, [client, id, aplicar]);

  const patch = useMemo(() => (original && form ? diffProductForm(original, form) : {}), [original, form]);
  const dirty = Object.keys(patch).length > 0;
  const images = product?.images ?? [];
  const selected: CatalogImage | null = images.find((i) => i.id === selectedId) ?? images.find((i) => i.isPrimary) ?? images[0] ?? null;
  const readOnly = !canWrite;

  // Un producto que ya controla inventario no puede quedar sin stock; uno legado lo define cuando quiera.
  const reglas = { requireStock: product?.tracksStock ?? true };

  const cambiar = (next: ProductFormState) => {
    setForm(next);
    setErrors(validateProductForm(next, reglas));
  };

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (!client || !form || !product || !dirty || readOnly) return;
    const errs = validateProductForm(form, reglas);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    const r = await client.updateProduct(product.id, patch);
    setSaving(false);
    if (!r.ok) {
      toast(r.error.message, "error");
      return;
    }
    aplicar({ ...r.data.product, images: product.images }, true);
    toast(t("Cambios guardados", "Changes saved"));
  };

  const alternarEstado = async () => {
    if (!client || !product || readOnly) return;
    const next = product.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setTogglingStatus(true);
    const r = await client.updateProduct(product.id, { status: next });
    setTogglingStatus(false);
    if (!r.ok) {
      toast(r.error.message, "error");
      return;
    }
    // Solo cambia el estado: no se pisan ediciones sin guardar del formulario.
    setProduct({ ...product, status: r.data.product.status });
    toast(next === "ACTIVE" ? t("Producto activado", "Product activated") : t("Producto desactivado · ya no aparecerá para tus clientes", "Product deactivated · customers will no longer see it"));
  };

  const subir = async (file: File) => {
    if (!client || !product) return;
    const r = await client.uploadImage(product.id, file, { makePrimary: images.length === 0, onStage: setUploadStage });
    setUploadStage(null);
    if (!r.ok) {
      toast(r.error.message, "error");
      return;
    }
    await recargar(false);
    setSelectedId(r.data.image.id);
    toast(t("Foto agregada", "Photo added"));
  };

  const descargarConReferencia = async (image: CatalogImage) => {
    if (!client || !product) return;
    setDownloading(true);
    const r = await client.downloadMarkedImage(product.id, image.id);
    setDownloading(false);
    if (!r.ok) {
      toast(r.error.message, "error");
      return;
    }
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${product.reference}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const eliminar = async (image: CatalogImage) => {
    if (!client || readOnly) return;
    if (!window.confirm(t("¿Eliminar esta foto?", "Delete this photo?"))) return;
    setDeletingId(image.id);
    const r = await client.deleteImage(image.id);
    setDeletingId(null);
    if (!r.ok) {
      toast(r.error.message, "error");
      return;
    }
    if (selectedId === image.id) setSelectedId(null);
    await recargar(false);
    toast(t("Foto eliminada", "Photo deleted"));
  };

  if (loadError) {
    return (
      <div className="px-4 pt-10 md:px-8">
        <div className="mx-auto max-w-md rounded-2xl border border-edge bg-card p-8 text-center">
          <p className="text-sm font-medium text-fg">{loadError}</p>
          <Link href="/dashboard/catalogo" className={cn(actionBtn, "mx-auto mt-4 w-fit")}>
            <ArrowLeft className="size-4" />
            {t("Volver al catálogo", "Back to catalog")}
          </Link>
        </div>
      </div>
    );
  }

  if (!product || !form) {
    return (
      <div className="px-4 pt-6 md:px-8" aria-busy>
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="aspect-square animate-pulse rounded-2xl bg-ink-2" />
          <div className="space-y-4 rounded-2xl border border-edge bg-card p-6">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-ink-2" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const textoSubida =
    uploadStage === "preparing" ? t("Optimizando…", "Optimizing…") : uploadStage === "uploading" ? t("Subiendo…", "Uploading…") : uploadStage === "confirming" ? t("Verificando…", "Verifying…") : null;

  return (
    <div className="pb-16">
      <PageHeader eyebrow={product.reference} title={product.name}>
        <Link href="/dashboard/catalogo" className={actionBtn}>
          <ArrowLeft className="size-4" />
          {t("Catálogo", "Catalog")}
        </Link>
        {!readOnly && (
          <button type="button" onClick={alternarEstado} disabled={togglingStatus} className={actionBtn}>
            {togglingStatus ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
            {product.status === "ACTIVE" ? t("Desactivar", "Deactivate") : t("Activar", "Activate")}
          </button>
        )}
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
          {/* Galería */}
          <section aria-label={t("Fotografías", "Photos")} className="space-y-3">
            <div className="relative overflow-hidden rounded-2xl border border-edge bg-card">
              <ProductImage src={selected?.url ?? product.primaryImage?.url} alt={product.name} fit="contain" className="aspect-square w-full" />
              <div className="absolute left-3 top-3">
                <StatusBadge status={product.status} />
              </div>
            </div>
            {marcaReferencia && selected && (
              <button type="button" onClick={() => descargarConReferencia(selected)} disabled={downloading} className={cn(actionBtn, "w-full justify-center")}>
                {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                {t("Descargar con referencia", "Download with reference")}
              </button>
            )}

            <div className="grid grid-cols-5 gap-2">
              {images.map((img) => (
                <div key={img.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelectedId(img.id)}
                    className={cn(
                      "block w-full overflow-hidden rounded-lg border-2 transition-colors",
                      selected?.id === img.id ? "border-lime" : "border-transparent hover:border-edge",
                    )}
                    aria-label={img.isPrimary ? t("Foto principal", "Main photo") : t("Ver foto", "View photo")}
                  >
                    <ProductImage src={img.thumbUrl} alt="" className="aspect-square w-full" />
                  </button>
                  {img.isPrimary && (
                    <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white" title={t("Principal", "Main")}>
                      <Star className="size-2.5 fill-current" />
                    </span>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => eliminar(img)}
                      disabled={deletingId === img.id}
                      className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-edge bg-card text-mist opacity-0 shadow-sm transition-opacity hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-100"
                      aria-label={t("Eliminar foto", "Delete photo")}
                    >
                      {deletingId === img.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                    </button>
                  )}
                </div>
              ))}

              {!readOnly && images.length < MAX_IMAGES && (
                <>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void subir(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={uploadStage !== null}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-edge text-mist transition-colors hover:border-lime/50 hover:text-fg disabled:cursor-wait"
                    aria-label={t("Agregar foto", "Add photo")}
                  >
                    {uploadStage ? <Loader2 className="size-4 animate-spin text-lime-text" /> : <ImagePlus className="size-4" />}
                    <span className="px-1 text-center text-[10px] leading-tight">{textoSubida ?? t("Agregar", "Add")}</span>
                  </button>
                </>
              )}
            </div>
          </section>

          {/* Datos */}
          <form onSubmit={guardar} noValidate className="space-y-5 rounded-2xl border border-edge bg-card p-5 md:p-6">
            <ReferenceField reference={product.reference} />
            <ProductFields
              value={form}
              onChange={cambiar}
              errors={errors}
              categories={categories}
              onCategoryCreated={(c) => setCategories((all) => [...all, c].sort((a, b) => a.name.localeCompare(b.name, "es")))}
              client={client}
              disabled={readOnly || saving}
              stockUntracked={!product.tracksStock}
            />

            {readOnly ? (
              <p className="border-t border-edge pt-4 text-xs text-mist">{t("Solo un administrador puede editar el catálogo.", "Only an admin can edit the catalog.")}</p>
            ) : (
              <div className="flex flex-col-reverse items-stretch gap-3 border-t border-edge pt-5 sm:flex-row sm:items-center sm:justify-between">
                <span className={cn("text-xs transition-opacity", dirty ? "text-amber-400 opacity-100" : "opacity-0")} aria-live="polite">
                  {dirty ? t("Tienes cambios sin guardar", "You have unsaved changes") : ""}
                </span>
                <div className="flex gap-2">
                  {dirty && (
                    <button type="button" onClick={() => {
                        if (original) setForm(original);
                        setErrors({});
                      }} disabled={saving} className={cn(actionBtn, "justify-center")}>
                      {t("Descartar", "Discard")}
                    </button>
                  )}
                  <button type="submit" disabled={!dirty || saving} className={cn(primaryBtn, "justify-center sm:min-w-40")}>
                    {saving && <Loader2 className="size-4 animate-spin" />}
                    {saving ? t("Guardando…", "Saving…") : t("Guardar cambios", "Save changes")}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
