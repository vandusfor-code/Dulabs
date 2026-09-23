import type { Metadata } from "next";
import type { ReactNode } from "react";

// Catálogo público (autorizado), fuera del dashboard. Cada página declara su
// tema: el detal es la vitrina de tienda (.catalogo-tienda, claro cálido) y el
// mayorista conserva la paleta oscura fija de DuLabs (.dash-scope).
// noindex: los catálogos se comparten por link (WhatsApp); no se publican en
// buscadores, y el link mayorista jamás debe indexarse.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function CatalogoPublicoLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen w-full flex-1 flex-col">{children}</div>;
}
