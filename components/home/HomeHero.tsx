import { CREAR_AGENTE_HREF, ENTERPRISE_HREF, HABLAR_CON_DULABS_HREF } from "@/lib/home/links";
import { HeroProduct } from "./HeroProduct";
import { TrackedLink } from "./TrackedLink";

// Hero de la home v3. Servidor puro: el H1 es texto visible desde el primer render (sin revelado por palabras ni blur, que
// retrasaban el LCP y dejaban el título borroso en móvil). Comunica de entrada las DOS formas de trabajar con DuLabs:
// autoservicio (crear el propio agente) y a la medida (automatización e integraciones para empresas).
export function HomeHero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="home-grid pointer-events-none absolute inset-0" />

      <div className="relative mx-auto grid max-w-[1240px] gap-14 px-5 pb-16 pt-12 sm:px-6 md:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.04fr)] lg:items-center lg:gap-16 lg:pb-24 lg:pt-20">
        <div>
          <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-site-muted-fg sm:text-[11px] sm:tracking-[0.18em]">
            <span className="dev-live-dot size-1.5 rounded-full bg-site-fg" />
            IA · Automatización · Software empresarial
          </p>

          <h1 className="mt-6 max-w-[15ch] text-balance text-[42px] font-medium leading-[1.03] tracking-[-0.035em] text-site-fg sm:text-[54px] lg:text-[60px] xl:text-[68px]">
            Agentes de IA que hacen más que responder.
          </h1>

          <p className="mt-6 max-w-[34rem] text-[16px] leading-[1.65] text-site-muted-fg md:text-[17px]">
            Crea un agente que atiende a tus clientes por WhatsApp, consulta la información de tu negocio, muestra tu catálogo y agenda citas en tu
            calendario. Para operaciones más complejas, DuLabs construye e integra la solución contigo.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <TrackedLink
              href={CREAR_AGENTE_HREF}
              event="cta_crear_agente"
              source="hero"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-dev-accent px-6 text-[14.5px] font-medium text-dev-accent-fg transition-colors hover:bg-dev-accent-hover"
            >
              Crear mi agente de IA
              <span aria-hidden>→</span>
            </TrackedLink>
            <TrackedLink
              href={HABLAR_CON_DULABS_HREF}
              event="cta_whatsapp"
              source="hero"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-site-border bg-site-card px-6 text-[14.5px] font-medium text-site-fg transition-colors hover:border-white/25"
            >
              Hablar con DuLabs
            </TrackedLink>
          </div>

          <div className="mt-12 grid gap-7 border-t border-site-border pt-7 sm:grid-cols-2 sm:gap-8">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-fg">Autoservicio</p>
              <p className="mt-2 text-[14px] leading-relaxed text-site-muted-fg">Crea, configura y publica tu propio agente desde el panel. Sin programar.</p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-fg">A la medida</p>
              <p className="mt-2 text-[14px] leading-relaxed text-site-muted-fg">Automatización, integraciones y agentes personalizados para tu empresa.</p>
              <TrackedLink
                href={ENTERPRISE_HREF}
                event="cta_enterprise"
                source="hero"
                className="group -mb-2.5 mt-1 inline-flex min-h-11 items-center gap-1.5 text-[13.5px] text-site-fg transition-colors underline-offset-4 hover:underline"
              >
                Ver soluciones empresariales
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
              </TrackedLink>
            </div>
          </div>
        </div>

        <HeroProduct />
      </div>
    </section>
  );
}
