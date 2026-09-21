import { CAPACIDADES_A_MEDIDA, PROCESO_A_MEDIDA } from "@/lib/home/enterprise";
import { CASOS_HREF, ENTERPRISE_HREF, HABLAR_ESPECIALISTA_HREF } from "@/lib/home/links";
import { Caption, HomeSection, Panel, PanelBar, SectionHeader } from "./atoms";
import { retraso } from "./ChatBubbles";
import { TrackedLink } from "./TrackedLink";

// A la medida: la línea empresarial de DuLabs (automatización, integraciones, agentes personalizados, software). Sin clientes, logos,
// cifras ni plazos inventados. El único caso que se nombra es DuMo, ya publicado en /casos. La cotización y el tiempo dependen del alcance
// (así lo dice hoy el sitio). El diagrama es conceptual y se rotula como tal.

function Nivel({ etiqueta, items, destacado = false }: { etiqueta: string; items: string[]; destacado?: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3.5 ${destacado ? "border-white/30 bg-dev-accent-soft" : "border-site-border bg-site-bg"}`}>
      <p className={`font-mono text-[10.5px] uppercase tracking-[0.16em] ${destacado ? "text-site-fg" : "text-site-muted-fg"}`}>{etiqueta}</p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13.5px] leading-snug text-site-fg">
        {items.map((it) => (
          <li key={it} className="whitespace-nowrap">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Conector({ i }: { i: number }) {
  return <span aria-hidden className="dev-wire-y mx-auto block h-7 w-px bg-site-border" style={{ ["--dev-i" as string]: i }} />;
}

export function CustomSolutionsSection() {
  return (
    <HomeSection id="empresas" titleId="empresas-titulo">
      <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:items-center lg:gap-20">
        <div>
          <SectionHeader eyebrow="A la medida" titleId="empresas-titulo" title="¿Necesitas algo más que un agente?">
            <p>
              DuLabs también diseña e implementa automatización empresarial, integraciones y agentes de IA personalizados para empresas con procesos propios. Trabajamos contigo desde el
              diseño hasta la puesta en marcha.
            </p>
            <p className="mt-4">Cotización personalizada según el alcance; el tiempo depende del proyecto.</p>
          </SectionHeader>

          <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
            <TrackedLink
              href={HABLAR_ESPECIALISTA_HREF}
              event="cta_whatsapp"
              source="a_la_medida"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-dev-accent px-6 text-[14.5px] font-medium text-dev-accent-fg transition-colors hover:bg-dev-accent-hover"
            >
              Hablar con un especialista
              <span aria-hidden>→</span>
            </TrackedLink>
            <TrackedLink
              href={ENTERPRISE_HREF}
              event="cta_enterprise"
              source="a_la_medida"
              className="group inline-flex min-h-11 items-center gap-1.5 text-[14px] text-site-fg transition-colors underline-offset-4 hover:underline"
            >
              Ver soluciones empresariales
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
            </TrackedLink>
          </div>
        </div>

        <figure>
          <Panel>
            <PanelBar left="Cómo se conecta" right="esquema" />
            <div className="home-seq px-4 py-5 sm:px-6" style={retraso(150)}>
              <Nivel etiqueta="Canal" items={["WhatsApp (API oficial de Meta)"]} />
              <Conector i={0} />
              <Nivel etiqueta="DuLabs · a la medida" items={["Agentes de IA personalizados", "Automatizaciones", "Reglas de tu negocio"]} destacado />
              <Conector i={1} />
              <Nivel etiqueta="Tus sistemas" items={["CRM", "Calendario", "APIs", "Sistemas internos"]} />
            </div>
          </Panel>
          <Caption>Esquema conceptual. Cada proyecto se diseña según tus procesos y herramientas.</Caption>
        </figure>
      </div>

      <div className="mt-20 border-t border-site-border pt-10">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-site-muted-fg">Lo que podemos desarrollar</p>
        <dl className="mt-6 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
          {CAPACIDADES_A_MEDIDA.map((c) => (
            <div key={c.titulo}>
              <dt className="text-[15px] font-medium text-site-fg">{c.titulo}</dt>
              <dd className="mt-3">
                <ul className="space-y-2 text-[14px] leading-snug text-site-muted-fg">
                  {c.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
        <Caption>Ejemplos de lo que podemos desarrollar: no todos los proyectos incluyen todo esto.</Caption>
      </div>

      <ol className="mt-16 grid gap-8 border-t border-site-border pt-10 sm:grid-cols-2 lg:grid-cols-4">
        {PROCESO_A_MEDIDA.map((p, i) => (
          <li key={p.titulo}>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-site-fg">
              <span className="text-site-muted-fg">{String(i + 1).padStart(2, "0")}</span> · {p.titulo}
            </p>
            <p className="mt-2.5 text-[14.5px] leading-relaxed text-site-muted-fg">{p.texto}</p>
          </li>
        ))}
      </ol>

      <div className="mt-14 flex flex-col gap-1 border-t border-site-border pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="text-[14.5px] leading-relaxed text-site-muted-fg">
          Un ejemplo publicado: <span className="text-site-fg">DuMo</span>, el CRM propio que desarrollamos para gestionar leads y conversaciones de WhatsApp.
        </p>
        <TrackedLink
          href={CASOS_HREF}
          source="a_la_medida_caso"
          className="group inline-flex min-h-11 shrink-0 items-center gap-1.5 text-[14px] text-site-fg transition-colors underline-offset-4 hover:underline"
        >
          Ver casos
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
        </TrackedLink>
      </div>
    </HomeSection>
  );
}
