import { Agente, Cliente } from "./ChatBubbles";
import { Caption, HomeSection, Panel, PanelBar, SectionHeader, Tag } from "./atoms";

// Catálogo: el agente responde desde servicios y productos ESTRUCTURADOS (nombre, categoría, precio, duración, stock informativo), no desde
// su memoria. La cotización la calcula el sistema con esos precios y el formato de la respuesta es el real (formatQuoteText). No cobra ni
// toma pedidos: para concretar la compra transfiere a una persona. Los datos son un ejemplo.

const SERVICIOS: { nombre: string; detalle: string; destacado?: boolean }[] = [
  { nombre: "Manicure básica", detalle: "30 min · $30.000", destacado: true },
  { nombre: "Pedicure spa", detalle: "50 min · $55.000", destacado: true },
  { nombre: "Corte de cabello", detalle: "45 min · $40.000" },
];

export function CatalogSection() {
  return (
    <HomeSection id="catalogo" titleId="catalogo-titulo">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-16">
        <div>
          <SectionHeader eyebrow="Catálogo" titleId="catalogo-titulo" title="Precios y servicios consistentes, sin improvisar.">
            <p>
              Guardas tus servicios y productos una vez, con precio, duración y descripción. El agente responde desde ese catálogo y no desde su memoria: la fuente de verdad son tus
              datos, así el cliente recibe siempre la misma información.
            </p>
          </SectionHeader>

          <div className="mt-10">
            <Panel>
              <PanelBar left="Catálogo" right="ejemplo" />
              <div className="px-4 py-3">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-site-muted-fg">Servicios</p>
                <ul className="mt-1">
                  {SERVICIOS.map((s) => (
                    <li key={s.nombre} className="flex items-center justify-between gap-3 border-t border-site-border py-2.5 text-[13.5px] first:border-t-0">
                      <span className="flex items-center gap-2 text-site-fg">
                        <span aria-hidden className={`size-1.5 rounded-full ${s.destacado ? "bg-home-accent" : "bg-white/15"}`} />
                        {s.nombre}
                      </span>
                      <span className="font-mono text-[11.5px] text-site-muted-fg">{s.detalle}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-site-muted-fg">Productos</p>
                <ul className="mt-1">
                  <li className="flex items-center justify-between gap-3 border-t border-site-border py-2.5 text-[13.5px] first:border-t-0">
                    <span className="flex items-center gap-2 text-site-fg">
                      <span aria-hidden className="size-1.5 rounded-full bg-white/15" />
                      Esmalte rojo
                    </span>
                    <span className="font-mono text-[11.5px] text-site-muted-fg">$12.000 · stock 24</span>
                  </li>
                </ul>
              </div>
            </Panel>
            <Caption>Servicios con duración y precio; productos con precio y stock informativo; categorías y descripciones.</Caption>
          </div>
        </div>

        <figure>
          <Panel>
            <PanelBar left="Conversación de ejemplo" right="WhatsApp" />
            <div className="space-y-2.5 px-4 py-4 sm:px-5 sm:py-5">
              <Cliente ms={200}>¿Cuánto cuesta el pedicure spa?</Cliente>
              <Agente ms={900}>
                <p>Pedicure spa — $55.000 (50&nbsp;min)</p>
              </Agente>
              <Cliente ms={1900}>Cotízame una manicure básica y un pedicure spa.</Cliente>
              <Agente ms={2700} etiqueta="Agente · cotización del sistema">
                <p>• Manicure básica x1 — $30.000 c/u = $30.000</p>
                <p className="mt-1">• Pedicure spa x1 — $55.000 c/u = $55.000</p>
                <p className="mt-1.5 font-medium">Total: $85.000</p>
              </Agente>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-site-border px-4 py-3 sm:px-5">
              <Tag tono="accent">Calculado por el sistema</Tag>
              <span className="font-mono text-[11px] text-site-muted-fg">precios y cantidades del catálogo, no del modelo</span>
            </div>
          </Panel>
          <Caption>Cotiza con tus precios reales; no cobra ni toma pedidos. Para concretar la compra, transfiere la conversación a tu equipo.</Caption>
        </figure>
      </div>
    </HomeSection>
  );
}
