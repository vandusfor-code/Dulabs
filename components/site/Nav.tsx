"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const links = [
  { label: "Plataforma", href: "#plataforma" },
  { label: "WhatsApp", href: "#whatsapp" },
  { label: "Métricas", href: "#metricas" },
  { label: "Precios", href: "#precios" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-site-border bg-site-bg/70 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-6">
        <Link href="#top" className="flex items-center gap-2.5 font-display text-[14px] font-medium tracking-tight text-site-fg">
          <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-site-fg text-site-bg">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
              <path d="M3 3h5a5 5 0 0 1 0 10H3V3Z" fill="currentColor" />
              <circle cx="11.5" cy="8" r="1.2" fill="var(--color-site-primary)" />
            </svg>
          </span>
          <span>Du Labs</span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[13px] text-site-muted-fg transition-colors hover:text-site-fg"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden text-[13px] text-site-muted-fg transition-colors hover:text-site-fg md:inline">
            Iniciar sesión
          </Link>
          <Link
            href="/business"
            className="group inline-flex h-8 items-center gap-1.5 rounded-full bg-site-fg px-3.5 text-[12.5px] font-medium text-site-bg transition-all hover:bg-site-fg/90"
          >
            Activar mi API
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
