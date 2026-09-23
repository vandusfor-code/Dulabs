"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";
import { START_HREF, DOCS_HREF, LOGIN_HREF, SECTION_IDS } from "./constants";

// DuLabs Developer V1 -- Fase 15. Nav DEDICADO de la landing comercial. No
// toca el Nav compartido de Business (aislamiento): esta superficie tiene su
// propia identidad Developer/CPaaS. Bilingüe vía useI18n.

export function DevNav() {
  const { t } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const links = [
    { label: t("Plataforma", "Platform"), href: `#${SECTION_IDS.plataforma}` },
    { label: "API", href: `#${SECTION_IDS.api}` },
    { label: "Webhooks", href: `#${SECTION_IDS.webhooks}` },
    { label: "Pricing", href: `#${SECTION_IDS.pricing}` },
    { label: "Docs", href: DOCS_HREF },
  ];

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? "border-b border-site-border bg-site-bg/80 backdrop-blur-xl" : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-6">
        <Link href="/developer-platform" className="flex shrink-0 items-center gap-2.5 font-display text-[14px] font-medium tracking-tight text-site-fg">
          <Image src="/logo.png" alt="DuLabs" width={24} height={24} className="rounded-full" />
          <span>DuLabs</span>
          <span className="rounded-md border border-dev-accent/30 bg-dev-accent-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-dev-accent">
            Developer
          </span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {links.map((l) => (
            <a key={l.label} href={l.href} className="text-[13px] text-site-muted-fg transition-colors hover:text-site-fg">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {/* En pantallas angostas el selector de idioma vive en el menú móvil: la barra no tiene espacio para todo sin montarse. */}
          <div className="hidden sm:block">
            <LanguageSelector />
          </div>
          <Link href={LOGIN_HREF} className="hidden text-[13px] text-site-muted-fg transition-colors hover:text-site-fg md:inline">
            {t("Iniciar sesión", "Log in")}
          </Link>
          <Link
            href={START_HREF}
            className="shrink-0 whitespace-nowrap rounded-lg bg-dev-accent px-3.5 py-2 text-[13px] font-medium text-dev-accent-fg shadow-sm transition-colors hover:bg-dev-accent-hover"
          >
            {t("Get API Key", "Get API Key")}
          </Link>
          <button
            type="button"
            aria-label={t("Abrir menú", "Open menu")}
            aria-expanded={menuAbierto}
            onClick={() => setMenuAbierto((v) => !v)}
            className="lg:hidden inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-site-border text-site-fg"
          >
            <span aria-hidden className="text-lg leading-none">{menuAbierto ? "×" : "≡"}</span>
          </button>
        </div>
      </div>

      {menuAbierto ? (
        <div className="border-t border-site-border bg-site-bg/95 backdrop-blur-xl lg:hidden">
          <nav className="mx-auto flex max-w-[1440px] flex-col gap-1 px-6 py-3">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setMenuAbierto(false)}
                className="rounded-md px-2 py-2 text-[14px] text-site-muted-fg transition-colors hover:bg-site-card hover:text-site-fg"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-site-border pt-3 sm:hidden">
              <span className="text-[13px] text-site-muted-fg">{t("Idioma", "Language")}</span>
              <LanguageSelector />
            </div>
            <div className="mt-2 flex items-center gap-3 border-t border-site-border pt-3">
              <Link
                href={LOGIN_HREF}
                onClick={() => setMenuAbierto(false)}
                className="flex-1 rounded-lg border border-site-border px-3.5 py-2 text-center text-[13px] font-medium text-site-fg"
              >
                {t("Iniciar sesión", "Log in")}
              </Link>
              <Link
                href={START_HREF}
                onClick={() => setMenuAbierto(false)}
                className="flex-1 rounded-lg bg-dev-accent px-3.5 py-2 text-center text-[13px] font-medium text-dev-accent-fg"
              >
                {t("Get API Key", "Get API Key")}
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
