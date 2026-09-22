import { CAPACIDADES_A_MEDIDA } from "@/lib/home/enterprise";
import { CASOS_HREF, ENTERPRISE_HREF, HABLAR_ESPECIALISTA_HREF } from "@/lib/home/links";
import { BOTON_PRIMARIO, Caption, ENLACE_FLECHA, HomeSection, SectionHeader, TARJETA_HOVER } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// A la medida: la línea empresarial de DuLabs, en una sección compacta que capta empresas grandes sin convertir la home en otra página
// Enterprise (el detalle vive en /soluciones-empresariales, /automatizacion-empresas e /integraciones). Sin clientes, logos, cifras ni
// plazos inventados; el único caso que se nombra es DuMo, ya publicado en /casos. La cotización y el tiempo dependen del alcance.
export function CustomSolutionsSection() {
  return (
    <HomeSection id="empresas" titleId="empresas-titulo">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16 xl:gap-24">
        <div>
          <SectionHeader eyebrow="A la medida" titleId="empresas-titulo" title="¿Necesitas algo más que un agente?">
            <p>
              DuLabs también diseña e implementa automatización empresarial, integraciones y agentes de IA personalizados para empresas con procesos propios. Cotización personalizada
              según el alcance; el tiempo depende del proyecto.
            </p>
          </SectionHeader>

          <div id="contacto" className="mt-8 flex scroll-mt-24 flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <TrackedLink href={HABLAR_ESPECIALISTA_HREF} event="cta_whatsapp" source="a_la_medida" className={BOTON_PRIMARIO}>
              Hablar con un especialista
              <span aria-hidden>→</span>
            </TrackedLink>
            <TrackedLink href={ENTERPRISE_HREF} event="cta_enterprise" source="a_la_medida" className={ENLACE_FLECHA}>
              Ver soluciones empresariales
              <span aria-hidden className="transition-transform group-hover/enlace:translate-x-0.5">→</span>
            </TrackedLink>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 text-[14px] leading-relaxed text-site-muted-fg">
            <p>
              Un ejemplo publicado: <span className="text-site-fg">DuMo</span>, el CRM propio que desarrollamos para gestionar leads y conversaciones de WhatsApp.
            </p>
            <TrackedLink href={CASOS_HREF} source="a_la_medida_caso" className={ENLACE_FLECHA}>
              Ver casos
              <span aria-hidden className="transition-transform group-hover/enlace:translate-x-0.5">→</span>
            </TrackedLink>
          </div>
        </div>

        <div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:gap-4">
            {CAPACIDADES_A_MEDIDA.map((c) => (
              <li key={c.titulo} className={`rounded-xl border border-site-border/70 bg-site-card/50 p-4 sm:p-5 xl:p-6 ${TARJETA_HOVER}`}>
                <h3 className="text-[17px] font-medium tracking-tight text-site-fg">{c.titulo}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-site-muted-fg">{c.texto}</p>
                <p className="mt-4 hidden border-t border-site-border pt-3.5 text-[13px] leading-relaxed text-site-muted-fg sm:block">{c.items.join(" · ")}</p>
              </li>
            ))}
          </ul>
          <Caption>Ejemplos de lo que podemos desarrollar: no todos los proyectos incluyen todo esto.</Caption>
        </div>
      </div>
    </HomeSection>
  );
}
