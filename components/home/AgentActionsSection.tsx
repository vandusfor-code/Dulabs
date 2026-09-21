import { ACCIONES_DEL_AGENTE, ETIQUETA_CAPACIDAD } from "@/lib/home/capabilities";
import { Caption, HomeSection, Panel, PanelBar, SectionHeader, Tag } from "./atoms";
import { retraso } from "./ChatBubbles";

// Agentes de IA: en vez de una lista de funciones, un registro "el cliente escribe -> el agente ejecuta". Cada fila sale de
// lib/home/capabilities.ts, que un test contrasta con las capacidades reales del Runtime y las etiquetas del Wizard.
export function AgentActionsSection() {
  return (
    <HomeSection id="agentes" titleId="agentes-titulo">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <SectionHeader eyebrow="Agentes de IA" titleId="agentes-titulo" title="Un agente que entiende cómo funciona tu negocio." className="lg:sticky lg:top-28 lg:self-start">
          <p>
            No es un chatbot de preguntas y respuestas. Es un agente de IA configurable con la información de tu negocio: atiende conversaciones reales por WhatsApp y ejecuta
            acciones, desde consultar el catálogo hasta agendar una cita o pasar el caso a una persona.
          </p>
          <p className="mt-4">Tú eliges qué puede hacer cada agente y cómo debe comportarse.</p>
        </SectionHeader>

        <figure>
          <Panel>
            <PanelBar left="Conversaciones → acciones" right="ejemplo" />
            <div className="hidden grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] gap-6 border-b border-site-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-site-muted-fg sm:grid">
              <span>El cliente escribe</span>
              <span>El agente ejecuta</span>
            </div>
            <ol>
              {ACCIONES_DEL_AGENTE.map((a, i) => (
                <li
                  key={a.pide}
                  className="home-seq grid gap-2 border-t border-site-border px-4 py-3.5 first:border-t-0 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] sm:gap-6"
                  style={retraso(120 + i * 140)}
                >
                  <p className="text-[14px] leading-snug text-site-muted-fg">“{a.pide}”</p>
                  <div>
                    <p className="text-[14px] leading-snug text-site-fg">{a.ejecuta}</p>
                    <p className="mt-2">
                      <Tag>{ETIQUETA_CAPACIDAD[a.capacidad]}</Tag>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
          <Caption>
            Cada capacidad se activa según lo que tu negocio necesita. Hoy el agente cotiza, agenda y transfiere; no cobra ni toma pedidos: para concretar la compra pasa la conversación a tu
            equipo.
          </Caption>
        </figure>
      </div>
    </HomeSection>
  );
}
