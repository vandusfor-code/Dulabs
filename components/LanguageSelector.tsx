"use client";

import { useI18n, type Lang } from "@/lib/i18n";

const OPCIONES: { valor: Lang; etiqueta: string }[] = [
  { valor: "es", etiqueta: "ES" },
  { valor: "en", etiqueta: "EN" },
];

/**
 * Selector compacto ES/EN. `tone="dark"` para superficies claras (dashboard),
 * `tone="light"` (por defecto) para la landing oscura y `tone="neutral"`
 * (blanco sobre negro, sin acento de color) para el login de DuLabs Developer.
 */
export function LanguageSelector({ tone = "light" }: { tone?: "light" | "dark" | "neutral" }) {
  const { lang, setLang } = useI18n();

  const base =
    tone === "dark"
      ? {
          wrap: "border-edge bg-card",
          on: "bg-lime text-lime-fg",
          off: "text-mist hover:text-fg",
        }
      : tone === "neutral"
        ? {
            wrap: "border-white/[0.08] bg-white/[0.02]",
            on: "bg-[#F5F5F5] text-[#050505]",
            off: "text-[#A1A1AA] hover:text-[#F5F5F5]",
          }
        : {
            wrap: "border-site-border bg-white/[0.03]",
            on: "bg-site-primary text-site-primary-fg",
            off: "text-site-muted-fg hover:text-site-fg",
          };

  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-full border ${base.wrap} p-0.5`}
      role="group"
      aria-label="Idioma / Language"
    >
      {OPCIONES.map((o) => {
        const activo = lang === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            onClick={() => setLang(o.valor)}
            aria-pressed={activo}
            className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide transition-colors ${
              activo ? base.on : base.off
            }`}
          >
            {o.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
