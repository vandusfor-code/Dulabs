import { GRUPOS_FAQ } from "@/lib/home/faq";
import { HomeSection, SectionHeader } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Preguntas frecuentes VISIBLES. Acordeón nativo (<details>): sin JS, accesible con teclado y con todo el texto de las respuestas ya en el
// HTML del servidor. El texto sale de lib/home/faq.ts, la misma fuente del JSON-LD FAQPage (lib/home/seo.ts): no hay contenido oculto
// solo para SEO. El enlace de cada respuesta va FUERA del bloque `data-faq-respuesta` para que ese bloque coincida exactamente con el JSON-LD.
export function FaqSection() {
  return (
    <HomeSection id="preguntas-frecuentes" titleId="preguntas-frecuentes-titulo">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-16">
        <SectionHeader eyebrow="Preguntas frecuentes" titleId="preguntas-frecuentes-titulo" title="Respuestas claras antes de empezar." className="lg:sticky lg:top-28 lg:self-start">
          <p>
            Lo que más se pregunta sobre crear un agente de IA, agendar citas con Google Calendar, usar tu catálogo y tu conocimiento, pasar conversaciones a un asesor y pedir
            soluciones a la medida.
          </p>
          <p className="mt-4">
            <TrackedLink
              href="/preguntas-frecuentes"
              source="faq_todas"
              className="group inline-flex min-h-11 items-center gap-1.5 text-[14px] text-site-fg underline-offset-4 hover:underline"
            >
              Ver todas las preguntas
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
            </TrackedLink>
          </p>
        </SectionHeader>

        <div className="space-y-12">
          {GRUPOS_FAQ.map((grupo) => (
            <div key={grupo.id}>
              <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-muted-fg">{grupo.titulo}</h3>
              <div className="mt-4 divide-y divide-site-border border-y border-site-border">
                {grupo.items.map((item) => (
                  <details key={item.id} id={`faq-${item.id}`} className="group scroll-mt-24">
                    <summary className="flex min-h-14 cursor-pointer list-none items-start justify-between gap-6 py-4 text-[16px] font-medium leading-snug text-site-fg [&::-webkit-details-marker]:hidden">
                      <span data-faq-pregunta>{item.pregunta}</span>
                      <span aria-hidden className="mt-0.5 shrink-0 font-mono text-[18px] leading-none text-site-muted-fg transition-transform duration-200 group-open:rotate-45">
                        +
                      </span>
                    </summary>
                    <div className="pb-5 pr-10">
                      <div data-faq-respuesta className="space-y-3 text-[15px] leading-[1.7] text-site-muted-fg">
                        {item.respuesta.map((parrafo) => (
                          <p key={parrafo.slice(0, 40)}>{parrafo}</p>
                        ))}
                      </div>
                      {item.enlaces?.length ? (
                        <p className="mt-3 flex flex-wrap gap-x-6">
                          {item.enlaces.map((enlace) => (
                            <TrackedLink
                              key={enlace.href}
                              href={enlace.href}
                              source={`faq_${item.id}`}
                              className="group/enlace inline-flex min-h-11 items-center gap-1.5 text-[14px] text-site-fg underline-offset-4 hover:underline"
                            >
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
          ))}
        </div>
      </div>
    </HomeSection>
  );
}
