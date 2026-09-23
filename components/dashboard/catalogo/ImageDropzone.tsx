"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, RefreshCw, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/components/dashboard/catalogo/ui";

export interface PickedImage {
  file: File;
  /** URL local (blob:) solo para la vista previa; se libera al reemplazar/quitar/desmontar. */
  url: string;
}

/** Selección de imagen con vista previa. La URL blob se crea en el evento (no en un efecto) y siempre se libera. */
export function usePickedImage() {
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const current = useRef<string | null>(null);

  const pick = useCallback((file: File | null) => {
    if (current.current) URL.revokeObjectURL(current.current);
    const url = file ? URL.createObjectURL(file) : null;
    current.current = url;
    setPicked(file && url ? { file, url } : null);
  }, []);

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );

  return [picked, pick] as const;
}

export function ImageDropzone({
  picked,
  onPick,
  disabled,
  busyLabel,
  className,
}: {
  picked: PickedImage | null;
  onPick: (file: File | null) => void;
  disabled?: boolean;
  /** Texto de progreso sobre la imagen (ej. "Subiendo foto…"). */
  busyLabel?: string | null;
  className?: string;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const choose = () => {
    if (!disabled) input.current?.click();
  };

  return (
    <div className={cn("relative", className)}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          if (file) onPick(file);
          e.target.value = ""; // permite volver a elegir el mismo archivo
        }}
      />
      <button
        type="button"
        onClick={choose}
        disabled={disabled}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !disabled) onPick(file);
        }}
        aria-label={picked ? t("Cambiar fotografía", "Change photo") : t("Agregar fotografía", "Add photo")}
        className={cn(
          "group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border transition-all",
          picked ? "border-edge bg-ink-2" : "border-dashed border-edge bg-ink-2/60 hover:border-lime/50 hover:bg-ink-2",
          dragging && "border-lime bg-lime/5 ring-4 ring-lime/15",
          disabled && "cursor-not-allowed",
        )}
      >
        {picked ? (
          // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:)
          <img src={picked.url} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-card text-mist shadow-sm transition-colors group-hover:text-lime-text">
              <ImagePlus className="size-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-fg">{t("Agrega la fotografía", "Add the photo")}</p>
              <p className="mt-1 text-xs text-mist">{t("Arrastra una imagen o haz clic para elegirla", "Drag an image or click to choose")}</p>
            </div>
            <p className="text-[11px] text-mist/80">{t("JPG, PNG o WEBP · se optimiza automáticamente", "JPG, PNG or WEBP · optimized automatically")}</p>
          </div>
        )}

        {picked && !busyLabel && !disabled && (
          <span className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
            <RefreshCw className="size-3.5" />
            {t("Cambiar foto", "Change photo")}
          </span>
        )}

        {busyLabel && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/35 backdrop-blur-[2px]">
            <span className="flex items-center gap-2 rounded-full bg-card px-4 py-2 text-sm font-medium text-fg shadow-lg">
              <Loader2 className="size-4 animate-spin text-lime-text" />
              {busyLabel}
            </span>
          </span>
        )}
      </button>

      {picked && !disabled && !busyLabel && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/70"
          aria-label={t("Quitar fotografía", "Remove photo")}
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
