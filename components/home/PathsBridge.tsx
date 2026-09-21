import { CREAR_AGENTE_HREF, ENTERPRISE_HREF, HABLAR_CON_DULABS_HREF } from "@/lib/home/links";
import { HomeSection } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Cierre de la parte de producto: refuerza los DOS caminos comerciales sin convertirlos en tarjetas. La sección empresarial completa llega
// en la Fase 4; esto solo deja claro, justo después de mostrar el producto, que se puede hacer solo o construirlo con DuLabs.
export function PathsBridge() {
  return (
    <HomeSection id="caminos" titleId="caminos-titulo">
      <h2 id="caminos-titulo" className="max-w-[22ch] text-balance text-[32px] font-medium leading-[1.06] tracking-[-0.03em] text-site-fg sm:text-[40px] lg:text-[46px]">
        Hazlo tú mismo o construyámoslo contigo.
      </h2>

      <div className="mt-12 grid gap-10 border-t border-site-border pt-10 md:grid-cols-2 md:gap-16">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-fg">Autoservicio</p>
          <p className="mt-3 max-w-[30rem] text-[16px] leading-relaxed text-site-muted-fg">
            Crea, configura, prueba y publica tu propio agente de IA desde el panel de DuLabs, con tu número de WhatsApp y tu Google Calendar.
          </p>
          <TrackedLink
            href={CREAR_AGENTE_HREF}
            event="cta_crear_agente"
            source="puente_caminos"
            className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-home-accent px-6 text-[14.5px] font-medium text-home-accent-fg transition-colors hover:bg-home-accent-hover"
          >
            Crear mi agente de IA
            <span aria-hidden>→</span>
          </TrackedLink>
        </div>

        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-fg">A la medida</p>
          <p className="mt-3 max-w-[30rem] text-[16px] leading-relaxed text-site-muted-fg">
            Si tu empresa necesita automatización empresarial, integraciones con tus sistemas o agentes de IA personalizados, nuestro equipo los diseña e implementa contigo.
          </p>
          <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <TrackedLink
              href={HABLAR_CON_DULABS_HREF}
              event="cta_whatsapp"
              source="puente_caminos"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-site-border bg-site-card px-6 text-[14.5px] font-medium text-site-fg transition-colors hover:border-white/25"
            >
              Hablar con DuLabs
            </TrackedLink>
            <TrackedLink
              href={ENTERPRISE_HREF}
              event="cta_enterprise"
              source="puente_caminos"
              className="group inline-flex min-h-11 items-center gap-1.5 text-[14px] text-site-fg transition-colors hover:text-home-accent"
            >
              Ver soluciones empresariales
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
            </TrackedLink>
          </div>
        </div>
      </div>
    </HomeSection>
  );
}
