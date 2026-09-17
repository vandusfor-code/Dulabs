import type { ReactNode } from "react";
import Link from "next/link";
import { DocsSidebar } from "@/components/developers/DocsSidebar";

// DuLabs Developer V1 -- Fase 14. Portal de documentación PÚBLICO (sin login),
// namespace /developers (distinto del dashboard autenticado /developer). Solo
// documentación estática derivada del contrato real; nunca ejecuta llamadas ni
// expone secretos.

export const metadata = {
  title: "DuLabs Developer API — Documentación",
  description: "Envía mensajes de WhatsApp con la API de DuLabs Developer: quickstart, autenticación, webhooks, errores y referencia.",
};

export default function DevelopersDocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-edge">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/developers" className="text-sm font-semibold text-fg">DuLabs Developer <span className="text-mist">· Docs</span></Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/developers/reference" className="text-mist hover:text-fg">API Reference</Link>
            <Link href="/developer" className="rounded-md bg-dev-accent px-3 py-1.5 text-xs font-medium text-dev-accent-fg hover:bg-dev-accent-hover">Ir al dashboard</Link>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-8 px-6 py-8">
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-8">
            <DocsSidebar />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <article className="max-w-2xl">{children}</article>
        </main>
      </div>
    </div>
  );
}
