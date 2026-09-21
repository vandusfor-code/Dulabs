import type { ReactNode } from "react";
import { ETIQUETA_CAPACIDAD, PASOS_CON_PANEL, PASOS_DEL_WIZARD } from "@/lib/home/capabilities";
import { Caption, Dots, Panel, PanelBar, Tag } from "./atoms";

// Réplica del asistente de configuración real (components/dashboard/business-agent/Wizard.tsx): mismos pasos y en el mismo orden, mismas
// capacidades y casi los mismos textos. Es HTML estático con pestañas SIN JS (radios + selectores hermanos, ver .cfg en globals.css); todo el
// contenido está en el HTML. Los datos (servicios, precios, horarios) son un EJEMPLO y así se rotula. "Tomar pedidos" y "Cobrar" se muestran
// deshabilitadas porque así están en el producto.

function Titulo({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <div className="mb-4">
      <p className="text-[15px] font-medium text-site-fg">{titulo}</p>
      <p className="mt-1 text-[12.5px] leading-snug text-site-muted-fg">{descripcion}</p>
    </div>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10.5px] text-site-muted-fg">{etiqueta}</p>
      <p className="rounded-md border border-site-border bg-site-bg px-3 py-2 text-[13px] text-site-fg">{valor}</p>
    </div>
  );
}

function Interruptor({ etiqueta, ayuda, activo = true, deshabilitado = false }: { etiqueta: string; ayuda: string; activo?: boolean; deshabilitado?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 border-t border-site-border py-3 first:border-t-0 lg:[&:nth-child(2)]:border-t-0 ${deshabilitado ? "opacity-50" : ""}`}>
      <div className="min-w-0">
        <p className="text-[13.5px] text-site-fg">{etiqueta}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-site-muted-fg">{ayuda}</p>
      </div>
      <span aria-hidden className={`mt-0.5 flex h-[18px] w-8 shrink-0 items-center rounded-full px-0.5 ${activo ? "justify-end bg-site-fg" : "justify-start bg-white/15"}`}>
        <span className={`size-3.5 rounded-full ${activo ? "bg-site-bg" : "bg-white/50"}`} />
      </span>
      <span className="sr-only">{activo ? "Activado" : "Desactivado"}</span>
    </div>
  );
}

function Fila({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 border-t border-site-border py-2.5 text-[13px] first:border-t-0">{children}</div>;
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <p className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-site-muted-fg">{titulo}</p>
      {children}
    </div>
  );
}

const PANELES: Record<(typeof PASOS_CON_PANEL)[number], ReactNode> = {
  Capacidades: (
    <>
      <Titulo titulo="¿Qué puede hacer el agente?" descripcion="Cada capacidad está anclada a una herramienta real: nunca se inventa una acción." />
      <div className="grid lg:grid-cols-2 lg:gap-x-10">
        <Interruptor etiqueta={ETIQUETA_CAPACIDAD.faq} ayuda="Con tus preguntas frecuentes y documentos: busca lo relevante y nunca inventa." />
        <Interruptor etiqueta={ETIQUETA_CAPACIDAD.catalog} ayuda="Servicios y productos reales, nunca inventados por el modelo." />
        <Interruptor etiqueta={ETIQUETA_CAPACIDAD.sales} ayuda="Las calcula el sistema, nunca el modelo. Requiere catálogo. No cobra ni toma pedidos." />
        <Interruptor etiqueta={ETIQUETA_CAPACIDAD.scheduling} ayuda="Contra el calendario real, con confirmación." />
        <Interruptor etiqueta={ETIQUETA_CAPACIDAD.leadCapture} ayuda="Nombre, teléfono, necesidad." />
        <Interruptor etiqueta={ETIQUETA_CAPACIDAD.humanHandoff} ayuda="Transferencia determinista: nunca la decide el modelo solo." />
        <Interruptor etiqueta={ETIQUETA_CAPACIDAD.orders} ayuda="Todavía no disponible." activo={false} deshabilitado />
        <Interruptor etiqueta={ETIQUETA_CAPACIDAD.payments} ayuda="Todavía no disponible." activo={false} deshabilitado />
      </div>
    </>
  ),
  Agendamiento: (
    <>
      <Titulo titulo="Agendamiento" descripcion="Contra tu calendario real: el agente nunca inventa disponibilidad." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Proveedor de calendario" valor="Google Calendar" />
        <Campo etiqueta="Aviso mínimo (minutos)" valor="60" />
      </div>
      <div className="mt-2">
        <Interruptor etiqueta="Permitir cancelar y cambiar citas por WhatsApp" ayuda="El cliente cancela o mueve sus citas (se identifica por su número). Disponible con Google Calendar." />
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Anticipación mínima para cancelar o cambiar (horas)" valor="24" />
      </div>
    </>
  ),
  "Servicios y productos": (
    <>
      <Titulo titulo="Servicios y productos" descripcion="La fuente de verdad son tus servicios y productos guardados, nunca el prompt." />
      <Grupo titulo="Servicios">
        <Fila>
          <span className="text-site-fg">Manicure básica</span>
          <span className="font-mono text-[11.5px] text-site-muted-fg">Uñas · 30 min · $30.000</span>
        </Fila>
        <Fila>
          <span className="text-site-fg">Pedicure spa</span>
          <span className="font-mono text-[11.5px] text-site-muted-fg">Uñas · 50 min · $55.000</span>
        </Fila>
        <Fila>
          <span className="text-site-fg">Corte de cabello</span>
          <span className="font-mono text-[11.5px] text-site-muted-fg">Cabello · 45 min · $40.000</span>
        </Fila>
      </Grupo>
      <Grupo titulo="Productos">
        <Fila>
          <span className="text-site-fg">Esmalte rojo</span>
          <span className="font-mono text-[11.5px] text-site-muted-fg">Esmaltes · $12.000 · stock 24</span>
        </Fila>
      </Grupo>
      <Caption className="!mt-4">Stock: lo administras tú; el agente avisa si piden más de lo disponible.</Caption>
    </>
  ),
  Horarios: (
    <>
      <Titulo titulo="Horario de atención" descripcion="Define cuándo se pueden ofrecer citas." />
      <Grupo titulo="Semana">
        <Fila>
          <span className="text-site-fg">Lunes a viernes</span>
          <span className="font-mono text-[11.5px] text-site-muted-fg">8:00 – 20:00</span>
        </Fila>
        <Fila>
          <span className="text-site-fg">Sábado</span>
          <span className="font-mono text-[11.5px] text-site-muted-fg">9:00 – 17:00</span>
        </Fila>
        <Fila>
          <span className="text-site-fg">Domingo</span>
          <Tag>Cerrado</Tag>
        </Fila>
      </Grupo>
      <Grupo titulo="Excepciones (festivos, cierres, horarios especiales)">
        <Fila>
          <span className="text-site-fg">25 de diciembre</span>
          <Tag>Cerrado</Tag>
        </Fila>
      </Grupo>
    </>
  ),
  "Datos del cliente": (
    <>
      <Titulo titulo="Datos del cliente" descripcion="Lo que recopilará el agente." />
      <div className="divide-y divide-site-border">
        <div className="py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13.5px] text-site-fg">Nombre</p>
            <Tag tono="light">Obligatorio</Tag>
          </div>
        </div>
        <div className="py-3">
          <p className="text-[13.5px] text-site-fg">Teléfono</p>
          <p className="mt-0.5 text-[12px] leading-snug text-site-muted-fg">Se toma del número de WhatsApp del cliente: el agente nunca se lo pregunta.</p>
        </div>
        <div className="py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13.5px] text-site-fg">Correo</p>
            <Tag>Opcional</Tag>
          </div>
          <p className="mt-0.5 text-[12px] leading-snug text-site-muted-fg">Se ofrece con botones Sí/No para que el cliente pueda omitirlo.</p>
        </div>
        <div className="py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13.5px] text-site-fg">Edad</p>
            <Tag>Campo personalizado</Tag>
          </div>
        </div>
      </div>
    </>
  ),
  Conocimiento: (
    <>
      <Titulo titulo="Conocimiento" descripcion="Las preguntas frecuentes y documentos que el agente usa para responder." />
      <Grupo titulo="Preguntas frecuentes">
        <Fila>
          <span className="text-site-fg">¿Qué dice la política de cancelaciones?</span>
          <Tag tono="light">Activa</Tag>
        </Fila>
        <Fila>
          <span className="text-site-fg">¿Cuál es el horario de atención?</span>
          <Tag tono="light">Activa</Tag>
        </Fila>
      </Grupo>
      <Grupo titulo="Documentos">
        <Fila>
          <span className="font-mono text-[12px] text-site-fg">politica-de-cancelacion.pdf</span>
          <Tag>Procesado</Tag>
        </Fila>
        <Fila>
          <span className="font-mono text-[12px] text-site-fg">lista-de-precios.xlsx</span>
          <Tag>Procesado</Tag>
        </Fila>
      </Grupo>
      <Grupo titulo="Probar una pregunta">
        <p className="rounded-md border border-site-border bg-site-bg px-3 py-2 text-[13px] text-site-muted-fg">¿Puedo cancelar el mismo día?</p>
        <Caption className="!mt-2">Ejecuta la misma búsqueda que usa el agente y muestra los fragmentos que recibiría.</Caption>
      </Grupo>
    </>
  ),
  Reglas: (
    <>
      <Titulo titulo="Cosas que el agente nunca debe hacer" descripcion="Se evalúan antes del modelo: si aplican, el modelo ni siquiera corre." />
      <div className="divide-y divide-site-border">
        <Fila>
          <span className="text-site-fg">Dar diagnósticos médicos</span>
          <Tag>Transferir a humano</Tag>
        </Fila>
        <Fila>
          <span className="text-site-fg">Comparar precios con otras marcas</span>
          <Tag>Texto fijo</Tag>
        </Fila>
      </div>
      <Grupo titulo="Reglas informativas">
        <Fila>
          <span className="text-site-fg">Llegar 10 minutos antes de la cita</span>
          <Tag>Recordatorio</Tag>
        </Fila>
      </Grupo>
    </>
  ),
  Transferencia: (
    <>
      <Titulo titulo="¿Cuándo debe transferir a un humano?" descripcion="La decisión siempre es de DuLabs (determinista), nunca del modelo." />
      <div>
        <Interruptor etiqueta="El cliente lo pide" ayuda="Detecta cuando el cliente pide hablar con una persona." />
        <Interruptor etiqueta="Queja" ayuda="Pasa el caso a tu equipo." />
        <Interruptor etiqueta="Pide descuento" ayuda="El equipo negocia; el agente no improvisa descuentos." />
        <Interruptor etiqueta="Palabra clave: «reclamo»" ayuda="Tú defines las palabras." />
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Horas de pausa por defecto tras transferir" valor="6" />
      </div>
    </>
  ),
};

export function ConfigWizard() {
  const idDe = (paso: string) => `cfg-${paso.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, "-")}`;
  return (
    <figure>
      <Panel>
        <div role="radiogroup" aria-label="Pasos de configuración (ejemplo)" className="cfg grid md:grid-cols-[13.5rem_minmax(0,1fr)]">
          <div className="md:col-span-2">
            <PanelBar left={<><Dots /><span className="ml-2">Configurar agente</span></>} right="paso a paso" />
          </div>

          {PASOS_CON_PANEL.map((paso, i) => (
            <input key={paso} type="radio" name="cfg-paso" id={idDe(paso)} defaultChecked={i === 0} className="sr-only" />
          ))}

          <div className="cfg-tabs no-scrollbar flex overflow-x-auto border-b border-site-border md:block md:border-b-0 md:border-r">
            {PASOS_DEL_WIZARD.map((paso, i) => {
              const numero = String(i + 1).padStart(2, "0");
              const conPanel = (PASOS_CON_PANEL as readonly string[]).includes(paso);
              return conPanel ? (
                <label key={paso} htmlFor={idDe(paso)} className="flex shrink-0 items-center gap-2.5 whitespace-nowrap px-4 py-2.5 text-[13px] text-site-muted-fg transition-colors hover:text-site-fg md:py-2">
                  <span className="font-mono text-[10px] text-site-muted-fg/70">{numero}</span>
                  {paso}
                </label>
              ) : (
                <div key={paso} className="hidden items-center gap-2.5 whitespace-nowrap px-4 py-2 text-[13px] text-site-muted-fg/40 md:flex">
                  <span className="font-mono text-[10px]">{numero}</span>
                  {paso}
                </div>
              );
            })}
          </div>

          <div className="cfg-panels min-w-0 px-4 py-5 sm:px-6 md:min-h-[42.5rem] lg:min-h-[27rem]">
            {PASOS_CON_PANEL.map((paso) => (
              <div key={paso}>{PANELES[paso]}</div>
            ))}
          </div>
        </div>
      </Panel>
      <Caption>Basado en el asistente de configuración de DuLabs. Los datos son un ejemplo.</Caption>
    </figure>
  );
}
