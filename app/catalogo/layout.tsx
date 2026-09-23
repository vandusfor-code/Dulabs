import type { Metadata } from "next";
import type { ReactNode } from "react";

// Catálogo público (autorizado): vitrina oscura con blanco, fuera del
// dashboard. `.dash-scope` aplica la misma paleta oscura fija de DuLabs.
// noindex: los catálogos se comparten por link (WhatsApp); no se publican en
// buscadores, y el link mayorista jamás debe indexarse.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function CatalogoPublicoLayout({ children }: { children: ReactNode }) {
  return <div className="dash-scope min-h-screen w-full flex-1 bg-ink text-fg">{children}</div>;
}
