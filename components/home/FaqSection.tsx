import { todasLasFaq } from "@/lib/home/faq";
import { ENLACE_FLECHA, HomeSection, SectionHeader } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Preguntas frecuentes VISIBLES: las 8 que deciden una compra (la FAQ completa está en /preguntas-frecuentes). Acordeón editorial numerado
// sobre <details> nativo: sin JS, accesible con teclado y con todo el texto de las respuestas ya en el HTML del servidor; la apertura se anima
// en CSS (altura + opacidad, .home-faq) donde el navegador lo soporta. El texto sale de lib/home/faq.ts, la misma
// fuente del JSON-LD FAQPage (lib/home/seo.ts): no hay contenido oculto solo para SEO. El enlace de cada respuesta va FUERA del bloque
// `data-faq-respuesta` para que ese bloque coincida exactamente con el JSON-LD. Columna de lectura más estrecha que el resto de la página.
export function FaqSection() {
  return (
    <HomeSection id="preguntas-frecuentes" titleId="preguntas-frecuentes-titulo" ancho="read">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
        <SectionHeader eyebrow="Preguntas frecuentes" titleId="preguntas-frecuentes-titulo" title="Respuestas claras antes de empezar." className="lg:sticky lg:top-28 lg:self-start">
          <p>Lo esencial sobre crear tu agente de IA. ¿Otra duda? Está en la lista completa.</p>
          <TrackedLink href="/preguntas-frecuentes" source="faq_todas" className={`mt-3 ${ENLACE_FLECHA}`}>
            Ver todas las preguntas
            <span aria-hidden className="transition-transform group-hover/enlace:translate-x-0.5">→</span>
          </TrackedLink>
        </SectionHeader>

        <div className="home-faq border-t border-site-border">
          {todasLasFaq().map((item, i) => (
            <details key={item.id} id={`faq-${item.id}`} className="home-faq-item group scroll-mt-24">
              <summary className="home-faq-summary flex min-h-14 cursor-pointer list-none items-start gap-5 py-5 text-[16px] font-medium leading-snug text-site-fg md:gap-8 md:text-[17px] [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="mt-[0.2em] w-6 shrink-0 font-mono text-[11px] font-normal tracking-[0.12em] text-site-muted-fg">{String(i + 1).padStart(2, "0")}</span>
                <span data-faq-pregunta>{item.pregunta}</span>
                <span aria-hidden className="home-faq-signo mt-0.5 shrink-0" />
              </summary>
              <div className="pb-6 pl-11 pr-10 md:pl-14">
                <div data-faq-respuesta className="space-y-3 text-[15px] leading-[1.7] text-site-muted-fg">
                  {item.respuesta.map((parrafo) => (
                    <p key={parrafo.slice(0, 40)}>{parrafo}</p>
                  ))}
                </div>
                {item.enlaces?.length ? (
                  <p className="mt-3 flex flex-wrap gap-x-6">
                    {item.enlaces.map((enlace) => (
                      <TrackedLink key={enlace.href} href={enlace.href} source={`faq_${item.id}`} className={ENLACE_FLECHA}>
                        {enlace.texto}
                        <span aria-hidden className="transition-transform group-hover/enlace:translate-x-0.5">→</span>
                      </TrackedLink>
                    ))}
                  </p>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </div>
    </HomeSection>
  );
}
