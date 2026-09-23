import type { CSSProperties } from "react";
import { ETAPAS_CREA_TU_AGENTE } from "@/lib/home/capabilities";
import { CREAR_AGENTE_HREF } from "@/lib/home/links";
import { ENLACE_FLECHA, HomeSection, SectionHeader, Tag } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Cómo funciona "Crea tu agente": un FLUJO, no cinco tarjetas. Crea -> Configura -> Prueba -> Publica -> Administra sobre una pista cuyo
// progreso se ilumina con el scroll (ScrollFx: data-fx-grupo). Desktop (xl): la pista queda fija con CSS sticky mientras el usuario hace
// scroll por un tramo más alto; los disparadores invisibles (.home-flujo-marca) activan una etapa cada ~22vh. Mobile: línea vertical y cada
// etapa se activa al cruzar el centro. Sin scroll hijacking: el scroll nunca se bloquea. Las etiquetas son pasos REALES del Wizard (un test
// los contrasta con el código); "Prueba" es la vista previa simulada y "Administra" el historial de versiones del panel.
const marca = (i: number): CSSProperties => ({ top: `calc(5vh + 11rem + ${i * 22}vh)` });

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

      <div data-fx-grupo className="home-flujo relative mt-12 xl:mt-4 xl:h-[170vh]">
        {ETAPAS_CREA_TU_AGENTE.map((e, i) => (
          <span key={e.n} aria-hidden data-fx-disparador className="home-flujo-marca hidden xl:block" style={marca(i)} />
        ))}

        <div className="xl:sticky xl:top-[max(5.5rem,calc(50vh-11rem))] xl:pt-10">
          <ol className="home-flujo-lista relative grid gap-9 xl:grid-cols-5 xl:gap-8">
            {ETAPAS_CREA_TU_AGENTE.map((e, i) => (
              <li key={e.n} data-fx-i={i} className="home-flujo-etapa relative pl-10 xl:pl-0 xl:pt-11">
                <span aria-hidden data-fx-disparador className="absolute top-0 xl:hidden" />
                <span aria-hidden className="home-flujo-nodo" />
                <div className="flex items-baseline gap-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-muted-fg">{e.n}</p>
                  <p className="home-flujo-titulo text-[24px] font-medium leading-none tracking-[-0.02em] text-site-fg xl:text-[26px]">{e.titulo}</p>
                </div>
                <div className="home-flujo-cuerpo">
                  <p className="mt-3 max-w-[30rem] text-[14.5px] leading-relaxed text-site-muted-fg">{e.texto}</p>
                  {e.pasos.length ? (
                    <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Pasos del asistente">
                      {e.pasos.map((p) => (
                        <li key={p}>
                          <Tag>{p}</Tag>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </HomeSection>
  );
}
