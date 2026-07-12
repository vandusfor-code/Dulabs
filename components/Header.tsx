"use client";

import { useEffect, useRef, useState } from "react";

const navLinks = [
  { label: "Productos", href: "#productos" },
  { label: "Soluciones", href: "#soluciones" },
  { label: "Tecnología", href: "#tecnologia" },
  { label: "Nosotros", href: "#nosotros" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        setScrolled(y > 8);
        const max =
          document.documentElement.scrollHeight - window.innerHeight;
        if (progressRef.current) {
          progressRef.current.style.transform = `scaleX(${
            max > 0 ? y / max : 0
          })`;
        }
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b backdrop-blur-xl transition-colors duration-300 ${
        scrolled
          ? "border-edge/80 bg-ink/85"
          : "border-edge/40 bg-ink/60"
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
        <a href="#" className="group flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-lime text-[11px] font-bold tracking-tight text-ink transition-transform duration-300 group-hover:rotate-[-6deg] group-hover:scale-105">
            DU
          </span>
          <span className="text-sm font-semibold tracking-[0.18em] text-white">
            DU LABS
          </span>
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="relative text-sm text-mist transition-colors duration-200 after:absolute after:-bottom-1 after:left-0 after:h-px after:w-0 after:bg-lime after:transition-[width] after:duration-300 hover:text-white hover:after:w-full"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="#contacto"
            className="hidden rounded-lg border border-edge px-4 py-2 text-sm text-mist transition-colors duration-200 hover:border-mist/40 hover:text-white lg:block"
          >
            Contactar
          </a>
          <a
            href="#contacto"
            className="btn-shine hidden rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-ink transition-[background-color,transform] duration-200 hover:bg-lime-hover active:scale-[0.97] sm:block"
          >
            Solicitar demo
          </a>
          <button
            type="button"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 flex-col items-center justify-center gap-[5px] rounded-lg border border-edge md:hidden"
          >
            <span
              className={`h-px w-4 bg-white transition-transform duration-200 ${
                open ? "translate-y-[3px] rotate-45" : ""
              }`}
            />
            <span
              className={`h-px w-4 bg-white transition-transform duration-200 ${
                open ? "-translate-y-[3px] -rotate-45" : ""
              }`}
            />
          </button>
        </div>
      </div>

      <div
        ref={progressRef}
        aria-hidden
        className="absolute bottom-0 left-0 h-[2px] w-full origin-left scale-x-0 bg-gradient-to-r from-lime to-lime-soft"
      />

      {open && (
        <nav className="border-t border-edge/60 bg-ink/95 px-5 py-4 backdrop-blur-xl md:hidden">
          <div className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-sm text-mist transition-colors duration-200 hover:bg-ink-2 hover:text-white"
              >
                {link.label}
              </a>
            ))}
            <a
              href="#contacto"
              onClick={() => setOpen(false)}
              className="mt-2 rounded-lg bg-lime px-3 py-3 text-center text-sm font-semibold text-ink"
            >
              Solicitar demo
            </a>
          </div>
        </nav>
      )}
    </header>
  );
}
