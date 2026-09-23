"use client";

/**
 * Preview de la carga masiva: resumen, decisiones de categorías, tabla de
 * filas con su estado (listo / advertencia / error / repetido), corrección en
 * línea y confirmación. Lo que se muestra lo decidió el SERVIDOR.
 */
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Copy, Download, ImageOff, Images, Info, Loader2, Pencil, RotateCcw, Sparkles, Trash2, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { CatalogCategory } from "@/lib/catalogo/domain";
import { COLUMNS, type ColumnKey } from "@/lib/catalogo/import/columnas";
import type { AnalyzedRow, CategoryDecision, ImageInfo, ImportAnalysis, RawRow, RowStatus } from "@/lib/catalogo/import/types";
import { SelectorFotos } from "@/components/dashboard/catalogo/importar/SelectorFotos";
import { actionBtn, cn, formatPrice, inputCls, primaryBtn } from "@/components/dashboard/catalogo/ui";

/** "photos" = se importarán, pero sin foto o con dudas sobre cuál usar. */
type Filter = "all" | RowStatus | "photos";

const importable = (r: AnalyzedRow) => r.status === "ready" || r.status === "warning";
const needsPhoto = (r: AnalyzedRow) => importable(r) && r.images.length === 0 && (r.imageCandidates.length > 0 || r.issues.some((i) => i.field === "images"));

const LABELS: Record<ColumnKey, [string, string]> = {
  name: ["Nombre", "Name"],
  category: ["Categoría", "Category"],
  retailPrice: ["Precio detal", "Retail price"],
  wholesalePrice: ["Precio mayor", "Wholesale price"],
  stock: ["Stock", "Stock"],
  material: ["Material", "Material"],
  color: ["Color", "Color"],
  description: ["Descripción", "Description"],
  code: ["Código de fotos", "Photo code"],
  images: ["Imágenes", "Images"],
};

const COLS = "md:grid md:grid-cols-[28px_48px_minmax(0,1fr)_120px_96px_96px_64px_88px] md:items-start md:gap-4";

export function VistaPrevia({
  fileName,
  analysis,
  existingCategories,
  busy,
  photoUrl,
  images,
  addPhotos,
  onPickPhotos,
  onDecision,
  onToggleAttach,
  onToggleForce,
  onSaveRow,
  onRemoveRow,
  onDownloadErrors,
  onImport,
  onRestart,
  importBlockedReason = null,
}: {
  fileName: string;
  analysis: ImportAnalysis;
  existingCategories: CatalogCategory[];
  busy: boolean;
  photoUrl: (id: string) => string | null;
  /** Fotos seleccionadas (para el selector). */
  images: readonly ImageInfo[];
  addPhotos: ReactNode;
  /** Fotos elegidas para una fila (null = volver a lo automático). */
  onPickPhotos: (row: number, ids: string[] | null) => void;
  onDecision: (key: string, decision: CategoryDecision) => void;
  /** Agregar (on) o no las fotos de estas filas a sus productos ya importados sin fotos. */
  onToggleAttach: (rows: number[], on: boolean) => void;
  onToggleForce: (row: number) => void;
  onSaveRow: (row: number, values: RawRow["values"]) => void;
  onRemoveRow: (row: number) => void;
  onDownloadErrors: () => void;
  onImport: () => void;
  onRestart: () => void;
  /** Motivo por el que aún no se puede importar (p. ej. la carga masiva no está activada). */
  importBlockedReason?: string | null;
}) {
  const { t } = useI18n();
  const s = analysis.summary;
  const [filter, setFilter] = useState<Filter>(s.errors > 0 ? "error" : "all");
  const [editing, setEditing] = useState<number | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const pickingRow = picking === null ? null : analysis.rows.find((r) => r.row === picking) ?? null;
  const photoReview = useMemo(() => (images.length > 0 ? analysis.rows.filter(needsPhoto).length : 0), [analysis.rows, images.length]);
  const visibles = useMemo(
    () => (filter === "all" ? analysis.rows : filter === "photos" ? analysis.rows.filter(needsPhoto) : analysis.rows.filter((r) => r.status === filter)),
    [analysis.rows, filter],
  );
  const filtroActivo = filter !== "all" && visibles.length === 0 ? "all" : filter;
  const lista = filtroActivo === filter ? visibles : analysis.rows;

  const tabs: Array<{ id: Filter; label: string; count: number }> = [
    { id: "all", label: t("Todos", "All"), count: s.total },
    { id: "ready", label: t("Listos", "Ready"), count: s.ready },
    { id: "warning", label: t("Advertencias", "Warnings"), count: s.warnings },
    { id: "error", label: t("Errores", "Errors"), count: s.errors },
    { id: "duplicate", label: t("Repetidos", "Duplicates"), count: s.duplicates },
    ...(photoReview > 0 ? [{ id: "photos" as const, label: t("Fotos por revisar", "Photos to review"), count: photoReview }] : []),
  ];

  return (
    <div className="space-y-5 pb-28">
      {/* Resumen */}
      <section className="rounded-2xl border border-edge bg-card p-5 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-xs text-mist">{fileName}</p>
            <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-fg">
              {s.total === 1 ? t("Encontramos 1 producto", "We found 1 product") : t(`Encontramos ${s.total} productos`, `We found ${s.total} products`)}
            </h2>
          </div>
          <button type="button" onClick={onRestart} className={cn(actionBtn, "w-fit")}>
            <RotateCcw className="size-4" />
            {t("Cambiar archivo", "Change file")}
          </button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat tone="ok" icon={<CheckCircle2 className="size-4" />} value={s.ready} label={t("listos para importar", "ready to import")} />
          <Stat tone="warn" icon={<AlertTriangle className="size-4" />} value={s.warnings} label={t("con advertencias", "with warnings")} />
          <Stat tone="error" icon={<XCircle className="size-4" />} value={s.errors} label={t("con errores", "with errors")} />
          <Stat tone="muted" icon={<Copy className="size-4" />} value={s.duplicates} label={t("ya existen", "already exist")} />
        </div>
        <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-mist">
          <span>{s.photos.matched === 1 ? t("1 foto relacionada", "1 photo matched") : t(`${s.photos.matched} fotos relacionadas`, `${s.photos.matched} photos matched`)}</span>
          {s.photos.auto > 0 && (
            <span className="inline-flex items-center gap-1 text-lime-text">
              <Sparkles className="size-3" />
              {t(`${s.photos.auto} productos con foto encontrada automáticamente`, `${s.photos.auto} products with photos found automatically`)}
            </span>
          )}
          {s.photos.ambiguous > 0 && <span className="text-amber-400">{t(`${s.photos.ambiguous} con varias fotos posibles`, `${s.photos.ambiguous} with several possible photos`)}</span>}
          {s.photos.missing > 0 && <span className="text-amber-400">{t(`${s.photos.missing} no encontradas`, `${s.photos.missing} not found`)}</span>}
          {s.photos.unused.length > 0 && <span>{t(`${s.photos.unused.length} sin usar`, `${s.photos.unused.length} unused`)}</span>}
        </p>
        {analysis.notices.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {analysis.notices.map((n) => (
              <li key={n} className="flex items-start gap-2 rounded-lg bg-ink-2/60 px-3 py-2 text-xs text-mist">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                {n}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Productos ya importados que siguen sin fotos: completar (decisión explícita) */}
      {s.attachable > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl border border-lime/30 bg-lime/5 p-5 sm:flex-row sm:items-center md:p-6">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-fg">
              {s.attachable === 1
                ? t("1 producto que ya cargaste no tiene fotos, y aquí están", "1 product you already uploaded has no photos, and they're here")
                : t(`${s.attachable} productos que ya cargaste no tienen fotos, y aquí están`, `${s.attachable} products you already uploaded have no photos, and they're here`)}
            </h3>
            <p className="mt-1 text-xs text-mist">
              {t("Podemos agregarles las fotos encontradas. No se crea otro producto ni se cambian su precio, stock o referencia.", "We can add the photos we found. No new product is created and price, stock or reference don't change.")}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const candidates = analysis.rows.filter((r) => r.duplicateOf?.kind === "catalog" && r.duplicateOf.canAttach && r.images.length > 0).map((r) => r.row);
              onToggleAttach(candidates, s.attach < s.attachable);
            }}
            className={cn(s.attach < s.attachable ? primaryBtn : actionBtn, "shrink-0 justify-center py-2.5")}
          >
            {s.attach < s.attachable
              ? s.attachable === 1
                ? t("Agregar sus fotos", "Add its photos")
                : t(`Agregar fotos a los ${s.attachable}`, `Add photos to all ${s.attachable}`)
              : t("No agregar fotos", "Don't add photos")}
          </button>
        </section>
      )}

      {/* Categorías nuevas */}
      {analysis.categories.length > 0 && (
        <section className="rounded-2xl border border-edge bg-card p-5 md:p-6">
          <h3 className="text-sm font-semibold text-fg">{t("Categorías que no existen en tu catálogo", "Categories not in your catalog")}</h3>
          <p className="mt-1 text-xs text-mist">{t("Decide qué hacer con cada una. Mayúsculas y tildes no crean categorías distintas.", "Decide what to do with each one. Case and accents never create separate categories.")}</p>
          <ul className="mt-4 divide-y divide-edge">
            {analysis.categories.map((c) => {
              const value = c.decision.action === "use" ? `use:${c.decision.categoryId}` : c.decision.action;
              return (
                <li key={c.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">
                      «{c.label}» <span className="font-normal text-mist">· {c.rows === 1 ? t("1 producto", "1 product") : t(`${c.rows} productos`, `${c.rows} products`)}</span>
                    </p>
                    {c.suggestion && <p className="text-xs text-mist">{t(`Parece la misma que «${c.suggestion.name}».`, `Looks like «${c.suggestion.name}».`)}</p>}
                    {c.spellings.length > 1 && <p className="text-xs text-mist">{t(`Escrita como: ${c.spellings.join(", ")}`, `Written as: ${c.spellings.join(", ")}`)}</p>}
                  </div>
                  <select
                    className={cn(inputCls, "sm:w-64")}
                    value={value}
                    disabled={busy}
                    aria-label={t(`Qué hacer con la categoría ${c.label}`, `What to do with category ${c.label}`)}
                    onChange={(e) => {
                      const v = e.target.value;
                      onDecision(c.key, v === "create" ? { action: "create" } : v === "none" ? { action: "none" } : { action: "use", categoryId: v.slice(4) });
                    }}
                  >
                    <option value="create">{t(`Crear categoría «${c.label}»`, `Create category «${c.label}»`)}</option>
                    {existingCategories.map((e) => (
                      <option key={e.id} value={`use:${e.id}`}>
                        {t(`Usar «${e.name}»`, `Use «${e.name}»`)}
                      </option>
                    ))}
                    <option value="none">{t("Sin categoría", "No category")}</option>
                  </select>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {addPhotos}

      {/* Filas */}
      <section className="overflow-hidden rounded-2xl border border-edge bg-card">
        <div className="flex gap-1 overflow-x-auto border-b border-edge p-2" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filtroActivo === tab.id}
              onClick={() => setFilter(tab.id)}
              disabled={tab.id !== "all" && tab.count === 0}
              className={cn(
                "shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-40",
                filtroActivo === tab.id ? "bg-ink-2 font-medium text-fg" : "text-mist hover:text-fg",
              )}
            >
              {tab.label} <span className="tabular-nums text-mist">{tab.count}</span>
            </button>
          ))}
        </div>
        <div className={cn("hidden border-b border-edge px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-mist", COLS)}>
          <span />
          <span>{t("Foto", "Photo")}</span>
          <span>{t("Producto", "Product")}</span>
          <span>{t("Categoría", "Category")}</span>
          <span className="text-right">{t("Precio", "Price")}</span>
          <span className="text-right">{t("Mayor", "Wholesale")}</span>
          <span className="text-right">{t("Stock", "Stock")}</span>
          <span />
        </div>
        <ul className={cn("divide-y divide-edge transition-opacity", busy && "opacity-60")}>
          {lista.map((r) => (
            <FilaPreview
              key={r.row}
              r={r}
              photoUrl={photoUrl}
              canPick={images.length > 0}
              onPick={() => setPicking(r.row)}
              editing={editing === r.row}
              busy={busy}
              onEdit={() => setEditing(editing === r.row ? null : r.row)}
              onSave={(values) => {
                setEditing(null);
                onSaveRow(r.row, values);
              }}
              onRemove={() => {
                setEditing(null);
                onRemoveRow(r.row);
              }}
              onToggleForce={() => onToggleForce(r.row)}
              onToggleAttach={() => onToggleAttach([r.row], !r.attach)}
            />
          ))}
        </ul>
      </section>

      {pickingRow && (
        <SelectorFotos
          key={pickingRow.row}
          row={pickingRow}
          images={images}
          unused={s.photos.unused}
          photoUrl={photoUrl}
          onClose={() => setPicking(null)}
          onSave={(ids) => {
            setPicking(null);
            onPickPhotos(pickingRow.row, ids);
          }}
        />
      )}

      {/* Confirmación */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-ink/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur md:px-8 lg:left-64">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-mist" aria-live="polite">
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                {t("Revisando cambios…", "Checking changes…")}
              </span>
            ) : importBlockedReason ? (
              <span className="text-amber-300">{importBlockedReason}</span>
            ) : (
              <>
                <span className="font-semibold text-fg">{s.importable}</span> {t("se importarán", "will be imported")}
                {s.attach > 0 && <span> · {t(`${s.attach} se completan con fotos`, `${s.attach} get photos`)}</span>}
                {s.errors + s.duplicates > 0 && <span> · {t(`${s.errors + s.duplicates} no`, `${s.errors + s.duplicates} won't`)}</span>}
              </>
            )}
          </p>
          <div className="flex gap-2">
            {s.errors > 0 && (
              <button type="button" onClick={onDownloadErrors} className={cn(actionBtn, "shrink-0 justify-center")}>
                <Download className="size-4" />
                <span className="sm:hidden">{t("Errores", "Errors")}</span>
                <span className="hidden sm:inline">{t("Descargar filas con errores", "Download rows with errors")}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onImport}
              disabled={busy || s.importable + s.attach === 0 || importBlockedReason !== null}
              title={importBlockedReason ?? undefined}
              className={cn(primaryBtn, "flex-1 justify-center whitespace-nowrap py-2.5 sm:flex-none")}
            >
              {s.importable === 0 && s.attach > 0
                ? s.attach === 1
                  ? t("Agregar fotos a 1 producto", "Add photos to 1 product")
                  : t(`Agregar fotos a ${s.attach} productos`, `Add photos to ${s.attach} products`)
                : s.importable === 1
                  ? t("Importar 1 producto", "Import 1 product")
                  : t(`Importar ${s.importable} productos`, `Import ${s.importable} products`)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ tone, icon, value, label }: { tone: "ok" | "warn" | "error" | "muted"; icon: ReactNode; value: number; label: string }) {
  const color = tone === "ok" ? "text-lime-text" : tone === "warn" ? "text-amber-400" : tone === "error" ? "text-red-400" : "text-mist";
  return (
    <div className={cn("rounded-xl border border-edge bg-ink-2/40 px-3.5 py-3", value === 0 && tone !== "ok" && "opacity-60")}>
      <p className={cn("flex items-center gap-1.5 text-2xl font-semibold tabular-nums", value === 0 ? "text-mist" : color)}>
        <span className={color}>{icon}</span>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-mist">{label}</p>
    </div>
  );
}

function StatusIcon({ status }: { status: RowStatus }) {
  const { t } = useI18n();
  if (status === "ready") return <CheckCircle2 className="size-5 text-lime-text" aria-label={t("Listo", "Ready")} />;
  if (status === "warning") return <AlertTriangle className="size-5 text-amber-400" aria-label={t("Con advertencias", "With warnings")} />;
  if (status === "error") return <XCircle className="size-5 text-red-400" aria-label={t("Con errores", "With errors")} />;
  return <Copy className="size-5 text-mist" aria-label={t("Ya existe", "Already exists")} />;
}

function FilaPreview({
  r,
  photoUrl,
  canPick,
  onPick,
  editing,
  busy,
  onEdit,
  onSave,
  onRemove,
  onToggleForce,
  onToggleAttach,
}: {
  r: AnalyzedRow;
  photoUrl: (id: string) => string | null;
  canPick: boolean;
  onPick: () => void;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onSave: (values: RawRow["values"]) => void;
  onRemove: () => void;
  onToggleForce: () => void;
  onToggleAttach: () => void;
}) {
  const { t } = useI18n();
  const p = r.product;
  const first = r.images[0]?.file ? photoUrl(r.images[0].file) : null;
  const category = p ? (p.category.kind === "existing" ? p.category.name : p.category.kind === "new" ? p.category.label : null) : r.values.category ?? null;
  const catalogDup = r.duplicateOf?.kind === "catalog";

  return (
    <li className={cn("px-4 py-3", r.status === "error" && "bg-red-500/[0.03]")}>
      <div className={cn("flex gap-3", COLS)}>
        <span className="hidden pt-3 md:block">
          <StatusIcon status={r.status} />
        </span>
        <button
          type="button"
          onClick={onPick}
          disabled={!canPick || busy || r.status === "error"}
          className={cn(
            "relative size-12 shrink-0 overflow-hidden rounded-lg bg-ink-2 transition-shadow enabled:hover:ring-2 enabled:hover:ring-lime/50",
            r.imageCandidates.length > 0 && "ring-2 ring-amber-400/60",
          )}
          aria-label={t(`Elegir fotos de la fila ${r.row}`, `Choose photos for row ${r.row}`)}
        >
          {first ? (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) de la foto elegida
            <img src={first} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-mist/60">
              <ImageOff className="size-4" />
            </span>
          )}
          {r.images.length > 1 && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[10px] font-medium text-white">+{r.images.length - 1}</span>}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span className="md:hidden">
              <StatusIcon status={r.status} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{p?.name ?? r.values.name ?? t("(sin nombre)", "(no name)")}</p>
              <p className="text-xs text-mist">
                {t(`Fila ${r.row}`, `Row ${r.row}`)}
                {r.images.length > 0 && r.imageSource === "auto" && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-lime-text">
                    <Sparkles className="size-3" />
                    {t("foto encontrada automáticamente", "photo found automatically")}
                  </span>
                )}
                {r.imageSource === "picked" && <span className="ml-1.5 text-lime-text">{t("fotos elegidas por ti", "photos chosen by you")}</span>}
                <span className="md:hidden">
                  {category && ` · ${category}`}
                  {p && ` · ${formatPrice(p.retailPrice)} · ${p.stock} u.`}
                </span>
              </p>
            </div>
          </div>
          {r.issues.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {r.issues.map((i, k) => (
                <li key={k} className={cn("text-xs", i.severity === "error" ? "text-red-400" : "text-amber-400")}>
                  {i.message}
                </li>
              ))}
            </ul>
          )}
          {canPick && needsPhoto(r) && (
            <button type="button" onClick={onPick} disabled={busy} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-fg hover:border-lime/60">
              <Images className="size-3.5" />
              {t("Elegir fotos", "Choose photos")}
            </button>
          )}
          {r.duplicateOf?.kind === "catalog" && r.duplicateOf.canAttach && r.images.length > 0 && !r.forced && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-fg">
              <input type="checkbox" checked={r.attach} disabled={busy} onChange={onToggleAttach} className="size-4 accent-lime" />
              {t(`Agregar ${r.images.length === 1 ? "la foto" : `las ${r.images.length} fotos`} a ${r.duplicateOf.reference}`, `Add the photos to ${r.duplicateOf.reference}`)}
            </label>
          )}
          {catalogDup && !r.attach && (
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-fg">
              <input type="checkbox" checked={r.forced} disabled={busy} onChange={onToggleForce} className="size-4 accent-lime" />
              {t("Importarlo de todas formas (como producto nuevo)", "Import it anyway (as a new product)")}
            </label>
          )}
        </div>
        <span className="hidden truncate pt-0.5 text-sm text-mist md:block">
          {category ?? "—"}
          {p?.category.kind === "new" && <span className="ml-1.5 rounded bg-lime/10 px-1.5 py-0.5 text-[10px] font-medium text-lime-text">{t("Nueva", "New")}</span>}
        </span>
        <span className="hidden pt-0.5 text-right text-sm tabular-nums text-fg md:block">{p ? formatPrice(p.retailPrice) : r.values.retailPrice ?? "—"}</span>
        <span className="hidden pt-0.5 text-right text-sm tabular-nums text-mist md:block">{p ? formatPrice(p.wholesalePrice) : r.values.wholesalePrice ?? "—"}</span>
        <span className="hidden pt-0.5 text-right text-sm tabular-nums text-fg md:block">{p ? p.stock : r.values.stock ?? "—"}</span>
        <div className="flex shrink-0 items-start justify-end gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            className={cn("flex size-9 items-center justify-center rounded-lg text-mist transition-colors hover:bg-ink-2 hover:text-fg", editing && "bg-ink-2 text-fg")}
            aria-label={t(`Corregir fila ${r.row}`, `Fix row ${r.row}`)}
            aria-expanded={editing}
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="flex size-9 items-center justify-center rounded-lg text-mist transition-colors hover:bg-ink-2 hover:text-red-400"
            aria-label={t(`Quitar fila ${r.row} de esta importación`, `Remove row ${r.row} from this import`)}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      {editing && <EditorFila key={r.row} r={r} onSave={onSave} onCancel={onEdit} />}
    </li>
  );
}

function EditorFila({ r, onSave, onCancel }: { r: AnalyzedRow; onSave: (values: RawRow["values"]) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [values, setValues] = useState<RawRow["values"]>(r.values);
  const wrong = new Set(r.issues.filter((i) => i.severity === "error").map((i) => i.field));
  return (
    <form
      className="mt-3 rounded-xl border border-edge bg-ink-2/40 p-4 motion-safe:animate-[catalogo-toast-in_180ms_ease-out]"
      onSubmit={(e) => {
        e.preventDefault();
        const clean: RawRow["values"] = {};
        for (const [k, v] of Object.entries(values) as Array<[ColumnKey, string | undefined]>) if (v && v.trim()) clean[k] = v.trim();
        onSave(clean);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((c) => (
          <label key={c.key} className={cn("block", (c.key === "description" || c.key === "images") && "sm:col-span-2")}>
            <span className="mb-1 block text-[11px] font-medium text-mist">
              {t(...LABELS[c.key])}
              {c.required && <span className="text-red-400"> *</span>}
            </span>
            <input
              className={cn(inputCls, "py-2", wrong.has(c.key) && "border-red-500/60")}
              value={values[c.key] ?? ""}
              inputMode={c.key === "retailPrice" || c.key === "wholesalePrice" || c.key === "stock" ? "numeric" : undefined}
              onChange={(e) => setValues((v) => ({ ...v, [c.key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={actionBtn}>
          {t("Cancelar", "Cancel")}
        </button>
        <button type="submit" className={primaryBtn}>
          {t("Guardar y revisar", "Save and check")}
        </button>
      </div>
    </form>
  );
}
