"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";
import { START_HREF, DOCS_HREF, LOGIN_HREF, SECTION_IDS } from "./constants";

// DuLabs Developer -- nav de la landing. Compacta (56 px), sticky, transparente sobre el hero y con fondo sutil al bajar. Ningún listener
// de scroll: un centinela (IntersectionObserver) decide el fondo, y otro observer marca el bloque activo (aria-current) para que el nav
// acompañe la lectura. Docs es la única salida de la página (va al portal /developers).

const ANCLAS = [SECTION_IDS.plataforma, SECTION_IDS.capacidades, SECTION_IDS.api, SECTION_IDS.webhooks, SECTION_IDS.pricing] as const;

export function DevNav() {
  const { t } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const [activo, setActivo] = useState<string | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const centinela = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nodo = centinela.current;
    if (!nodo) return;
    const obs = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting));
    obs.observe(nodo);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const secciones = ANCLAS.map((id) => document.getElementById(id)).filter((n): n is HTMLElement => !!n);
    const visibles = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) visibles.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        let mejor: string | null = null;
        let max = 0;
        for (const [id, r] of visibles) if (r > max) [mejor, max] = [id, r];
        setActivo(mejor);
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.01, 0.5, 1] },
    );
    secciones.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  const links = [
    { id: SECTION_IDS.plataforma, label: t("Plataforma", "Platform"), href: `#${SECTION_IDS.plataforma}` },
    { id: SECTION_IDS.capacidades, label: t("Capacidades", "Capabilities"), href: `#${SECTION_IDS.capacidades}` },
    { id: SECTION_IDS.api, label: "API", href: `#${SECTION_IDS.api}` },
    { id: SECTION_IDS.webhooks, label: "Webhooks", href: `#${SECTION_IDS.webhooks}` },
    { id: "docs-externo", label: "Docs", href: DOCS_HREF },
    { id: SECTION_IDS.pricing, label: "Pricing", href: `#${SECTION_IDS.pricing}` },
  ];

  return (
    <>
      <div ref={centinela} aria-hidden className="pointer-events-none absolute left-0 top-0 h-2 w-px" />
      <header {...(scrolled || menuAbierto ? { "data-scrolled": "" } : {})} className="dp-nav fixed inset-x-0 top-0 z-50 border-b border-transparent">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-6">
          <Link href="/developer-platform" className="dp-link flex shrink-0 items-center gap-2.5 text-[14px] font-medium tracking-tight text-dp-text">
            <Image src="/logo.png" alt="" width={22} height={22} className="rounded-full" />
            <span>DuLabs</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-dp-muted">Developer</span>
          </Link>

          <nav aria-label={t("Secciones", "Sections")} className="hidden items-center gap-7 lg:flex">
            {links.map((l) => {
              const esAncla = l.href.startsWith("#");
              const clase = "dp-nav-link dp-link relative text-[13px] text-dp-text-2 hover:text-dp-text";
              return esAncla ? (
                <a key={l.id} href={l.href} aria-current={activo === l.id ? "true" : undefined} className={clase}>
                  {l.label}
                </a>
              ) : (
                <Link key={l.id} href={l.href} className={clase}>
                  {l.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden sm:block">
              <LanguageSelector />
            </div>
            <Link href={LOGIN_HREF} className="dp-link hidden text-[13px] text-dp-text-2 hover:text-dp-text md:inline">
              {t("Iniciar sesión", "Sign in")}
            </Link>
            <Link
              href={START_HREF}
              className="dp-btn shrink-0 whitespace-nowrap rounded-dp bg-dev-accent px-3.5 py-1.5 text-[13px] font-medium text-dev-accent-fg hover:bg-dev-accent-hover"
            >
              Get API Key
            </Link>
            <button
              type="button"
              aria-label={menuAbierto ? t("Cerrar menú", "Close menu") : t("Abrir menú", "Open menu")}
              aria-expanded={menuAbierto}
              aria-controls="dp-menu-movil"
              onClick={() => setMenuAbierto((v) => !v)}
              className="dp-link inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-dp border border-dp-border-strong text-dp-text lg:hidden"
            >
              <span aria-hidden className="relative block h-2.5 w-3.5">
                <span className={`absolute left-0 h-px w-full bg-current transition-transform duration-300 ${menuAbierto ? "top-1/2 rotate-45" : "top-0"}`} />
                <span className={`absolute left-0 h-px w-full bg-current transition-transform duration-300 ${menuAbierto ? "top-1/2 -rotate-45" : "bottom-0"}`} />
              </span>
            </button>
          </div>
        </div>

        {menuAbierto ? (
          <div id="dp-menu-movil" className="border-t border-dp-border lg:hidden">
            <nav aria-label={t("Menú", "Menu")} className="mx-auto flex max-w-[1440px] flex-col px-6 py-2">
              {links.map((l) =>
                l.href.startsWith("#") ? (
                  <a key={l.id} href={l.href} onClick={() => setMenuAbierto(false)} className="dp-link border-b border-dp-border py-3 text-[15px] text-dp-text-2 hover:text-dp-text">
                    {l.label}
                  </a>
                ) : (
                  <Link key={l.id} href={l.href} onClick={() => setMenuAbierto(false)} className="dp-link border-b border-dp-border py-3 text-[15px] text-dp-text-2 hover:text-dp-text">
                    {l.label}
                  </Link>
                ),
              )}
              <div className="flex items-center justify-between gap-3 border-b border-dp-border py-3 sm:hidden">
                <span className="text-[13px] text-dp-muted">{t("Idioma", "Language")}</span>
                <LanguageSelector />
              </div>
              <Link href={LOGIN_HREF} onClick={() => setMenuAbierto(false)} className="dp-link py-3 text-[15px] text-dp-text-2 hover:text-dp-text">
                {t("Iniciar sesión", "Sign in")}
              </Link>
            </nav>
          </div>
        ) : null}
      </header>
    </>
  );
}
