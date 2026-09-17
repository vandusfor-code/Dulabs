"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// DuLabs Developer V1 -- Fase 14. Navegación del portal público de docs.
export const DOCS_NAV: { title: string; items: { label: string; href: string }[] }[] = [
  {
    title: "Comenzar",
    items: [
      { label: "Introducción", href: "/developers" },
      { label: "Autenticación", href: "/developers/authentication" },
    ],
  },
  {
    title: "Guías",
    items: [
      { label: "Enviar mensajes", href: "/developers/messages" },
      { label: "Webhooks & eventos", href: "/developers/webhooks" },
      { label: "Idempotencia & rate limits", href: "/developers/rate-limits" },
      { label: "Errores", href: "/developers/errors" },
    ],
  },
  {
    title: "Referencia",
    items: [{ label: "API Reference", href: "/developers/reference" }],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav className="space-y-6 text-sm">
      {DOCS_NAV.map((sec) => (
        <div key={sec.title}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-mist">{sec.title}</p>
          <ul className="space-y-1">
            {sec.items.map((it) => {
              const activo = pathname === it.href;
              return (
                <li key={it.href}>
                  <Link href={it.href} className={`block rounded-md px-2 py-1 ${activo ? "bg-dev-accent-soft text-dev-accent" : "text-mist hover:text-fg"}`}>
                    {it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
