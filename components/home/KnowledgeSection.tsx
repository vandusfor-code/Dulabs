import { Agente, Cliente, retraso } from "./ChatBubbles";
import { Caption, HomeSection, Panel, PanelBar, SectionHeader, Tag } from "./atoms";

// Conocimiento: las FAQ y los documentos se guardan, se procesan en fragmentos y, para cada pregunta, el sistema busca los fragmentos
// relevantes; el agente responde con eso en vez de recibir el documento completo. La búsqueda es por palabras (el propio Wizard avisa que
// "encuentra palabras parecidas, no sinónimos"): NO se afirma búsqueda semántica. Si no hay información, el agente no inventa: lo dice.
// Formatos reales: PDF, Excel (.xlsx), CSV y TXT.

export function KnowledgeSection() {
  return (
    <HomeSection id="conocimiento" titleId="conocimiento-titulo">
      <SectionHeader eyebrow="Conocimiento" titleId="conocimiento-titulo" title="Tu agente responde con lo que tu empresa sabe.">
        <p>
          Carga tus preguntas frecuentes y documentos en PDF, Excel, CSV o TXT. Para cada pregunta, el sistema busca los fragmentos relevantes y el agente responde con esa
          información, en lugar de recibir el documento completo cada vez.
        </p>
      </SectionHeader>

      <figure className="mt-14">
        <Panel>
          <PanelBar left="Del documento a la respuesta" right="ejemplo" />
          <div className="grid gap-px bg-site-border md:grid-cols-3">
            <div className="bg-site-card px-4 py-5 sm:px-5">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-site-muted-fg">1 · Tus fuentes</p>
              <ul className="mt-3 space-y-2.5">
                {[
                  ["Preguntas frecuentes", "Activas"],
                  ["politica-de-cancelacion.pdf", "Procesado"],
                  ["lista-de-precios.xlsx", "Procesado"],
                ].map(([nombre, estado], i) => (
                  <li key={nombre} className="home-seq flex items-center justify-between gap-3 text-[13px]" style={retraso(150 + i * 200)}>
                    <span className={`min-w-0 truncate text-site-fg ${nombre.includes(".") ? "font-mono text-[12px]" : ""}`}>{nombre}</span>
                    <Tag>{estado}</Tag>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-site-card px-4 py-5 sm:px-5">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-site-muted-fg">2 · El sistema busca</p>
              <div className="home-seq mt-3 rounded-md border border-site-border bg-site-bg px-3 py-2.5" style={retraso(900)}>
                <p className="font-mono text-[10.5px] text-site-muted-fg">politica-de-cancelacion.pdf</p>
                <p className="mt-1 text-[13px] leading-snug text-site-fg">“Las citas se pueden cancelar o cambiar hasta 24 horas antes sin costo.”</p>
              </div>
              <p className="home-seq mt-3 text-[12.5px] leading-snug text-site-muted-fg" style={retraso(1200)}>
                Solo los fragmentos relevantes a la pregunta llegan al agente.
              </p>
            </div>

            <div className="bg-site-card px-4 py-5 sm:px-5">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-site-muted-fg">3 · El agente responde</p>
              <div className="mt-3 space-y-2.5">
                <Cliente ms={1500}>¿Puedo cancelar el mismo día?</Cliente>
                <Agente ms={2300}>Las citas se pueden cancelar o cambiar hasta 24 horas antes de la hora agendada.</Agente>
              </div>
            </div>
          </div>
        </Panel>
        <Caption>Ejemplo ilustrativo del recorrido de una pregunta: del documento cargado a la respuesta.</Caption>
      </figure>

      <div className="mt-14 grid gap-8 border-t border-site-border pt-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div>
          <p className="text-[17px] font-medium tracking-[-0.01em] text-site-fg">Si la respuesta no está en tu información, no la inventa.</p>
          <p className="mt-3 text-[15px] leading-relaxed text-site-muted-fg">
            Cuando el sistema no encuentra nada relevante, el agente lo dice con el mensaje que tú definas y puede pasar la conversación a una persona.
          </p>
        </div>
        <div className="max-w-md space-y-2.5">
          <Cliente ms={200}>¿Hacen tratamientos de microblading?</Cliente>
          <Agente ms={900}>Por ahora no puedo darte esa respuesta por aquí. ¿Quieres preguntarme otra cosa?</Agente>
        </div>
      </div>
    </HomeSection>
  );
}
