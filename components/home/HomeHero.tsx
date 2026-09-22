import { CREAR_AGENTE_HREF, ENTERPRISE_HREF, HABLAR_CON_DULABS_HREF } from "@/lib/home/links";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, Contenedor } from "./atoms";
import { HeroProduct } from "./HeroProduct";
import { TrackedLink } from "./TrackedLink";

// Hero de la home. Servidor puro: el H1 es texto visible desde el primer render (sin revelado por palabras ni blur, que retrasaban el LCP).
// Dos columnas que aprovechan el ancho de pantallas grandes (texto a la izquierda, mockup del agente a la derecha) y comunican de entrada
// las DOS formas de trabajar con DuLabs: "Crea tu agente" (agente estándar que el cliente configura solo) y "A la medida" (soluciones
// empresariales que DuLabs desarrolla con él).
export function HomeHero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="home-grid pointer-events-none absolute inset-0" />

      <Contenedor
        ancho="hero"
        className="relative grid gap-12 pb-14 pt-10 md:pt-14 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center lg:gap-14 lg:pb-20 lg:pt-16 xl:gap-20 2xl:pb-28 2xl:pt-24"
      >
        <div>
          <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-site-muted-fg sm:text-[11px] sm:tracking-[0.18em]">
            <span className="dev-live-dot size-1.5 rounded-full bg-site-fg" />
            IA · Automatización · Software empresarial
          </p>

          <h1 className="mt-6 max-w-[16ch] text-balance text-[clamp(2.625rem,1.1rem_+_3.7vw,5rem)] font-medium leading-[1.03] tracking-[-0.035em] text-site-fg">
            Agentes de IA que hacen más que responder.
          </h1>

          <p className="mt-6 max-w-[38rem] text-[16px] leading-[1.65] text-site-muted-fg md:text-[17px] xl:text-[18px]">
            Crea un agente que atiende a tus clientes por WhatsApp, consulta la información de tu negocio, muestra tu catálogo y agenda citas en tu
            calendario. Para operaciones más complejas, DuLabs construye e integra la solución contigo.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <TrackedLink href={CREAR_AGENTE_HREF} event="cta_crear_agente" source="hero" className={BOTON_PRIMARIO}>
              Crear mi agente
              <span aria-hidden>→</span>
            </TrackedLink>
            <TrackedLink href={HABLAR_CON_DULABS_HREF} event="cta_whatsapp" source="hero" className={BOTON_SECUNDARIO}>
              Hablar con DuLabs
            </TrackedLink>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:mt-12 xl:grid-cols-2 xl:gap-4">
            <div className="rounded-xl border border-site-border bg-site-card/40 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-fg">
                <span className="text-site-muted-fg">01</span> · Crea tu agente
              </p>
              <p className="mt-2.5 text-[14px] leading-relaxed text-site-muted-fg">Agente estándar que configuras tú mismo desde el panel, sin programar: creas, pruebas, publicas y administras.</p>
            </div>
            <div className="rounded-xl border border-site-border bg-site-card/40 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-fg">
                <span className="text-site-muted-fg">02</span> · A la medida
              </p>
              <p className="mt-2.5 text-[14px] leading-relaxed text-site-muted-fg">
                Soluciones empresariales que DuLabs desarrolla contigo: automatizaciones, integraciones y desarrollos personalizados.
              </p>
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
      </Contenedor>
    </section>
  );
}
