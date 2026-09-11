"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogoV2 } from "./LogoV2";
import { trackConversion } from "@/lib/site-analytics";
import { MENSAJE_WHATSAPP_GENERICO_ES, whatsappVentasUrl } from "@/lib/site-contact";

const LINKS = [
  { label: "Producto", href: "#producto" },
  { label: "Soluciones", href: "#soluciones" },
  { label: "Casos", href: "#casos" },
  { label: "Precios", href: "#precios" },
  { label: "Empresa", href: "#empresa" },
];

export function NavV2() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Bloquea el scroll del body cuando el menú móvil está abierto.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const ctaHref = whatsappVentasUrl(MENSAJE_WHATSAPP_GENERICO_ES);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-sitev2-border bg-sitev2-bg/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 sm:px-8">
        {/* Logo */}
        <Link href="#top" className="shrink-0" aria-label="DuLabs — inicio">
          <LogoV2 className="text-[19px]" />
        </Link>

        {/* Navegación central (desktop) */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 lg:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[14px] text-sitev2-muted-fg transition-colors hover:text-sitev2-fg"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Acciones (desktop) */}
        <div className="hidden items-center gap-5 lg:flex">
          <Link
            href="/login"
            className="text-[14px] text-sitev2-muted-fg transition-colors hover:text-sitev2-fg"
          >
            Iniciar sesión
          </Link>
          <a
            href={ctaHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackConversion("cta_whatsapp", { source: "nav_v2" })}
            className="group inline-flex h-10 items-center gap-2 rounded-full bg-sitev2-fg px-5 text-[13.5px] font-medium text-sitev2-bg transition-all hover:-translate-y-px hover:bg-black"
          >
            Hablar con DuLabs
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
          </a>
        </div>

        {/* Botón menú (mobile) */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={open}
          className="flex h-10 w-10 items-center justify-center rounded-full text-sitev2-fg lg:hidden"
        >
          <span className="relative flex h-4 w-5 flex-col justify-between">
            <span
              className={`h-[1.5px] w-full origin-center rounded-full bg-current transition-all ${
                open ? "translate-y-[7px] rotate-45" : ""
              }`}
            />
            <span className={`h-[1.5px] w-full rounded-full bg-current transition-all ${open ? "opacity-0" : ""}`} />
            <span
              className={`h-[1.5px] w-full origin-center rounded-full bg-current transition-all ${
                open ? "-translate-y-[7px] -rotate-45" : ""
              }`}
            />
          </span>
        </button>
      </div>

      {/* Panel móvil */}
      <div
        className={`overflow-hidden border-t border-sitev2-border bg-sitev2-bg/95 backdrop-blur-xl transition-[max-height,opacity] duration-300 lg:hidden ${
          open ? "max-h-[420px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <nav className="flex flex-col gap-1 px-5 py-4 sm:px-8">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-2.5 text-[15px] text-sitev2-fg transition-colors hover:bg-sitev2-surface-2"
            >
              {l.label}
            </a>
          ))}
          <div className="mt-3 flex flex-col gap-2 border-t border-sitev2-border pt-4">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="px-2 py-1 text-[14px] text-sitev2-muted-fg"
            >
              Iniciar sesión
            </Link>
            <a
              href={ctaHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                trackConversion("cta_whatsapp", { source: "nav_v2_mobile" });
                setOpen(false);
              }}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-sitev2-fg px-5 text-[14px] font-medium text-sitev2-bg"
            >
              Hablar con DuLabs <span aria-hidden>→</span>
            </a>
          </div>
        </nav>
      </div>
    </header>
  );
}
