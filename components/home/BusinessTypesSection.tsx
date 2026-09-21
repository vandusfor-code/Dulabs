import { ETIQUETA_CAPACIDAD } from "@/lib/home/capabilities";
import { ENTERPRISE_HREF } from "@/lib/home/links";
import { RUBROS } from "@/lib/home/negocios";
import { HomeSection, SectionHeader, Tag } from "./atoms";
import { retraso } from "./ChatBubbles";
import { TrackedLink } from "./TrackedLink";

// Rubros: una lista editorial (no una parrilla de tarjetas). Los nombres son los tipos de negocio reales del Wizard y cada fila usa solo
// capacidades disponibles hoy. Restaurante y Tienda cotizan y pasan al equipo; no toman pedidos.
export function BusinessTypesSection() {
  return (
    <HomeSection id="negocios" titleId="negocios-titulo">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <SectionHeader eyebrow="Para qué negocios" titleId="negocios-titulo" title="Para el negocio que atiende a sus clientes por WhatsApp." className="lg:sticky lg:top-28 lg:self-start">
          <p>
            Al crear tu agente eliges tu tipo de negocio y configuras lo que necesitas: agenda, catálogo, conocimiento o todo junto. Estos son los tipos de negocio que ofrece el
            asistente de configuración.
          </p>
        </SectionHeader>

        <div>
          <ul className="border-y border-site-border">
            {RUBROS.map((r, i) => (
              <li key={r.tipos.join()} className="home-seq grid gap-3 border-t border-site-border py-5 first:border-t-0 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] sm:gap-8" style={retraso(100 + i * 130)}>
                <p className="text-[15px] font-medium leading-snug text-site-fg">{r.tipos.join(" · ")}</p>
                <div>
                  <p className="text-[14.5px] leading-relaxed text-site-muted-fg">{r.resuelve}</p>
                  <p className="mt-3 flex flex-wrap gap-1.5">
                    {r.capacidades.map((c) => (
                      <Tag key={c}>{ETIQUETA_CAPACIDAD[c]}</Tag>
                    ))}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <p className="text-[14.5px] leading-relaxed text-site-muted-fg">¿Tu operación necesita más que un agente configurable?</p>
            <TrackedLink
              href={ENTERPRISE_HREF}
              event="cta_enterprise"
              source="rubros"
              className="group inline-flex min-h-11 items-center gap-1.5 text-[14px] text-site-fg transition-colors underline-offset-4 hover:underline"
            >
              Lo construimos a la medida
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
            </TrackedLink>
          </div>
        </div>
      </div>
    </HomeSection>
  );
}
