import { CREAR_AGENTE_HREF, HABLAR_CON_DULABS_HREF } from "@/lib/home/links";
import { retraso } from "./ChatBubbles";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, Contenedor } from "./atoms";
import { HeroProduct } from "./HeroProduct";
import { TrackedLink } from "./TrackedLink";

// Hero de la home: el protagonista de la página. Servidor puro: el H1 es texto visible desde el primer render (sin revelado por palabras ni
// blur, que retrasaban el LCP). Dos columnas amplias (texto a la izquierda, producto funcionando a la derecha) con MÁXIMO un CTA principal y
// uno secundario -- las dos formas de trabajar con DuLabs ("Crea tu agente" / "A la medida") quedan como una línea informativa breve, sin
// tarjetas ni enlaces propios: el detalle completo de cada una vive más abajo en la página. `.home-hero` la excluye del revelado al hacer
// scroll (globals.css) porque esta entra con su propia secuencia al cargar (`.home-seq`, ver ChatBubbles.tsx).
export function HomeHero() {
  return (
    <section className="home-hero relative overflow-hidden">
      <div aria-hidden className="home-grid pointer-events-none absolute inset-0" />

      <Contenedor
        ancho="hero"
        className="relative grid gap-12 pb-14 pt-10 md:pt-14 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center lg:gap-14 lg:pb-20 lg:pt-16 xl:gap-20 2xl:pb-28 2xl:pt-24"
      >
        <div>
          <p
            className="home-seq inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-site-muted-fg sm:text-[11px] sm:tracking-[0.18em]"
            style={retraso(0)}
          >
            <span className="dev-live-dot size-1.5 rounded-full bg-site-fg" />
            IA · Automatización · Software empresarial
          </p>

          <h1
            className="home-seq mt-6 max-w-[16ch] text-balance text-[clamp(2.625rem,1.1rem_+_3.7vw,5rem)] font-medium leading-[1.03] tracking-[-0.035em] text-site-fg"
            style={retraso(70)}
          >
            Agentes de IA que hacen más que responder.
          </h1>

          <p className="home-seq mt-6 max-w-[38rem] text-[16px] leading-[1.65] text-site-muted-fg md:text-[17px] xl:text-[18px]" style={retraso(140)}>
            Crea un agente que atiende a tus clientes por WhatsApp, consulta la información de tu negocio, muestra tu catálogo y agenda citas en tu
            calendario. Para operaciones más complejas, DuLabs construye e integra la solución contigo.
          </p>

          <div className="home-seq mt-9 flex flex-col gap-3 sm:flex-row" style={retraso(210)}>
            <TrackedLink href={CREAR_AGENTE_HREF} event="cta_crear_agente" source="hero" className={BOTON_PRIMARIO}>
              Crear mi agente
              <span aria-hidden>→</span>
            </TrackedLink>
            <TrackedLink href={HABLAR_CON_DULABS_HREF} event="cta_whatsapp" source="hero" className={BOTON_SECUNDARIO}>
              Hablar con DuLabs
            </TrackedLink>
          </div>

          <div className="home-seq mt-10 flex flex-col gap-4 border-t border-site-border pt-6 sm:flex-row sm:gap-10 xl:mt-12" style={retraso(280)}>
            <p className="text-[13px] leading-relaxed text-site-muted-fg">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-fg">01 · Crea tu agente</span> — agente estándar, lo configuras tú mismo.
            </p>
            <p className="text-[13px] leading-relaxed text-site-muted-fg">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-fg">02 · A la medida</span> — soluciones que DuLabs desarrolla contigo.
            </p>
          </div>
        </div>

        <HeroProduct />
      </Contenedor>
    </section>
  );
}
