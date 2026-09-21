import { ETAPAS_CREA_TU_AGENTE } from "@/lib/home/capabilities";
import { CREAR_AGENTE_HREF } from "@/lib/home/links";
import { ENLACE_FLECHA, HomeSection, SectionHeader, Tag } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Cómo funciona "Crea tu agente": el corazón del producto nuevo. Crea -> Configura -> Prueba -> Publica -> Administra, y el mensaje claro de
// que el agente estándar lo configura el cliente. Las etiquetas de cada etapa son pasos REALES del Wizard (un test los contrasta con el
// código); "Prueba" es la vista previa simulada y "Administra" el historial de versiones del panel.
export function HowItWorksSection() {
  return (
    <HomeSection id="como-funciona" titleId="como-funciona-titulo">
      <div className="grid gap-8 lg:grid-cols-2 lg:items-end lg:gap-16">
        <SectionHeader eyebrow="Crea tu agente" titleId="como-funciona-titulo" title="Tu agente estándar lo configuras tú." />
        <div>
          <p className="max-w-[40rem] text-[16px] leading-[1.65] text-site-muted-fg md:text-[17px]">
            Con el asistente paso a paso del panel cargas la información de tu negocio, pruebas y publicas. Lo creas, lo configuras y lo administras tú mismo, sin necesidad de
            programar.
          </p>
          <TrackedLink href={CREAR_AGENTE_HREF} event="cta_crear_agente" source="como_funciona" className={`mt-2 ${ENLACE_FLECHA}`}>
            Crear mi agente
            <span aria-hidden className="transition-transform group-hover/enlace:translate-x-0.5">→</span>
          </TrackedLink>
        </div>
      </div>

      <ol className="mt-10 grid gap-3 xl:mt-12 xl:grid-cols-5 xl:gap-4">
        {ETAPAS_CREA_TU_AGENTE.map((e, i) => (
          <li key={e.n} className="relative rounded-xl border border-site-border bg-site-card/50 p-4 sm:p-5 md:grid md:grid-cols-[11rem_minmax(0,1fr)] md:gap-x-8 xl:block xl:p-6">
            <div className="flex items-baseline gap-3 md:block">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-muted-fg">{e.n}</p>
              <p className="text-[22px] font-medium leading-none tracking-tight text-site-fg md:mt-2">{e.titulo}</p>
            </div>
            <div className="mt-2.5 md:mt-0 xl:mt-5">
              <p className="text-[14.5px] leading-relaxed text-site-muted-fg">{e.texto}</p>
              {e.pasos.length ? (
                <ul className="mt-3.5 flex flex-wrap gap-1.5" aria-label="Pasos del asistente">
                  {e.pasos.map((p) => (
                    <li key={p}>
                      <Tag>{p}</Tag>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {i < ETAPAS_CREA_TU_AGENTE.length - 1 ? (
              <span
                aria-hidden
                className="absolute -right-[14px] top-1/2 z-10 hidden size-6 -translate-y-1/2 place-items-center rounded-full border border-site-border bg-site-bg text-[11px] text-site-muted-fg xl:grid"
              >
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </HomeSection>
  );
}
