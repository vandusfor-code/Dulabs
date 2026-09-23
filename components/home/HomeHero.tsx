import type { CSSProperties } from "react";
import { ChartNoAxesColumnIncreasing, ChevronDown, ShieldCheck, Zap } from "lucide-react";
import { CREAR_AGENTE_HREF, HABLAR_CON_DULABS_HREF } from "@/lib/home/links";
import { BOTON_PRIMARIO, Contenedor } from "./atoms";
import { AuroraField } from "./AuroraField";
import { TrackedLink } from "./TrackedLink";

// Hero de la home. Negro + blanco + UNA aurora azul/violeta (AuroraField, WebGL). Servidor salvo la aurora: el H1 renderiza de inmediato
// (sin animación, protege el LCP) y la aurora arranca después sin bloquear nada.
//
// Un solo DOM para las dos composiciones:
//   desktop (lg+): contenido a la izquierda, la aurora posicionada absoluta a la derecha, más los detalles editoriales laterales.
//   mobile/tablet: micro-label -> H1 -> subtítulo -> aurora (cinta a todo el ancho) -> CTAs -> beneficios -> "Descubre más".
const d = (ms: number): CSSProperties => ({ ["--home-d" as string]: `${ms}ms` });

const BENEFICIOS = [
  { icono: Zap, a: "Implementación", b: "rápida" },
  { icono: ShieldCheck, a: "Seguridad", b: "empresarial" },
  { icono: ChartNoAxesColumnIncreasing, a: "Resultados", b: "medibles" },
];

const BOTON_SECUNDARIO_HERO =
  "inline-flex h-12 items-center justify-center rounded-lg border border-white/[0.16] px-6 text-[14.5px] font-medium text-site-fg transition-colors hover:border-white/35 hover:bg-white/[0.03]";

export function HomeHero() {
  return (
    <section className="home-hero relative isolate overflow-hidden lg:flex lg:min-h-[calc(100svh-4rem)] lg:flex-col lg:justify-center xl:min-h-[calc(100svh-4.5rem)]">
      {/* Detalles editoriales de desktop: líneas verticales, rótulo lateral e indicadores. En mobile no existen. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
        <span className="home-hero-rule left-[54%]" />
        <span className="home-hero-rule right-[13.5%]" />
        <p className="absolute right-[3.2%] top-[22%] font-mono text-[10px] uppercase leading-[1.9] tracking-[0.32em] text-white/70">
          IA
          <br />
          que
          <br />
          conecta
          <br />
          posibilidades
          <span className="mt-3 block h-px w-6 bg-white/30" />
        </p>
        <ul className="absolute bottom-[14%] right-[3.2%] grid gap-3.5 font-mono text-[10px] uppercase tracking-[0.28em] text-white/75">
          {["Sistemas", "Personas", "Oportunidades"].map((etiqueta) => (
            <li key={etiqueta} className="home-hero-indicador flex items-center gap-3.5">
              <span className="home-hero-punto" />
              {etiqueta}
            </li>
          ))}
        </ul>
      </div>

      <Contenedor ancho="hero" className="relative z-10 pt-12 md:pt-16 lg:pt-10">
        <div className="lg:max-w-[46%]">
          <p className="home-seq flex items-start gap-3 font-mono text-[10px] uppercase leading-[1.7] tracking-[0.24em] text-site-muted-fg sm:text-[11px]" style={d(0)}>
            <span aria-hidden className="mt-[0.8em] h-px w-7 shrink-0 bg-white/30" />
            <span className="max-w-[17rem] sm:max-w-none">Tecnología que impulsa operaciones</span>
          </p>

          <h1 className="home-hero-h1 mt-6 font-semibold text-site-fg lg:mt-8">
            <span className="block whitespace-nowrap">Automatización</span>
            <span className="block whitespace-nowrap">sin límites.</span>
          </h1>

          <p
            className="home-seq mt-6 max-w-[34rem] text-[17px] leading-[1.5] text-[#a1a1a1] md:text-[18px] lg:mt-8 lg:text-[clamp(17px,1.15vw,20px)] lg:leading-[1.55]"
            style={d(90)}
          >
            Conecta tus sistemas, automatiza procesos
            <br className="hidden sm:block" /> y escala con agentes de IA. Todo desde WhatsApp.
          </p>
        </div>
      </Contenedor>

      {/* Mobile/tablet: cinta a todo el ancho entre el texto y las acciones. Desktop: bloque absoluto a la derecha. */}
      <AuroraField className="home-seq relative mt-3 h-[clamp(220px,64vw,300px)] w-full md:h-[340px] lg:absolute lg:inset-y-0 lg:left-[33%] lg:right-0 lg:mt-0 lg:h-auto lg:w-auto" />

      <Contenedor ancho="hero" className="relative z-10 pb-10 lg:pb-24">
        <div className="lg:max-w-[46%]">
          <div className="home-seq -mt-2 flex w-full max-w-[420px] flex-col gap-3 sm:max-w-none sm:flex-row md:mt-0 lg:mt-10" style={d(160)}>
            <TrackedLink href={CREAR_AGENTE_HREF} event="cta_crear_agente" source="hero" className={`${BOTON_PRIMARIO} w-full sm:w-auto`}>
              Crear mi agente
              <span aria-hidden>→</span>
            </TrackedLink>
            <TrackedLink href={HABLAR_CON_DULABS_HREF} event="cta_whatsapp" source="hero" className={`${BOTON_SECUNDARIO_HERO} w-full sm:w-auto`}>
              Hablar con DuLabs
            </TrackedLink>
          </div>

          <ul className="home-seq mt-10 grid gap-5 lg:mt-16 lg:flex lg:items-center lg:gap-0" style={d(220)}>
            {BENEFICIOS.map(({ icono: Icono, a, b }, i) => (
              <li
                key={a}
                className={`flex items-center gap-3.5 text-[15px] leading-[1.35] text-[#d0d0d0] lg:gap-4 lg:text-[14px] ${
                  i > 0 ? "lg:ml-8 lg:border-l lg:border-white/15 lg:pl-8 xl:ml-9 xl:pl-9" : ""
                }`}
              >
                <Icono aria-hidden className="size-5 shrink-0 text-site-fg lg:size-[26px]" strokeWidth={1.5} />
                <span>
                  {a} <br className="hidden lg:block" />
                  {b}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Contenedor>

      <a
        href="#capacidades"
        className="home-seq relative z-10 mx-auto mb-8 flex w-fit flex-col items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-site-muted-fg transition-colors hover:text-site-fg lg:absolute lg:inset-x-0 lg:bottom-6 lg:mb-0 lg:gap-3 lg:text-[11px] lg:text-white/80"
        style={d(280)}
      >
        <span aria-hidden className="home-hero-raton hidden lg:block" />
        Descubre más
        <ChevronDown aria-hidden className="home-hero-chevron size-4" strokeWidth={1.5} />
      </a>
    </section>
  );
}
