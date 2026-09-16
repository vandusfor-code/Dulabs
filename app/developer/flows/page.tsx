"use client";

import { PageHeader } from "@/components/developer/PageHeader";
import { StatusBadge } from "@/components/developer/StatusBadge";

// DuLabs Developer V1 -- Fase 9 (autorizado, D5). Flows: entrada informativa
// hacia las dos formas de construir en Developer V1 (FLOW visual y CODE/API).
// El Flow Builder existente NO se modifica ni se reconstruye; la integración
// segura hacia él para Developer es una dependencia de una fase posterior y
// aquí queda el CTA preparado, documentado, sin deep-link a Business.

export default function FlowsPage() {
  return (
    <>
      <PageHeader title="Flows" description="Build with a visual Flow, or with your own code against the API." />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-edge bg-card p-5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">Flow Builder</h2>
            <StatusBadge tono="neutral">Integration pending</StatusBadge>
          </div>
          <p className="mt-2 text-sm text-mist">
            Design conversational flows visually. The Developer-scoped entry into the Flow Builder ships with onboarding — it&apos;s intentionally not wired here yet to avoid coupling with other products.
          </p>
          <button disabled className="mt-4 cursor-not-allowed rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-mist" title="Coming soon">
            Open Flow Builder
          </button>
        </div>

        <div className="rounded-lg border border-edge bg-card p-5">
          <h2 className="text-sm font-semibold text-fg">Code / API</h2>
          <p className="mt-2 text-sm text-mist">Prefer to own the logic? Call the DuLabs Developer API from your own backend with an API key.</p>
          <a href="/developer/api" className="mt-4 inline-block rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover">
            Go to API quick start
          </a>
        </div>
      </div>
    </>
  );
}
