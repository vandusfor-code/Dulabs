import type { CSSProperties } from "react";
import { CREAR_AGENTE_HREF, HABLAR_CON_DULABS_HREF } from "@/lib/home/links";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, Contenedor } from "./atoms";
import { HeroSystem } from "./HeroSystem";
import { TrackedLink } from "./TrackedLink";

// Hero de la home -- composición "enterprise" de dos zonas: mensaje a la izquierda, visualización del SISTEMA (placas de vidrio en
// profundidad) a la derecha (ver HeroSystem + globals.css). Servidor puro: el H1 renderiza de inmediato (sin animación, protege el LCP); el
// resto del contenido y las placas entran con una secuencia suave (home-seq). Identidad monocroma (negro/blanco/gris); el único acento es la
// señal verde de marca que recorre las placas, aplicada en CSS.
const d = (ms: number): CSSProperties => ({ ["--home-d" as string]: `${ms}ms` });

export function HomeHero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="home-grid pointer-events-none absolute inset-0" />

      <Contenedor
        ancho="hero"
        className="relative grid gap-12 pb-16 pt-12 md:pt-16 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] lg:items-center lg:gap-10 lg:pb-24 lg:pt-20 xl:gap-16 2xl:pb-28 2xl:pt-24"
      >
        <div>
          <p className="home-seq flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-site-muted-fg sm:text-[11px]" style={d(0)}>
            <span aria-hidden className="h-px w-8 bg-white/30" />
            Tecnología que impulsa operaciones
          </p>

          <h1 className="mt-7 text-balance text-[clamp(2.75rem,1.2rem_+_5.4vw,8.5rem)] font-medium leading-[0.92] tracking-[-0.04em] text-site-fg">
            Automatización
            <br />
            <span className="bg-gradient-to-b from-white to-white/45 bg-clip-text text-transparent">sin límites.</span>
          </h1>

          <p className="home-seq mt-7 max-w-[34rem] text-[16px] leading-[1.65] text-site-muted-fg md:text-[17px] xl:text-[18px]" style={d(90)}>
            Conecta tus sistemas, automatiza procesos
            <br className="hidden sm:block" /> y escala con agentes de IA. Todo desde WhatsApp.
          </p>

          <div className="home-seq mt-9 flex flex-col gap-3 sm:flex-row" style={d(160)}>
            <TrackedLink href={CREAR_AGENTE_HREF} event="cta_crear_agente" source="hero" className={BOTON_PRIMARIO}>
              Crear mi agente
              <span aria-hidden>→</span>
            </TrackedLink>
            <TrackedLink href={HABLAR_CON_DULABS_HREF} event="cta_whatsapp" source="hero" className={BOTON_SECUNDARIO}>
              Hablar con DuLabs
            </TrackedLink>
          </div>
        </div>

        <div className="home-seq" style={d(140)}>
          <HeroSystem />
        </div>
      </Contenedor>
    </section>
  );
}
