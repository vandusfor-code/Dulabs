import { Caption, HomeSection, Panel, PanelBar, SectionHeader, Tag } from "./atoms";
import { retraso } from "./ChatBubbles";

// Agendamiento: la sección de producto más fuerte. Mensaje clave: la IA INTERPRETA la conversación; la disponibilidad y las reglas las
// calcula el SISTEMA (horario de atención + duración del servicio + eventos del Google Calendar conectado). Nada de "la IA calcula".

type Quien = "cliente" | "ia" | "sistema";

const PASOS: { quien: Quien; titulo: string; detalle: string }[] = [
  { quien: "cliente", titulo: "Pide una cita por WhatsApp", detalle: "“Quiero una manicure el jueves en la tarde.”" },
  { quien: "ia", titulo: "Interpreta el mensaje", detalle: "Servicio: manicure básica · Día: jueves · Franja: tarde" },
  { quien: "sistema", titulo: "Calcula la disponibilidad", detalle: "Horario de atención + 30 min de duración + eventos de Google Calendar → horarios libres" },
  { quien: "cliente", titulo: "Elige un horario", detalle: "“La segunda.”" },
  { quien: "sistema", titulo: "Crea la cita en Google Calendar", detalle: "Evento creado · jueves, 3:30 p. m." },
  { quien: "ia", titulo: "Confirma al cliente", detalle: "“Listo. Tu cita de manicure básica quedó agendada para el jueves a las 3:30 p. m.”" },
];

const ETIQUETA: Record<Quien, { texto: string; tono: "muted" | "light" | "filled" }> = {
  cliente: { texto: "Cliente", tono: "muted" },
  ia: { texto: "IA", tono: "light" },
  sistema: { texto: "Sistema", tono: "filled" },
};

const CAPACIDADES: { titulo: string; texto: string }[] = [
  { titulo: "Disponibilidad real", texto: "Lee tu Google Calendar conectado y solo ofrece horarios libres." },
  { titulo: "Horarios configurables", texto: "Tu horario de atención, excepciones (festivos, cierres) y aviso mínimo." },
  { titulo: "Duración por servicio", texto: "Cada servicio ocupa el tiempo que le definas en tu catálogo." },
  { titulo: "Cancelar y reprogramar", texto: "El cliente cambia sus propias citas por WhatsApp, respetando tus reglas." },
  { titulo: "Confirmación", texto: "La cita queda creada en tu calendario y el cliente recibe la confirmación." },
];

const CONFIGURACION: [string, string][] = [
  ["Servicio", "Manicure básica · 30 min"],
  ["Horario", "Lun–Sáb · 8:00–20:00"],
  ["Aviso mínimo", "60 minutos"],
  ["Cancelar o cambiar", "hasta 24 h antes"],
];

export function SchedulingSection() {
  return (
    <HomeSection id="agendamiento" titleId="agendamiento-titulo">
      <SectionHeader eyebrow="Agendamiento automático" titleId="agendamiento-titulo" title="De la conversación a la cita confirmada.">
        <p>
          El agente entiende lo que pide el cliente. La disponibilidad y las reglas las calcula el sistema con tus horarios, la duración de cada servicio y tu Google Calendar. La IA
          nunca inventa un horario.
        </p>
      </SectionHeader>

      <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        <div>
          <dl className="divide-y divide-site-border border-y border-site-border">
            {CAPACIDADES.map((c) => (
              <div key={c.titulo} className="grid gap-1 py-4 sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:gap-6">
                <dt className="text-[14.5px] font-medium text-site-fg">{c.titulo}</dt>
                <dd className="text-[14.5px] leading-relaxed text-site-muted-fg">{c.texto}</dd>
              </div>
            ))}
          </dl>
          <Caption>Cancelar y reprogramar desde WhatsApp funciona con Google Calendar conectado.</Caption>

          <div className="mt-10">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-site-muted-fg">Ejemplo de configuración</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-site-border pt-4">
              {CONFIGURACION.map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-[10.5px] text-site-muted-fg">{k}</dt>
                  <dd className="mt-0.5 text-[14px] text-site-fg">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <figure>
          <Panel>
            <PanelBar left="Quién hace qué" right="ejemplo" />
            <ol className="relative px-4 py-5 sm:px-6">
              <span aria-hidden className="absolute bottom-9 left-[27px] top-9 w-px bg-site-border sm:left-[35px]" />
              {PASOS.map((p, i) => {
                const et = ETIQUETA[p.quien];
                return (
                  <li key={p.titulo} className="home-seq relative flex gap-4 pb-6 last:pb-0" style={retraso(150 + i * 420)}>
                    <span
                      aria-hidden
                      className={`relative z-10 mt-1 size-3 shrink-0 rounded-full border ${p.quien === "sistema" ? "border-site-fg bg-site-fg" : "border-white/30 bg-site-card"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Tag tono={et.tono}>{et.texto}</Tag>
                        <p className="text-[14px] font-medium text-site-fg">{p.titulo}</p>
                      </div>
                      <p className="mt-1.5 text-[13.5px] leading-relaxed text-site-muted-fg">{p.detalle}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="grid gap-3 border-t border-site-border px-4 py-3.5 font-mono text-[11px] text-site-muted-fg sm:grid-cols-2 sm:px-6">
              <p>
                <span className="text-site-fg">IA</span> · entiende y conversa
              </p>
              <p>
                <span className="text-site-fg">Sistema</span> · decide disponibilidad y reglas
              </p>
            </div>
          </Panel>
        </figure>
      </div>
    </HomeSection>
  );
}
