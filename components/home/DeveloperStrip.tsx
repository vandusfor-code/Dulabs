import { DEVELOPER_DOCS_HREF, DEVELOPER_PLATFORM_HREF } from "@/lib/home/links";
import { HomeSection } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// DuLabs Developer: otra línea de producto de la misma empresa, presentada de forma discreta (sección compacta). Todo lo que nombra existe en
// /developer-platform y /developers: API REST sobre WhatsApp Cloud API oficial, webhooks con firma, API keys y documentación pública.
// components/site/DevelopersEntrySection se evaluó y no se reutiliza: es una tarjeta redondeada con chips, opuesta al lenguaje visual de esta home.
export function DeveloperStrip() {
  return (
    <HomeSection id="developers" titleId="developers-titulo" compacta>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-16">
        <div>
          <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-site-muted-fg">
            <span aria-hidden className="h-px w-5 bg-site-border" />
            DuLabs Developer
          </p>
          <h2 id="developers-titulo" className="mt-4 text-balance text-[24px] font-medium leading-[1.15] tracking-[-0.02em] text-site-fg md:text-[30px]">
            También construimos infraestructura para developers.
          </h2>
          <p className="mt-4 max-w-[34rem] text-[15px] leading-relaxed text-site-muted-fg">
            Una API sobre WhatsApp Cloud API oficial de Meta, con webhooks firmados, API keys y documentación pública, para integrar mensajería en tus propios productos.
          </p>
          <div className="mt-5 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-6">
            <TrackedLink
              href={DEVELOPER_PLATFORM_HREF}
              source="developer_strip"
              className="group inline-flex min-h-11 items-center gap-1.5 text-[14px] text-site-fg transition-colors hover:text-home-accent"
            >
              Explorar la plataforma
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
            </TrackedLink>
            <TrackedLink href={DEVELOPER_DOCS_HREF} source="developer_strip_docs" className="inline-flex min-h-11 items-center text-[14px] text-site-muted-fg transition-colors hover:text-site-fg">
              Ver documentación
            </TrackedLink>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-site-border bg-site-card font-mono text-[12px]">
          <div className="flex items-center gap-2 border-b border-site-border px-3.5 py-2.5 text-site-muted-fg">
            <span aria-hidden className="flex gap-1.5">
              <span className="size-2 rounded-full bg-site-border" />
              <span className="size-2 rounded-full bg-site-border" />
              <span className="size-2 rounded-full bg-site-border" />
            </span>
            <span className="ml-1 text-[11px]">POST /api/v1/messages</span>
          </div>
          <div className="space-y-1.5 px-4 py-4 leading-relaxed">
            <p className="text-site-fg">Authorization: Bearer dl_live_…</p>
            <p className="text-site-muted-fg">→ 201 Created</p>
            <p className="text-site-muted-fg">created → queued → sent → delivered</p>
          </div>
        </div>
      </div>
    </HomeSection>
  );
}
