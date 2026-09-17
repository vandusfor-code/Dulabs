"use client";

import Link from "next/link";

// DuLabs Developer V1 -- checklist de onboarding para el Overview. Reemplaza el
// estado vacío "Select a workspace" por una guía real de primeros pasos. El
// estado "completado" de cada paso se DERIVA de datos reales del workspace
// (número conectado, API key activa, plan) -- nunca se marca hecho a ciegas.

export type PasoOnboarding = {
  id: string;
  titulo: string;
  descripcion: string;
  href: string;
  cta: string;
  hecho: boolean;
};

function IconoPaso({ hecho, numero }: { hecho: boolean; numero: number }) {
  if (hecho) {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dev-accent text-dev-accent-fg">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-edge bg-ink-2 text-xs font-semibold text-mist">
      {numero}
    </span>
  );
}

export function OnboardingChecklist({ nombre, pasos }: { nombre: string; pasos: PasoOnboarding[] }) {
  const completados = pasos.filter((p) => p.hecho).length;
  const total = pasos.length;
  const progreso = total > 0 ? Math.round((completados / total) * 100) : 0;

  return (
    <section className="rounded-xl border border-edge bg-card p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-fg">Bienvenido a DuLabs Developers{nombre ? `, ${nombre}` : ""}.</h2>
        <p className="text-sm text-mist">Tu workspace está listo. Completa estos pasos para empezar a construir.</p>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-2">
          <div className="h-full rounded-full bg-dev-accent transition-all" style={{ width: `${progreso}%` }} />
        </div>
        <span className="text-xs font-medium text-mist">{completados}/{total}</span>
      </div>

      <ol className="mt-5 flex flex-col gap-2.5">
        {pasos.map((paso, i) => (
          <li
            key={paso.id}
            className={`flex items-center gap-3 rounded-lg border p-3 ${
              paso.hecho ? "border-edge/60 bg-ink-2/30" : "border-edge bg-ink-2/50"
            }`}
          >
            <IconoPaso hecho={paso.hecho} numero={i + 1} />
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${paso.hecho ? "text-mist line-through" : "text-fg"}`}>{paso.titulo}</p>
              <p className="truncate text-xs text-mist">{paso.descripcion}</p>
            </div>
            {paso.hecho ? (
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-dev-accent">Listo</span>
            ) : (
              <Link
                href={paso.href}
                className="shrink-0 rounded-md bg-dev-accent px-3 py-1.5 text-xs font-medium text-dev-accent-fg transition-colors hover:bg-dev-accent-hover"
              >
                {paso.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
