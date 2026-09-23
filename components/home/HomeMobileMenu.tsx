"use client";

import { useEffect, useState } from "react";
import { TrackedLink } from "./TrackedLink";

type Props = {
  links: { label: string; href: string }[];
  crearAgenteHref: string;
  hablarHref: string;
  loginHref: string;
};

// Isla cliente mínima del navbar: solo el estado abierto/cerrado del menú móvil. El resto del navbar es servidor.
export function HomeMobileMenu({ links, crearAgenteHref, hablarHref, loginHref }: Props) {
  const [abierto, setAbierto] = useState(false);
  const cerrar = () => setAbierto(false);

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  return (
    <div className="flex items-center lg:hidden">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls="home-menu-movil"
        aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
        onClick={() => setAbierto((v) => !v)}
        className="-mr-2.5 grid size-11 place-items-center rounded-lg text-site-fg/85 transition-colors hover:text-site-fg"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          {abierto ? (
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          ) : (
            <path d="M3 6h12M3 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {abierto && (
        <div
          id="home-menu-movil"
          className="absolute inset-x-0 top-full border-b border-site-border bg-site-bg px-5 pb-6 pt-2 shadow-[0_24px_40px_-24px_rgba(0,0,0,0.9)]"
        >
          <nav aria-label="Menú principal" className="flex flex-col">
            {links.map((l) => (
              <TrackedLink
                key={l.href}
                href={l.href}
                source="nav_movil_menu"
                onNavigate={cerrar}
                className="flex h-12 items-center justify-between border-b border-site-border text-[15px] text-site-fg"
              >
                {l.label}
                <span aria-hidden className="text-site-muted-fg">→</span>
              </TrackedLink>
            ))}
          </nav>
          <div className="mt-5 grid gap-3">
            <TrackedLink
              href={crearAgenteHref}
              event="cta_crear_agente"
              source="nav_movil"
              onNavigate={cerrar}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-dev-accent text-[14.5px] font-medium text-dev-accent-fg transition-colors hover:bg-dev-accent-hover"
            >
              Crear mi agente
              <span aria-hidden>→</span>
            </TrackedLink>
            <TrackedLink
              href={hablarHref}
              event="cta_whatsapp"
              source="nav_movil_hablar"
              onNavigate={cerrar}
              className="inline-flex h-12 items-center justify-center rounded-lg border border-white/[0.16] text-[14.5px] font-medium text-site-fg"
            >
              Hablar con DuLabs
            </TrackedLink>
            <TrackedLink
              href={loginHref}
              source="nav_movil_login"
              onNavigate={cerrar}
              className="inline-flex h-11 items-center justify-center text-[14px] text-site-muted-fg"
            >
              Iniciar sesión
            </TrackedLink>
          </div>
        </div>
      )}
    </div>
  );
}
