import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Caption, HomeSection, Panel, SectionHeader, Tag } from "./atoms";
import { retraso } from "./ChatBubbles";

// Cómo funciona (autoservicio), en 3 pasos. Cada paso lleva un fragmento de la interfaz real: los pasos del asistente, las conexiones
// (WhatsApp con la API oficial de Meta y Google Calendar) y el estado de publicación con su historial de versiones (Borrador, Publicada,
// Reemplazada son los estados reales de las versiones). Los datos son un ejemplo.

function Paso({ n, titulo, children, visual, ms }: { n: string; titulo: string; children: ReactNode; visual: ReactNode; ms: number }) {
  return (
    <li className="home-seq flex flex-col md:row-span-2 md:grid md:grid-rows-subgrid" style={retraso(ms)}>
      <div>
        <p className="font-mono text-[12px] text-home-accent">{n}</p>
        <div className="mt-3 border-t border-site-border pt-5">
          <h3 className="text-[19px] font-medium leading-snug tracking-[-0.015em] text-site-fg">{titulo}</h3>
          <p className="mt-2.5 text-[14.5px] leading-relaxed text-site-muted-fg">{children}</p>
        </div>
      </div>
      <div className="mt-6">{visual}</div>
    </li>
  );
}

function Fila({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 border-t border-site-border px-3.5 py-2.5 text-[13px] first:border-t-0">{children}</div>;
}

function Estado({ texto }: { texto: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-site-muted-fg">
      <span aria-hidden className="size-1.5 rounded-full bg-home-accent" />
      {texto}
    </span>
  );
}

export function StepsSection() {
  return (
    <HomeSection id="como-funciona" titleId="como-funciona-titulo">
      <SectionHeader eyebrow="Cómo funciona" titleId="como-funciona-titulo" title="Tres pasos para tener tu agente atendiendo." />

      <ol className="mt-14 grid gap-14 md:grid-cols-3 md:gap-x-8 md:gap-y-0 lg:gap-x-12">
        <Paso
          n="01"
          titulo="Configura tu negocio."
          ms={100}
          visual={
            <Panel>
              {["Servicios y productos", "Horarios", "Conocimiento", "Reglas"].map((paso) => (
                <Fila key={paso}>
                  <span className="text-site-fg">{paso}</span>
                  <span className="grid size-4 place-items-center rounded-full bg-home-accent-soft text-home-accent">
                    <Check className="size-2.5" strokeWidth={3} aria-hidden />
                  </span>
                </Fila>
              ))}
            </Panel>
          }
        >
          Con el asistente paso a paso cargas tus servicios, horarios, preguntas frecuentes y documentos. Sin escribir código.
        </Paso>

        <Paso
          n="02"
          titulo="Conecta tus canales."
          ms={300}
          visual={
            <>
              <Panel>
                <Fila>
                  <span>
                    <span className="block text-site-fg">WhatsApp</span>
                    <span className="mt-0.5 block font-mono text-[10.5px] text-site-muted-fg">API oficial de Meta</span>
                  </span>
                  <Estado texto="Conectado" />
                </Fila>
                <Fila>
                  <span>
                    <span className="block text-site-fg">Google Calendar</span>
                    <span className="mt-0.5 block font-mono text-[10.5px] text-site-muted-fg">Disponibilidad y citas</span>
                  </span>
                  <Estado texto="Conectado" />
                </Fila>
              </Panel>
              <Caption>Si ya usas WhatsApp Business en el celular, puedes conectar ese número en modo coexistencia (según los requisitos de Meta).</Caption>
            </>
          }
        >
          Conecta tu número de WhatsApp con la API oficial de Meta y tu Google Calendar.
        </Paso>

        <Paso
          n="03"
          titulo="Deja que tu agente atienda y automatice."
          ms={500}
          visual={
            <Panel>
              <Fila>
                <span className="text-site-fg">Estado actual</span>
                <Tag tono="accent">Publicada</Tag>
              </Fila>
              <Fila>
                <span className="text-site-muted-fg">Versión 2</span>
                <Tag tono="light">Publicada</Tag>
              </Fila>
              <Fila>
                <span className="text-site-muted-fg">Versión 1</span>
                <Tag>Reemplazada</Tag>
              </Fila>
            </Panel>
          }
        >
          Pruebas en la vista previa, publicas una versión validada y tu agente atiende, agenda y transfiere. Tú sigues las conversaciones desde el panel.
        </Paso>
      </ol>
    </HomeSection>
  );
}
