import type { CSSProperties } from "react";
import { CAPACIDADES_HOME } from "@/lib/home/capabilities";
import { Caption, ENLACE_FLECHA, HomeSection, SectionHeader } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Qué puede hacer tu agente: índice editorial (no un grid de tarjetas). Encabezado fijo a la izquierda en desktop y, a la derecha, las 7
// capacidades como filas numeradas separadas por líneas finas. Al pasar el cursor la línea se ilumina, el título gana contraste y aparece
// el indicador azul (CSS, .home-cap-*). Las filas entran escalonadas al hacer scroll (data-fx). Cada fila sale de lib/home/capabilities.ts,
// que un test contrasta con las capacidades reales del Runtime.
const d = (i: number): CSSProperties => ({ ["--fx-d" as string]: `${i * 70}ms` });

export function CapabilitiesSection() {
  return (
    <HomeSection id="capacidades" titleId="capacidades-titulo">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20 xl:gap-28">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeader eyebrow="Qué puede hacer tu agente" titleId="capacidades-titulo" title="Lo que tu agente hace por tu negocio.">
            <p>Todo con la información de tu negocio. Tú eliges qué capacidades activar y cómo se comporta.</p>
          </SectionHeader>
          <TrackedLink href="/whatsapp-ia" source="capacidades_mas" className={`mt-6 ${ENLACE_FLECHA}`}>
            Ver todo lo que puede hacer
            <span aria-hidden className="transition-transform group-hover/enlace:translate-x-0.5">→</span>
          </TrackedLink>
        </div>

        <div>
          <ol className="home-cap border-t border-site-border">
            {CAPACIDADES_HOME.map((c, i) => (
              <li key={c.id} data-fx className="home-cap-fila home-fx-subir" style={d(i)}>
                <span className="home-cap-n">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <h3 className="home-cap-titulo">{c.titulo}</h3>
                  <p className="mt-1.5 max-w-[34rem] text-[14.5px] leading-relaxed text-site-muted-fg md:text-[15px]">{c.texto}</p>
                </div>
                <span aria-hidden className="home-cap-indicador" />
              </li>
            ))}
          </ol>
          <Caption>El agente no cobra ni toma pedidos: cuando el cliente quiere comprar, pasa la conversación a tu equipo.</Caption>
        </div>
      </div>
    </HomeSection>
  );
}
