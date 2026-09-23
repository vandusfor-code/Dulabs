"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, TriangleAlert, X } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { CatalogCategory, CatalogProduct } from "@/lib/catalogo/domain";
import { emptyProductForm, toProductDraft, validateProductForm, type ProductFormErrors, type ProductFormState } from "@/lib/catalogo/form";
import type { UploadStage } from "@/lib/catalogo-client";
import { ProductFields, ReferenceField } from "@/components/dashboard/catalogo/ProductFields";
import { ImageDropzone, usePickedImage } from "@/components/dashboard/catalogo/ImageDropzone";
import { ProductImage, actionBtn, cn, formatPrice, primaryBtn, useCatalogAccess } from "@/components/dashboard/catalogo/ui";

type Fase = "editando" | "guardando" | "subiendo";

/** Lo que muestra la confirmación del último producto registrado. */
interface Registrado {
  product: CatalogProduct;
  errorFoto: string | null;
  /** Cambia en cada registro: reinicia la animación y el temporizador. */
  n: number;
}

/** Tiempo de la confirmación antes de retirarse sola (si no hubo problema con la foto). */
const CONFIRMACION_MS = 6000;

export default function NuevoProductoPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { client, canWrite, ready } = useCatalogAccess();

  const [form, setForm] = useState<ProductFormState>(emptyProductForm);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [intentado, setIntentado] = useState(false);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [picked, pick] = usePickedImage();
  const [fase, setFase] = useState<Fase>("editando");
  const [etapa, setEtapa] = useState<UploadStage | null>(null);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [registrado, setRegistrado] = useState<Registrado | null>(null);
  const nombreRef = useRef<HTMLDivElement>(null);

  // La confirmación se retira sola; si la foto falló se queda hasta cerrarla (hay algo que hacer).
  useEffect(() => {
    if (!registrado || registrado.errorFoto) return;
    const t = window.setTimeout(() => setRegistrado(null), CONFIRMACION_MS);
    return () => window.clearTimeout(t);
  }, [registrado]);

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
    setFase("guardando");
    const r = await client.createProduct(toProductDraft(form));
    if (!r.ok) {
      setErrorServidor(r.error.message);
      setFase("editando");
      return;
    }
    let producto = r.data.product;
    let errorFoto: string | null = null;

    if (picked) {
      setFase("subiendo");
      const subida = await client.uploadImage(producto.id, picked.file, { makePrimary: true, onStage: setEtapa });
      setEtapa(null);
      if (subida.ok) {
        producto = { ...producto, primaryImage: { url: subida.data.image.url, thumbUrl: subida.data.image.thumbUrl } };
      } else {
        // El producto YA existe con su referencia: nunca se pierde por un fallo de la foto.
        errorFoto = subida.error.message;
      }
    }

    // Confirmación + formulario limpio para seguir cargando. Se conserva la
    // categoría: acelera la carga de muchas piezas de la misma línea.
    setRegistrado((prev) => ({ product: producto, errorFoto, n: (prev?.n ?? 0) + 1 }));
    setForm({ ...emptyProductForm(), categoryId: form.categoryId });
    setErrors({});
    setIntentado(false);
    pick(null);
    setFase("editando");
    window.scrollTo({ top: 0, behavior: "smooth" });
    nombreRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  };

  const ocupado = fase === "guardando" || fase === "subiendo";
  const textoEtapa =
    etapa === "preparing" ? t("Optimizando foto…", "Optimizing photo…") : etapa === "uploading" ? t("Subiendo foto…", "Uploading photo…") : etapa === "confirming" ? t("Verificando foto…", "Verifying photo…") : null;

  return (
    <div className="pb-16">
      <PageHeader eyebrow={t("Catálogo", "Catalog")} title={t("Nuevo producto", "New product")}>
        <Link href="/dashboard/catalogo" className={actionBtn}>
          <ArrowLeft className="size-4" />
          {t("Volver", "Back")}
        </Link>
      </PageHeader>

      {registrado && <ConfirmacionRegistro key={registrado.n} registrado={registrado} onClose={() => setRegistrado(null)} />}

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

            {errorServidor && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">{errorServidor}</p>}

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

/**
 * Confirmación del producto recién registrado: referencia + nombre, sin sacar
 * al usuario del formulario. Se retira sola (con barra de tiempo) salvo que la
 * foto haya fallado, que queda visible con el acceso al producto.
 */
function ConfirmacionRegistro({ registrado, onClose }: { registrado: Registrado; onClose: () => void }) {
  const { t } = useI18n();
  const { product, errorFoto } = registrado;
  return (
    <div className="px-4 pt-6 md:px-8">
      <div
        role="status"
        aria-live="polite"
        className="relative mx-auto max-w-5xl overflow-hidden rounded-2xl border border-lime/30 bg-card shadow-lg shadow-black/5 motion-safe:animate-[catalogo-toast-in_220ms_ease-out]"
      >
        <div className="flex items-center gap-3 p-3 pr-2 sm:gap-4 sm:p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lime text-lime-fg motion-safe:animate-[catalogo-pop_420ms_cubic-bezier(0.16,1,0.3,1)]">
            <Check className="size-5" strokeWidth={2.5} />
          </div>
          <ProductImage src={product.primaryImage?.thumbUrl ?? null} alt="" className="hidden size-12 shrink-0 rounded-lg sm:flex" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">{t("Producto registrado", "Product registered")}</p>
            <p className="mt-0.5 truncate text-sm text-mist">
              <span className="font-mono font-medium text-fg">{product.reference}</span> · {product.name}
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-mist">
              {formatPrice(product.pricing.retail)} · {product.stock === 1 ? t("1 unidad", "1 unit") : t(`${product.stock} unidades`, `${product.stock} units`)}
            </p>
            <Link href={`/dashboard/catalogo/${product.id}`} className="mt-1 inline-block py-1 text-xs font-medium text-lime-text sm:hidden">
              {t("Ver producto", "View product")}
            </Link>
          </div>
          <Link href={`/dashboard/catalogo/${product.id}`} className="hidden shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-lime-text transition-colors hover:bg-ink-2 sm:block">
            {t("Ver producto", "View product")}
          </Link>
          <button type="button" onClick={onClose} className="flex size-10 shrink-0 items-center justify-center rounded-lg text-mist transition-colors hover:bg-ink-2 hover:text-fg" aria-label={t("Cerrar", "Close")}>
            <X className="size-4" />
          </button>
        </div>
        {errorFoto && (
          <p className="mx-3 mb-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs text-amber-400 sm:mx-4 sm:mb-4">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {t("El producto se guardó, pero la foto no se pudo subir: ", "The product was saved, but the photo could not be uploaded: ")}
              {errorFoto}{" "}
              <Link href={`/dashboard/catalogo/${product.id}`} className="font-medium underline underline-offset-2">
                {t("Agrégala desde el producto.", "Add it from the product page.")}
              </Link>
            </span>
          </p>
        )}
        {!errorFoto && (
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-lime/60 motion-safe:animate-[catalogo-cuenta_linear_forwards]"
            style={{ animationDuration: `${CONFIRMACION_MS}ms` }}
          />
        )}
      </div>
    </div>
  );
}
