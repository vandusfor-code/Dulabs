"use client";

/**
 * Elegir las fotos de UN producto del preview: cuando hay dudas ("Tenemos
 * varias imágenes posibles"), cuando no se encontró ninguna o para corregir
 * la detección automática. El orden de selección es el orden final: la
 * primera es la principal. Lo elegido se guarda como ids exactos en la fila
 * (RawRow.photos) y el SERVIDOR vuelve a analizarla.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ImageOff, Search, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { naturalCompare } from "@/lib/catalogo/import/asociacion";
import { IMPORT_LIMITS } from "@/lib/catalogo/import/limites";
import type { AnalyzedRow, ImageInfo } from "@/lib/catalogo/import/types";
import { actionBtn, cn, inputCls, primaryBtn } from "@/components/dashboard/catalogo/ui";

/** Miniaturas por pantalla: cada una es la foto original (blob:), no conviene pintar cientos. */
const PAGE = 48;

export function SelectorFotos({
  row,
  images,
  unused,
  photoUrl,
  onSave,
  onClose,
}: {
  row: AnalyzedRow;
  /** Todas las fotos seleccionadas. */
  images: readonly ImageInfo[];
  /** Ids que ninguna fila usa todavía (se muestran primero). */
  unused: readonly string[];
  photoUrl: (id: string) => string | null;
  /** ids en orden ([] = sin foto) o null = volver a lo automático / la columna «imagenes». */
  onSave: (ids: string[] | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string[]>(() => row.images.map((m) => m.file).filter((f): f is string => f !== null));
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  // Sin cleanup que llame close(): dispararía onClose (y en modo estricto
  // cerraría el selector apenas abre). Al desmontarse, el modal termina solo.
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const valid = useMemo(() => images.filter((i) => i.problem === null), [images]);
  const byId = useMemo(() => new Map(images.map((i) => [i.id, i])), [images]);
  const candidates = useMemo(() => row.imageCandidates.map((id) => byId.get(id)).filter((i): i is ImageInfo => Boolean(i && i.problem === null)), [row.imageCandidates, byId]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      const words = q.split(/\s+/);
      return valid.filter((i) => words.every((w) => i.id.toLowerCase().includes(w))).sort((a, b) => naturalCompare(a.id, b.id));
    }
    // Sin búsqueda: primero las que nadie usa, luego el resto.
    const free = new Set(unused);
    return [...valid].sort((a, b) => Number(free.has(b.id)) - Number(free.has(a.id)) || naturalCompare(a.id, b.id));
  }, [query, valid, unused]);

  const full = selected.length >= IMPORT_LIMITS.imagesPerProduct;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= IMPORT_LIMITS.imagesPerProduct ? s : [...s, id]));
  const name = row.product?.name ?? row.values.name ?? t(`Fila ${row.row}`, `Row ${row.row}`);
  const manual = row.photos !== undefined;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      aria-labelledby="selector-fotos-titulo"
      className="m-auto h-[min(92dvh,760px)] w-[min(100vw-1rem,920px)] max-w-none overflow-hidden rounded-2xl border border-edge bg-card p-0 text-fg shadow-2xl backdrop:bg-black/60"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start gap-3 border-b border-edge px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="selector-fotos-titulo" className="truncate text-base font-semibold">
              {t(`Fotos de «${name}»`, `Photos for «${name}»`)}
            </h2>
            <p className="text-xs text-mist">{t("Tócalas en orden: la primera es la principal y las demás van a la galería.", "Tap them in order: the first is the main photo, the rest go to the gallery.")}</p>
          </div>
          <button type="button" onClick={onClose} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-mist hover:bg-ink-2 hover:text-fg" aria-label={t("Cerrar", "Close")}>
            <X className="size-4" />
          </button>
        </header>

        {/* Elegidas, en orden */}
        <div className="border-b border-edge px-5 py-3">
          {selected.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-mist">
              <ImageOff className="size-4" />
              {t("Sin fotos elegidas: el producto se creará sin foto.", "No photos chosen: the product will be created without a photo.")}
            </p>
          ) : (
            <ol className="flex gap-2 overflow-x-auto pb-1" aria-label={t("Fotos elegidas", "Chosen photos")}>
              {selected.map((id, i) => (
                <li key={id} className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-lime/50 bg-ink-2">
                  <Thumb url={photoUrl(id)} />
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">{i === 0 ? t("Principal", "Main") : i + 1}</span>
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-white"
                    aria-label={t(`Quitar ${byId.get(id)?.name ?? id}`, `Remove ${byId.get(id)?.name ?? id}`)}
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {candidates.length > 0 && !query && (
            <section className="mb-5">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                <Sparkles className="size-3.5" />
                {t("Posibles para este producto", "Possible matches for this product")}
              </h3>
              <Grid items={candidates} selected={selected} full={full} photoUrl={photoUrl} onToggle={toggle} />
            </section>
          )}

          <label className="relative mb-3 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              className={cn(inputCls, "pl-9")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder={t("Buscar por nombre de archivo o carpeta", "Search by file or folder name")}
              aria-label={t("Buscar fotos", "Search photos")}
            />
          </label>
          {list.length === 0 ? (
            <p className="py-8 text-center text-sm text-mist">{t("Ninguna foto coincide.", "No photo matches.")}</p>
          ) : (
            <>
              <Grid items={list.slice(0, limit)} selected={selected} full={full} photoUrl={photoUrl} onToggle={toggle} />
              {list.length > limit && (
                <button type="button" onClick={() => setLimit((l) => l + PAGE)} className={cn(actionBtn, "mx-auto mt-4 flex")}>
                  {t(`Ver más (${list.length - limit})`, `Show more (${list.length - limit})`)}
                </button>
              )}
            </>
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-edge px-5 py-3 sm:flex-row sm:items-center">
          <div className="flex gap-2 sm:mr-auto">
            {manual && (
              <button type="button" onClick={() => onSave(null)} className={cn(actionBtn, "flex-1 justify-center sm:flex-none")}>
                {t("Volver a la detección automática", "Back to automatic")}
              </button>
            )}
            <button type="button" onClick={() => onSave([])} className={cn(actionBtn, "flex-1 justify-center sm:flex-none")}>
              {t("Sin foto", "No photo")}
            </button>
          </div>
          <button type="button" onClick={() => onSave(selected)} disabled={selected.length === 0} className={cn(primaryBtn, "justify-center py-2.5")}>
            <Check className="size-4" />
            {selected.length === 0
              ? t("Elige las fotos", "Choose the photos")
              : selected.length === 1
                ? t("Usar 1 foto", "Use 1 photo")
                : t(`Usar ${selected.length} fotos`, `Use ${selected.length} photos`)}
          </button>
        </footer>
      </div>
    </dialog>
  );
}

function Thumb({ url }: { url: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) de la foto elegida
    <img src={url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
  ) : (
    <span className="flex size-full items-center justify-center text-mist/60">
      <ImageOff className="size-4" />
    </span>
  );
}

function Grid({
  items,
  selected,
  full,
  photoUrl,
  onToggle,
}: {
  items: readonly ImageInfo[];
  selected: readonly string[];
  full: boolean;
  photoUrl: (id: string) => string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
      {items.map((img) => {
        const pos = selected.indexOf(img.id);
        const on = pos >= 0;
        const folder = img.id.includes("/") ? img.id.slice(0, img.id.lastIndexOf("/")) : null;
        return (
          <li key={img.id}>
            <button
              type="button"
              onClick={() => onToggle(img.id)}
              disabled={!on && full}
              aria-pressed={on}
              title={img.id}
              className={cn(
                "group block w-full overflow-hidden rounded-xl border text-left transition-[border-color,box-shadow] disabled:opacity-40",
                on ? "border-lime ring-2 ring-lime/40" : "border-edge hover:border-mist/60",
              )}
            >
              <span className="relative block aspect-square bg-ink-2">
                <Thumb url={photoUrl(img.id)} />
                {on && <span className="absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-lime text-[11px] font-bold text-lime-fg">{pos + 1}</span>}
              </span>
              <span className="block truncate px-2 pt-1 text-[11px] text-fg">{img.name}</span>
              <span className="block truncate px-2 pb-1.5 text-[10px] text-mist">{folder ?? (img.width && img.height ? `${img.width}×${img.height}` : " ")}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
