"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogoV2 } from "./LogoV2";
import { trackConversion } from "@/lib/site-analytics";
import { MENSAJE_WHATSAPP_GENERICO_ES, whatsappVentasUrl } from "@/lib/site-contact";

// Nav aprobada (brief, sección 13): Producto y Soluciones llevan submenú,
// el resto son links planos. Todo son anclas dentro de /newversion -- no hay
// rutas nuevas por ahora (mismo criterio de "primera pantalla simple" que
// ya rige el resto de la página, sin fragmentar en páginas separadas
// todavía).
const PRODUCTO_ITEMS = [
  { label: "Conversaciones", href: "#producto" },
  { label: "IA", href: "#producto" },
  { label: "CRM", href: "#producto" },
  { label: "Automatizaciones", href: "#producto" },
  { label: "Campañas", href: "#producto" },
  { label: "Analytics", href: "#producto" },
  { label: "Integraciones", href: "#producto" },
];

const SOLUCIONES_ITEMS = [
  { label: "Atención", href: "#soluciones" },
  { label: "Ventas", href: "#soluciones" },
  { label: "Citas", href: "#soluciones" },
  { label: "Cobranza", href: "#soluciones" },
  { label: "Pagos", href: "#soluciones" },
  { label: "Postventa", href: "#soluciones" },
  { label: "Operaciones", href: "#soluciones" },
];

const LINKS_PLANOS = [
  { label: "Software a medida", href: "#custom" },
  { label: "Casos", href: "#casos" },
  { label: "Precios", href: "#precios" },
  { label: "Empresa", href: "#empresa" },
];

function NavDropdown({ label, items }: { label: string; items: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="flex items-center gap-1 text-[14px] text-sitev2-muted-fg transition-colors hover:text-sitev2-fg"
        aria-expanded={open}
      >
        {label}
        <span aria-hidden className={`text-[9px] transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      <div
        className={`absolute left-1/2 top-full w-[220px] -translate-x-1/2 pt-3 transition-all ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="v2-shadow-float grid gap-0.5 rounded-2xl border border-sitev2-border bg-sitev2-bg p-2">
          {items.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="rounded-lg px-3 py-2 text-[13.5px] text-sitev2-muted-fg transition-colors hover:bg-sitev2-surface-2 hover:text-sitev2-fg"
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

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
      {/* Grid de 3 columnas (logo / nav / acciones) en vez de flex+absolute:
          con 2 dropdowns + 4 links planos, el centrado absoluto viejo se
          montaba encima de "Iniciar sesión" en desktop -- el grid reserva
          el espacio real de cada columna, nunca se superponen. */}
      <div className="mx-auto grid h-16 max-w-[1280px] grid-cols-[auto_1fr_auto] items-center gap-4 px-5 sm:px-8">
        {/* Logo */}
        <Link href="#top" className="shrink-0" aria-label="DuLabs — inicio">
          <LogoV2 className="text-[19px]" />
        </Link>

        {/* Navegación central (desktop) */}
        <nav className="hidden items-center justify-center gap-5 lg:flex">
          <NavDropdown label="Producto" items={PRODUCTO_ITEMS} />
          <NavDropdown label="Soluciones" items={SOLUCIONES_ITEMS} />
          {LINKS_PLANOS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="whitespace-nowrap text-[14px] text-sitev2-muted-fg transition-colors hover:text-sitev2-fg"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Acciones + botón mobile, agrupados como una sola columna del grid */}
        <div className="flex items-center justify-end gap-5">
          {/* Acciones (desktop) */}
          <div className="hidden items-center gap-5 lg:flex">
            <Link
              href="/login"
              className="whitespace-nowrap text-[14px] text-sitev2-muted-fg transition-colors hover:text-sitev2-fg"
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
      </div>

      {/* Panel móvil — submenús como listas planas dentro de su sección,
          sin acordeón (mejor legibilidad en pantallas chicas que anidar). */}
      <div
        className={`overflow-hidden overflow-y-auto border-t border-sitev2-border bg-sitev2-bg/95 backdrop-blur-xl transition-[max-height,opacity] duration-300 lg:hidden ${
          open ? "max-h-[80vh] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <nav className="flex flex-col gap-5 px-5 py-5 sm:px-8">
          <div>
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-sitev2-muted-fg">Producto</p>
            <div className="mt-1.5 flex flex-col gap-0.5">
              {PRODUCTO_ITEMS.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-2 py-1.5 text-[14.5px] text-sitev2-fg transition-colors hover:bg-sitev2-surface-2"
                >
                  {l.label}
                </a>
              ))}
            </div>
          </div>
          <div>
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-sitev2-muted-fg">Soluciones</p>
            <div className="mt-1.5 flex flex-col gap-0.5">
              {SOLUCIONES_ITEMS.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-2 py-1.5 text-[14.5px] text-sitev2-fg transition-colors hover:bg-sitev2-surface-2"
                >
                  {l.label}
                </a>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-0.5 border-t border-sitev2-border pt-4">
            {LINKS_PLANOS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1.5 text-[14.5px] text-sitev2-fg transition-colors hover:bg-sitev2-surface-2"
              >
                {l.label}
              </a>
            ))}
          </div>
          <div className="flex flex-col gap-2 border-t border-sitev2-border pt-4">
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
