import Link from "next/link";

// Puerta de descubrimiento de DuLabs Developers desde la landing principal.
// Aditivo: no reemplaza contenido de Business, solo abre la entrada al
// producto para desarrolladores dentro del mismo ecosistema/diseño DuLabs.

const CHIPS = ["WhatsApp Cloud API", "Webhooks", "Flows", "API keys", "Eventos", "Multi-tenant"];

export function DevelopersEntrySection() {
  return (
    <section id="developers" className="relative border-t border-site-border py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-site-border bg-site-card/40 p-8 md:p-12">
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-site-muted-fg">¿Eres desarrollador?</p>
              <h2 className="mt-3 font-display text-2xl font-medium tracking-tight text-site-fg md:text-3xl">
                Construye sobre DuLabs.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-site-muted-fg">
                Conecta WhatsApp, crea flows, usa nuestra API y lleva automatizaciones conversacionales a tus propios
                productos — sobre la misma infraestructura que ya opera DuLabs.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {CHIPS.map((c) => (
                  <span key={c} className="rounded-full border border-site-border bg-site-bg/40 px-3 py-1 text-[12px] text-site-muted-fg">
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-3">
              <Link
                href="/developer-platform"
                className="group inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-site-fg px-5 text-[13px] font-medium text-site-bg transition-all hover:bg-site-fg/90"
              >
                Explorar DuLabs Developers
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
              </Link>
              <Link
                href="/developers"
                className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full border border-site-border px-5 text-[13px] text-site-muted-fg transition-colors hover:text-site-fg"
              >
                Ver documentación
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
