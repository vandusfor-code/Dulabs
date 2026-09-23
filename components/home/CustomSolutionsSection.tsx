import { CAPACIDADES_A_MEDIDA } from "@/lib/home/enterprise";
import { CASOS_HREF, ENTERPRISE_HREF, HABLAR_ESPECIALISTA_HREF } from "@/lib/home/links";
import { BOTON_PRIMARIO, Caption, ENLACE_FLECHA, HomeSection, SectionHeader } from "./atoms";
import { VizRed } from "./HomeViz";
import { TrackedLink } from "./TrackedLink";

// Enterprise ("A la medida"): la línea empresarial de DuLabs como infraestructura, no como otra grilla. Arriba el mensaje y una red de
// capacidades que se traza despacio al entrar en pantalla (SVG + CSS, una sola vez); abajo las 4 líneas de trabajo como una tabla editorial
// (título, qué es y ejemplos). Sin clientes, logos, cifras ni plazos inventados; el único caso que se nombra es DuMo, ya publicado en /casos.
// La cotización y el tiempo dependen del alcance. El detalle vive en /soluciones-empresariales.
const RED = ["CRM", "IA", "Automatización", "Integraciones", "Software", "Datos"] as const;

export function CustomSolutionsSection() {
  return (
    <HomeSection id="empresas" titleId="empresas-titulo" className="home-empresas">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16 xl:gap-24">
        <div>
          <SectionHeader eyebrow="A la medida · Soluciones tecnológicas" titleId="empresas-titulo" title="No todas las empresas necesitan la misma tecnología.">
            <p>
              DuLabs también diseña e implementa automatización empresarial, integraciones y agentes de IA personalizados para empresas con procesos propios. Cotización personalizada
              según el alcance; el tiempo depende del proyecto.
            </p>
          </SectionHeader>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <TrackedLink href={HABLAR_ESPECIALISTA_HREF} event="cta_whatsapp" source="a_la_medida" className={BOTON_PRIMARIO}>
              Hablar con un especialista
              <span aria-hidden>→</span>
            </TrackedLink>
            <TrackedLink href={ENTERPRISE_HREF} event="cta_enterprise" source="a_la_medida" className={ENLACE_FLECHA}>
              Ver soluciones empresariales
              <span aria-hidden className="transition-transform group-hover/enlace:translate-x-0.5">→</span>
            </TrackedLink>
          </div>
        </div>

        <div data-fx className="home-red mx-auto w-full max-w-[34rem]">
          <VizRed etiquetas={RED} />
        </div>
      </div>

      <dl className="home-tabla mt-16 border-t border-site-border lg:mt-20">
        {CAPACIDADES_A_MEDIDA.map((c) => (
          <div key={c.titulo} className="home-tabla-fila">
            <dt className="text-[19px] font-medium tracking-tight text-site-fg md:text-[21px]">{c.titulo}</dt>
            <dd className="text-[15px] leading-relaxed text-site-muted-fg">{c.texto}</dd>
            <dd className="font-mono text-[11.5px] leading-relaxed text-white/55">{c.items.join("  ·  ")}</dd>
          </div>
        ))}
      </dl>
      <Caption>Ejemplos de lo que podemos desarrollar: no todos los proyectos incluyen todo esto.</Caption>

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px] leading-relaxed text-site-muted-fg">
        <p>
          Un ejemplo publicado: <span className="text-site-fg">DuMo</span>, el CRM propio que desarrollamos para gestionar leads y conversaciones de WhatsApp.
        </p>
        <TrackedLink href={CASOS_HREF} source="a_la_medida_caso" className={ENLACE_FLECHA}>
          Ver casos
          <span aria-hidden className="transition-transform group-hover/enlace:translate-x-0.5">→</span>
        </TrackedLink>
      </div>
    </HomeSection>
  );
}
