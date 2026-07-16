"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

const links = [
  { label: "Plataforma", href: "#plataforma" },
  { label: "Agentes", href: "#entrenamiento" },
  { label: "Infraestructura", href: "#infraestructura" },
  { label: "Escala", href: "#escala" },
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
          <Image src="/logo.png" alt="Du Labs" width={24} height={24} className="rounded-full" priority />
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
