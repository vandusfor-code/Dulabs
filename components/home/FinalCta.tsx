import { CREAR_AGENTE_HREF, ENTERPRISE_HREF, HABLAR_CON_DULABS_HREF } from "@/lib/home/links";
import { HomeSection } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Cierre de la página: repite las DOS vías de trabajo con DuLabs (crear tu agente / hablar con el equipo) con los mismos destinos del hero.
export function FinalCta() {
  return (
    <HomeSection id="empezar" titleId="empezar-titulo">
      <div className="mx-auto max-w-[46rem] text-center">
        <h2 id="empezar-titulo" className="text-balance text-[32px] font-medium leading-[1.06] tracking-[-0.03em] text-site-fg sm:text-[42px] lg:text-[52px]">
          Tu negocio ya tiene procesos. Ahora pueden trabajar automáticamente.
        </h2>
        <p className="mx-auto mt-6 max-w-[34rem] text-[16px] leading-[1.65] text-site-muted-fg md:text-[17px]">
          Crea tu propio agente de IA desde el panel, o cuéntanos qué necesitas automatizar y lo construimos contigo.
        </p>

        <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <TrackedLink
            href={CREAR_AGENTE_HREF}
            event="cta_crear_agente"
            source="cierre"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-dev-accent px-6 text-[14.5px] font-medium text-dev-accent-fg transition-colors hover:bg-dev-accent-hover"
          >
            Crear mi agente de IA
            <span aria-hidden>→</span>
          </TrackedLink>
          <TrackedLink
            href={HABLAR_CON_DULABS_HREF}
            event="cta_whatsapp"
            source="cierre"
            className="inline-flex h-12 items-center justify-center rounded-lg border border-site-border bg-site-card px-6 text-[14.5px] font-medium text-site-fg transition-colors hover:border-white/25"
          >
            Hablar con DuLabs
          </TrackedLink>
        </div>

        <p className="mt-6">
          <TrackedLink
            href={ENTERPRISE_HREF}
            event="cta_enterprise"
            source="cierre"
            className="group inline-flex min-h-11 items-center gap-1.5 text-[14px] text-site-fg underline-offset-4 hover:underline"
          >
            Ver soluciones empresariales
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
          </TrackedLink>
        </p>
      </div>
    </HomeSection>
  );
}
