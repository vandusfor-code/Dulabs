"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, Plus, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { CatalogCategory, CatalogProduct } from "@/lib/catalogo/domain";
import { emptyProductForm, toProductDraft, validateProductForm, type ProductFormErrors, type ProductFormState } from "@/lib/catalogo/form";
import type { UploadStage } from "@/lib/catalogo-client";
import { ProductFields, ReferenceField } from "@/components/dashboard/catalogo/ProductFields";
import { ImageDropzone, usePickedImage } from "@/components/dashboard/catalogo/ImageDropzone";
import { ReferenceTag, actionBtn, cn, formatPrice, primaryBtn, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";

type Fase = "editando" | "guardando" | "subiendo" | "listo";

export default function NuevoProductoPage() {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useCatalogToast();
  const { client, canWrite, ready } = useCatalogAccess();

  const [form, setForm] = useState<ProductFormState>(emptyProductForm);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [intentado, setIntentado] = useState(false);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [picked, pick] = usePickedImage();
  const [fase, setFase] = useState<Fase>("editando");
  const [etapa, setEtapa] = useState<UploadStage | null>(null);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [errorFoto, setErrorFoto] = useState<string | null>(null);
  const [creado, setCreado] = useState<CatalogProduct | null>(null);
  const nombreRef = useRef<HTMLDivElement>(null);

  // Solo admin crea productos (el backend lo exige igual).
  useEffect(() => {
    if (ready && !canWrite) router.replace("/dashboard/catalogo");
  }, [ready, canWrite, router]);

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

  const cambiar = (next: ProductFormState) => {
    setForm(next);
    if (intentado) setErrors(validateProductForm(next));
  };

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (!client || fase !== "editando") return;
    setIntentado(true);
    const errs = validateProductForm(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      nombreRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }

    setErrorServidor(null);
    setErrorFoto(null);
    setFase("guardando");
    const r = await client.createProduct(toProductDraft(form));
    if (!r.ok) {
      setErrorServidor(r.error.message);
      setFase("editando");
      return;
    }
    let producto = r.data.product;

    if (picked) {
      setFase("subiendo");
      const subida = await client.uploadImage(producto.id, picked.file, { makePrimary: true, onStage: setEtapa });
      setEtapa(null);
      if (subida.ok) {
        producto = { ...producto, primaryImage: { url: subida.data.image.url, thumbUrl: subida.data.image.thumbUrl } };
      } else {
        // El producto YA existe con su referencia: nunca se pierde por un fallo de la foto.
        setErrorFoto(subida.error.message);
      }
    }

    setCreado(producto);
    setFase("listo");
    toast(t(`Producto registrado · ${producto.reference}`, `Product registered · ${producto.reference}`));
  };

  const crearOtro = () => {
    // Se conserva la categoría: acelera la carga de muchas piezas de la misma línea.
    setForm({ ...emptyProductForm(), categoryId: form.categoryId });
    setErrors({});
    setIntentado(false);
    setCreado(null);
    setErrorFoto(null);
    pick(null);
    setFase("editando");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const ocupado = fase === "guardando" || fase === "subiendo";
  const textoEtapa =
    etapa === "preparing" ? t("Optimizando foto…", "Optimizing photo…") : etapa === "uploading" ? t("Subiendo foto…", "Uploading photo…") : etapa === "confirming" ? t("Verificando foto…", "Verifying photo…") : null;

  if (fase === "listo" && creado) {
    return (
      <div className="pb-16">
        <div className="px-4 pt-10 md:px-8">
          <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-edge bg-card">
            <div className="flex flex-col items-center px-6 pb-6 pt-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-lime text-lime-fg motion-safe:animate-[catalogo-pop_420ms_cubic-bezier(0.16,1,0.3,1)]">
                <Check className="size-7" strokeWidth={2.5} />
              </div>
              <h1 className="mt-5 text-xl font-semibold tracking-tight text-fg">{t("Producto registrado", "Product registered")}</h1>
              <p className="mt-1 text-sm text-mist">{t("DuLabs le asignó su referencia:", "DuLabs assigned its reference:")}</p>
              <div className="mt-3">
                <ReferenceTag reference={creado.reference} copyable size="lg" />
              </div>
            </div>

            <div className="mx-6 flex items-center gap-4 rounded-xl border border-edge bg-ink-2/60 p-3">
              <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-ink-2">
                {picked && !errorFoto ? (
                  // eslint-disable-next-line @next/next/no-img-element -- vista previa local de la foto recién subida
                  <img src={picked.url} alt="" className="size-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium text-fg">{creado.name}</p>
                <p className="mt-0.5 text-xs text-mist">
                  {t("Detal", "Retail")} <span className="font-medium tabular-nums text-fg">{formatPrice(creado.pricing.retail)}</span>
                  {creado.pricing.wholesale !== null && (
                    <>
                      {" · "}
                      {t("Mayor", "Wholesale")} <span className="font-medium tabular-nums text-fg">{formatPrice(creado.pricing.wholesale)}</span>
                    </>
                  )}
                </p>
              </div>
            </div>

            {errorFoto && (
              <p className="mx-6 mt-3 flex items-start gap-2 rounded-lg border border-warning-text/30 bg-warning px-3 py-2.5 text-xs text-warning-text">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t("El producto se guardó, pero la foto no se pudo subir: ", "The product was saved, but the photo could not be uploaded: ")}
                  {errorFoto} {t("Puedes agregarla desde el producto.", "You can add it from the product page.")}
                </span>
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2 border-t border-edge bg-ink-2/40 px-6 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={crearOtro} className={cn(actionBtn, "justify-center")}>
                <Plus className="size-4" />
                {t("Crear otro", "Create another")}
              </button>
              <Link href={`/dashboard/catalogo/${creado.id}`} className={cn(primaryBtn, "justify-center")}>
                {t("Ver producto", "View product")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-16">
      <PageHeader eyebrow={t("Catálogo", "Catalog")} title={t("Nuevo producto", "New product")}>
        <Link href="/dashboard/catalogo" className={actionBtn}>
          <ArrowLeft className="size-4" />
          {t("Volver", "Back")}
        </Link>
      </PageHeader>

      <form onSubmit={guardar} noValidate className="px-4 pt-6 md:px-8">
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
          <div className="space-y-3">
            <ImageDropzone picked={picked} onPick={pick} disabled={ocupado} busyLabel={fase === "subiendo" ? textoEtapa : null} />
            <p className="px-1 text-xs text-mist">
              {t("La foto real es la que verá tu cliente y la que enviará tu agente por WhatsApp.", "The real photo is what your customer sees and what your agent will send on WhatsApp.")}
            </p>
          </div>

          <div ref={nombreRef} className="space-y-5 rounded-2xl border border-edge bg-card p-5 md:p-6">
            <ReferenceField reference={null} />
            <ProductFields
              value={form}
              onChange={cambiar}
              errors={errors}
              categories={categories}
              onCategoryCreated={(c) => setCategories((all) => [...all, c].sort((a, b) => a.name.localeCompare(b.name, "es")))}
              client={client}
              disabled={ocupado}
            />

            {errorServidor && <p className="rounded-lg border border-danger-text/30 bg-danger px-3 py-2.5 text-sm text-danger-text">{errorServidor}</p>}

            <div className="flex flex-col-reverse gap-2 border-t border-edge pt-5 sm:flex-row sm:justify-end">
              <Link href="/dashboard/catalogo" className={cn(actionBtn, "justify-center", ocupado && "pointer-events-none opacity-50")}>
                {t("Cancelar", "Cancel")}
              </Link>
              <button type="submit" disabled={ocupado || !client} className={cn(primaryBtn, "justify-center sm:min-w-44")}>
                {ocupado && <Loader2 className="size-4 animate-spin" />}
                {fase === "guardando" ? t("Guardando producto…", "Saving product…") : fase === "subiendo" ? t("Subiendo foto…", "Uploading photo…") : t("Guardar producto", "Save product")}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
