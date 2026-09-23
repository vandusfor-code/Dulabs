import type { ComponentType } from "react";
import { HomeSection, SectionHeader } from "./atoms";
import { VizConexiones, VizDatos, VizFlujo, VizInterfaz } from "./HomeViz";

// Más que WhatsApp: DuLabs no es solo el agente. Cuatro líneas de trabajo como un índice tipográfico grande (no tarjetas); la línea con el
// cursor o el foco queda seleccionada (ScrollFx: data-fx-selector) y a la derecha aparece su visualización mínima en SVG. En mobile cada
// línea muestra su descripción y ejemplos, sin visualización. Textos y ejemplos: los que el sitio ya publica (components/site/EnterpriseSections,
// SolutionsSection), sin clientes ni cifras.
const AREAS: { k: string; titulo: string; texto: string; ejemplos: string[]; Viz: ComponentType }[] = [
  {
    k: "ia",
    titulo: "IA & Automatización",
    texto: "Agentes de IA, automatización de procesos, atención inteligente y flujos que trabajan por tu equipo.",
    ejemplos: ["Agentes de IA", "WhatsApp con IA", "Automatización de procesos", "Seguimiento de clientes"],
    Viz: VizFlujo,
  },
  {
    k: "software",
    titulo: "Software a medida",
    texto: "Construimos las herramientas que tu empresa necesita cuando una solución estándar no es suficiente.",
    ejemplos: ["CRM personalizados", "Plataformas web", "Sistemas internos", "Dashboards"],
    Viz: VizInterfaz,
  },
  {
    k: "integraciones",
    titulo: "Integraciones",
    texto: "Conectamos tus herramientas para que la información fluya automáticamente entre tus sistemas.",
    ejemplos: ["WhatsApp API", "Meta", "CRM", "Supabase"],
    Viz: VizConexiones,
  },
  {
    k: "datos",
    titulo: "Datos & Operaciones",
    texto: "Convertimos información y procesos en sistemas más simples, medibles y automatizados.",
    ejemplos: ["Dashboards", "Reportes", "Analítica", "Control operativo"],
    Viz: VizDatos,
  },
];

export function MoreThanWhatsappSection() {
  return (
    <HomeSection id="soluciones" titleId="soluciones-titulo">
      <SectionHeader eyebrow="Más que WhatsApp" titleId="soluciones-titulo" title="Construimos tecnología para tu negocio.">
        <p>Desde automatizaciones inteligentes hasta plataformas empresariales, diseñamos soluciones adaptadas a la forma en que realmente funciona tu empresa.</p>
      </SectionHeader>

      <div data-fx-selector data-sel="ia" className="home-sol mt-12 grid gap-10 lg:mt-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16 xl:gap-24">
        <ol className="border-t border-site-border">
          {AREAS.map((a, i) => (
            <li key={a.k} data-fx-opcion={a.k} tabIndex={0} className="home-sol-fila">
              <div className="flex items-baseline gap-4 md:gap-6">
                <span className="font-mono text-[11px] tracking-[0.16em] text-site-muted-fg">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="home-sol-titulo">{a.titulo}</h3>
              </div>
              <div className="home-sol-detalle">
                <div className="overflow-hidden">
                  <p className="max-w-[36rem] pt-3 text-[15px] leading-relaxed text-site-muted-fg md:pl-[3.1rem]">{a.texto}</p>
                  <p className="pt-3 font-mono text-[11.5px] leading-relaxed text-white/55 md:pl-[3.1rem]">{a.ejemplos.join("  ·  ")}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div aria-hidden className="home-sol-escenario hidden lg:block">
          {AREAS.map(({ k, titulo, Viz }) => (
            <div key={k} data-k={k} className="home-sol-viz">
              <Viz />
              <p className="mt-4 text-center font-mono text-[10.5px] uppercase tracking-[0.2em] text-site-muted-fg">{titulo}</p>
            </div>
          ))}
        </div>
      </div>
    </HomeSection>
  );
}
