"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  BrainCircuit,
  Workflow,
  Code2,
  MessageSquare,
  Users,
  Zap,
  Megaphone,
  BarChart3,
  Puzzle,
  ArrowRight,
  ArrowUpRight,
  Database,
  Bot,
  TrendingUp,
  CalendarClock,
  Receipt,
  ClipboardList,
  Loader2,
  Mail,
  MessageCircle,
} from "lucide-react";
import { LogoV2 } from "./LogoV2";
import { trackConversion } from "@/lib/site-analytics";
import {
  MENSAJE_WHATSAPP_GENERICO_ES,
  MENSAJE_WHATSAPP_ENTERPRISE_ES,
  MENSAJE_WHATSAPP_CONTACTO_ES,
  whatsappVentasUrl,
} from "@/lib/site-contact";

/* ============================ 02 · Problema ============================ */
export function ProblemaSection() {
  return (
    <section className="border-t border-sitev2-border">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8 md:py-32">
        <h2 className="mx-auto max-w-4xl text-center font-display text-[clamp(1.9rem,4.6vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-sitev2-fg">
          Tu empresa no necesita más herramientas.
          <br className="hidden sm:block" />{" "}
          <span className="text-sitev2-muted-fg">Necesita que trabajen juntas.</span>
        </h2>
      </div>
    </section>
  );
}

/* ========================== 03 · Capacidades ========================== */
// Los 3 pilares aprobados: Automatizamos / Conectamos / Construimos. La IA
// atraviesa los tres, no es un cuarto pilar aparte (brief, sección 3/5).
const CAPACIDADES = [
  {
    icon: Workflow,
    title: "Automatizamos",
    desc: "Procesos repetitivos y operativos de tu empresa.",
    ejemplos: ["Atención", "Ventas", "Citas", "Recordatorios", "Cobranza", "Postventa"],
  },
  {
    icon: Puzzle,
    title: "Conectamos",
    desc: "Las herramientas y sistemas que tu empresa ya usa.",
    ejemplos: ["WhatsApp", "CRM", "Calendarios", "Pagos", "APIs", "Sistemas externos"],
  },
  {
    icon: Code2,
    title: "Construimos",
    desc: "Software a la medida cuando lo estándar no alcanza.",
    ejemplos: ["CRM personalizado", "Paneles", "Dashboards", "Integraciones especiales", "Agentes IA"],
  },
];

export function CapacidadesSection() {
  return (
    <section id="soluciones" className="border-t border-sitev2-border bg-sitev2-surface">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
            Qué hacemos
          </p>
          <h2 className="mt-4 font-display text-[clamp(1.9rem,4vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-sitev2-fg">
            Tres formas de poner la tecnología a trabajar
          </h2>
          <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-sitev2-muted-fg">
            La IA atraviesa los tres — no es un producto aparte, es cómo hacemos que cada uno
            funcione mejor.
          </p>
        </div>

        {/* Composición editorial (sin caja): 3 columnas con hairline superior,
            como el lenguaje sin-cards del hero. Iconos neutros = naranja solo
            como acento en el resto de la página. */}
        <div className="mt-14 grid gap-10 border-t border-sitev2-border pt-12 md:grid-cols-3 md:gap-10">
          {CAPACIDADES.map((c) => (
            <div key={c.title}>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-sitev2-border bg-sitev2-card">
                <c.icon className="h-5 w-5 text-sitev2-fg" strokeWidth={1.8} />
              </span>
              <h3 className="mt-6 font-display text-[22px] font-semibold tracking-tight text-sitev2-fg">
                {c.title}
              </h3>
              <p className="mt-2.5 max-w-xs text-[14.5px] leading-relaxed text-sitev2-muted-fg">
                {c.desc}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {c.ejemplos.map((e) => (
                  <span
                    key={e}
                    className="rounded-full border border-sitev2-border px-2.5 py-1 text-[11.5px] text-sitev2-muted-fg"
                  >
                    {e}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ==================== 03b · Qué quieres automatizar ==================== */
// Sección de descubrimiento comercial (brief, sección 9/19): no son 8 cards
// genéricas -- cada una plantea la frase real de un prospecto y qué hace
// DuLabs con eso, para que la persona se sienta identificada aunque no sepa
// todavía qué tecnología necesita.
const QUE_AUTOMATIZAR = [
  {
    icon: MessageSquare,
    titulo: "Atención",
    frase: "“Quiero que mi WhatsApp responda automáticamente.”",
    respuesta: "Un agente de IA entrenado con la información real de tu negocio atiende 24/7.",
  },
  {
    icon: TrendingUp,
    titulo: "Ventas",
    frase: "“Quiero que la IA atienda y califique mis leads.”",
    respuesta: "Captura, califica y deja el lead listo para que tu equipo cierre la venta.",
  },
  {
    icon: CalendarClock,
    titulo: "Citas",
    frase: "“Quiero automatizar reservas, confirmaciones y recordatorios.”",
    respuesta: "Agenda de verdad, revisando disponibilidad real antes de confirmar.",
  },
  {
    icon: Receipt,
    titulo: "Cobranza",
    frase: "“Quiero automatizar recordatorios de pago.”",
    respuesta: "Seguimiento y recordatorios de pago sin que tu equipo tenga que escribir uno a uno.",
  },
  {
    icon: MessageSquare,
    titulo: "Mensajería",
    frase: "“Quiero comunicarme con mis clientes automáticamente.”",
    respuesta: "Campañas y comunicaciones por WhatsApp, respetando siempre las políticas de Meta.",
  },
  {
    icon: Puzzle,
    titulo: "Integraciones",
    frase: "“Quiero conectar WhatsApp con mi sistema.”",
    respuesta: "Evaluamos tu sistema y conectamos lo que sea técnicamente viable.",
  },
  {
    icon: Workflow,
    titulo: "Operaciones",
    frase: "“Quiero eliminar tareas manuales de mi equipo.”",
    respuesta: "Automatizamos el proceso interno repetitivo que hoy le quita tiempo a tu equipo.",
  },
  {
    icon: Code2,
    titulo: "Otro proceso",
    frase: "“Quiero automatizar algo diferente.”",
    respuesta: "Cuéntanos qué es — si no existe como producto estándar, lo construimos.",
  },
];

export function QueAutomatizarSection() {
  const href = whatsappVentasUrl(MENSAJE_WHATSAPP_GENERICO_ES);
  return (
    <section className="border-t border-sitev2-border">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
            Descubre tu caso
          </p>
          <h2 className="mt-4 font-display text-[clamp(1.9rem,4vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-sitev2-fg">
            ¿Qué quieres automatizar?
          </h2>
        </div>

        <div className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {QUE_AUTOMATIZAR.map((c) => (
            <div key={c.titulo} className="border-t border-sitev2-border pt-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-sitev2-border bg-sitev2-card">
                <c.icon className="h-4.5 w-4.5 text-sitev2-fg" strokeWidth={1.8} />
              </span>
              <h3 className="mt-5 text-[15px] font-semibold text-sitev2-fg">{c.titulo}</h3>
              <p className="mt-2 text-[13px] italic leading-snug text-sitev2-subtle-fg">{c.frase}</p>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-sitev2-muted-fg">{c.respuesta}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 flex justify-center">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackConversion("cta_whatsapp", { source: "que_automatizar_v2" })}
            className="group inline-flex h-11 items-center justify-center gap-2 rounded-full bg-sitev2-fg px-6 text-[14px] font-medium text-sitev2-bg transition-all hover:-translate-y-0.5 hover:bg-black"
          >
            Cuéntanos tu proceso
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}

/* ========================== 03c · Antes / Después ========================= */
// Demostración de valor (brief, sección 20): sin ninguna cifra inventada,
// solo la comparación cualitativa del flujo.
const ANTES = ["Cliente escribe", "Empleado responde", "Busca información", "Consulta disponibilidad", "Agenda", "Envía recordatorio", "Actualiza registro"];
const DESPUES = ["Cliente escribe", "Agente IA responde", "Consulta información", "Ejecuta automatización", "Agenda", "Confirma", "Recuerda", "Actualiza CRM"];

export function AntesDespuesSection() {
  return (
    <section className="border-t border-sitev2-border bg-sitev2-surface">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
            El cambio real
          </p>
          <h2 className="mt-4 font-display text-[clamp(1.9rem,4vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-sitev2-fg">
            De proceso manual a proceso automatizado
          </h2>
        </div>

        <div className="mt-14 grid gap-8 md:grid-cols-2">
          <div className="rounded-2xl border border-sitev2-border bg-sitev2-bg p-7">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-sitev2-subtle-fg">Antes</p>
            <ol className="mt-5 flex flex-col gap-3">
              {ANTES.map((paso, i) => (
                <li key={paso} className="flex items-center gap-3 text-[13.5px] text-sitev2-muted-fg">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sitev2-border text-[10px] text-sitev2-subtle-fg">
                    {i + 1}
                  </span>
                  {paso}
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-2xl border border-sitev2-primary/30 bg-sitev2-bg p-7 v2-shadow-card">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-sitev2-fg">Con DuLabs</p>
            <ol className="mt-5 flex flex-col gap-3">
              {DESPUES.map((paso, i) => (
                <li key={paso} className="flex items-center gap-3 text-[13.5px] text-sitev2-fg">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sitev2-primary-soft text-[10px] font-medium text-sitev2-fg">
                    {i + 1}
                  </span>
                  {paso}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================== 04 · Plataforma =========================== */
// Los 7 módulos aprobados para la navegación "Producto" (brief, sección 13).
const MODULOS = [
  { icon: MessageSquare, title: "Conversaciones", desc: "Todos los canales en una sola bandeja." },
  { icon: BrainCircuit, title: "IA", desc: "Agentes que entienden, responden y actúan por tu empresa." },
  { icon: Users, title: "CRM", desc: "Cada cliente, su historial y su etapa en el proceso, siempre a mano." },
  { icon: Zap, title: "Automatizaciones", desc: "Flujos que responden y hacen seguimiento solos." },
  { icon: Megaphone, title: "Campañas", desc: "Mensajes masivos con botones y variables." },
  { icon: ClipboardList, title: "Encuestas", desc: "Mide satisfacción por WhatsApp, con insights de IA en los planes superiores." },
  { icon: BarChart3, title: "Analytics", desc: "Lo que pasa en tu operación, en datos claros." },
  { icon: Puzzle, title: "Integraciones", desc: "Conecta DuLabs con las herramientas que ya usas." },
];

export function PlataformaSection() {
  return (
    <section id="producto" className="border-t border-sitev2-border">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
            La plataforma
          </p>
          <h2 className="mt-4 font-display text-[clamp(1.9rem,4vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-sitev2-fg">
            Un producto real, no una demo
          </h2>
          <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-sitev2-muted-fg">
            Conversaciones, contactos, automatización y datos en un mismo lugar — la operación
            completa de atención de tu empresa.
          </p>
        </div>

        <div className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {MODULOS.map((m) => (
            <div key={m.title} className="flex gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sitev2-border bg-sitev2-card">
                <m.icon className="h-5 w-5 text-sitev2-fg" strokeWidth={1.8} />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-sitev2-fg">{m.title}</h3>
                <p className="mt-1 text-[13.5px] leading-relaxed text-sitev2-muted-fg">{m.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================== 05 · Casos ============================== */
// Casos REALES (mismos que /casos, componente de producción). Sin inventar
// resultados ni métricas: solo problema, qué construimos y tecnología.
const CASOS = [
  {
    icon: Database,
    nombre: "DuMo",
    tagline: "CRM para gestión de leads, conversaciones y ventas.",
    problema:
      "Leads y conversaciones de WhatsApp dispersos entre chats, hojas de cálculo y la memoria del equipo, sin visibilidad del embudo.",
    solucion:
      "Un CRM propio con bandeja centralizada, asignación de leads al vendedor correcto y seguimiento de la venta en un solo lugar.",
    tecnologia: ["Next.js", "Supabase", "WhatsApp Business Platform"],
  },
  {
    icon: Bot,
    nombre: "Spa de belleza — Montería",
    tagline: "Asistente de WhatsApp con IA para atención y citas.",
    problema:
      "Solicitudes de cita atendidas de forma 100% manual, con riesgo de choques de horario y respuestas lentas fuera de horario.",
    solucion:
      "Un asistente de WhatsApp con IA que resuelve dudas de servicios y precios y recibe solicitudes de cita para que el equipo las confirme.",
    // Antes decía "Claude (Anthropic)", desactualizado. Sin nombrar un
    // proveedor de IA específico (regla 5 del brief) -- lo relevante para el
    // caso es la plataforma sobre la que corre, no el modelo por debajo.
    tecnologia: ["WhatsApp Business Platform", "Agente de IA propio", "Supabase"],
  },
];

export function CasosSection() {
  return (
    <section id="casos" className="border-t border-sitev2-border bg-sitev2-surface">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-xl">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
              Casos
            </p>
            <h2 className="mt-4 font-display text-[clamp(1.9rem,4vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-sitev2-fg">
              Proyectos reales, no ejemplos
            </h2>
          </div>
          <Link
            href="/casos"
            className="group inline-flex items-center gap-1.5 text-[14px] font-medium text-sitev2-fg"
          >
            Ver todos los casos
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        {/* Casos editoriales (pocos, bien presentados) */}
        <div className="mt-14 flex flex-col">
          {CASOS.map((c, i) => (
            <article
              key={c.nombre}
              className={`grid gap-8 py-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14 ${
                i > 0 ? "border-t border-sitev2-border" : ""
              }`}
            >
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-sitev2-border bg-sitev2-card">
                  <c.icon className="h-5 w-5 text-sitev2-fg" strokeWidth={1.8} />
                </span>
                <h3 className="mt-5 font-display text-[24px] font-semibold tracking-tight text-sitev2-fg">
                  {c.nombre}
                </h3>
                <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-sitev2-muted-fg">
                  {c.tagline}
                </p>
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {c.tecnologia.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-sitev2-border px-2.5 py-1 font-mono text-[10.5px] text-sitev2-muted-fg"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid gap-8 sm:grid-cols-2">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-sitev2-muted-fg">
                    Problema
                  </p>
                  <p className="mt-2.5 text-[14px] leading-relaxed text-sitev2-fg">{c.problema}</p>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-sitev2-muted-fg">
                    Qué construimos
                  </p>
                  <p className="mt-2.5 text-[14px] leading-relaxed text-sitev2-fg">{c.solucion}</p>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* Cierre de la sección basado en capacidades reales, no en logos:
            los logos de "confianza" que había acá (ICONTEC, Universidad del
            Rosario, WOM, Farmasi, Cofrem, Claro, Huspy) son experiencia de
            People BPO, no clientes propios de DuLabs -- Du tiene prohibido
            nombrarlos como casos propios (04_cases.yaml del Brain v1), así
            que tampoco se muestran aquí como si lo fueran (regla 6 del
            brief). Sin inventar clientes nuevos para reemplazarlos. */}
        <div className="mt-8 flex flex-col items-center gap-3 border-t border-sitev2-border pt-10 text-center">
          <p className="max-w-md text-[13.5px] leading-relaxed text-sitev2-muted-fg">
            Cada proyecto queda documentado así: el problema real, lo que construimos y la
            tecnología detrás — nunca un resultado sin evidencia.
          </p>
        </div>
      </div>
    </section>
  );
}

/* =========================== 06 · Enterprise =========================== */
// DuLabs Custom (brief, sección 10/12): NO es un plan mensual más, es una
// conversación comercial/proyecto. id="custom" -- distinto de id="empresa",
// que ahora es su propia sección (EmpresaSection, más abajo).
const CUSTOM_EJEMPLOS = [
  "CRM personalizado",
  "Sistemas internos",
  "Software",
  "APIs",
  "Integraciones especiales",
  "Dashboards",
  "Agentes IA especializados",
  "Automatizaciones complejas",
];

export function EnterpriseSection() {
  const href = whatsappVentasUrl(MENSAJE_WHATSAPP_ENTERPRISE_ES);
  return (
    <section id="custom" className="border-t border-sitev2-border bg-sitev2-surface">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8 md:py-32">
        {/* Composición editorial en una sola columna: el CTA queda agrupado
            con su contenido (no flotando en un vacío a la derecha). */}
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
            DuLabs Custom
          </p>
          <h2 className="mt-4 font-display text-[clamp(2rem,4.4vw,3.25rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-sitev2-fg">
            ¿Tu empresa necesita
            <span className="text-sitev2-primary"> algo diferente?</span>
          </h2>
          <p className="mt-6 max-w-lg text-[16px] leading-relaxed text-sitev2-muted-fg">
            Cuéntanos qué necesitas automatizar. Nosotros lo hacemos realidad — con software,
            integraciones y agentes de IA diseñados alrededor de cómo trabaja tu operación.
          </p>
          {/* Aclaración Platform vs Custom (fase 6.3.2, punto 4): una sola
              frase, en el lugar donde el lector ya pasó por "LA PLATAFORMA"
              y ahora llega a "DULABS CUSTOM" -- sin sección ni tarjeta nueva. */}
          <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-sitev2-muted-fg">
            A diferencia de la plataforma, que ya está lista para configurar, DuLabs Custom se
            construye específicamente para el proceso de tu empresa.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            {CUSTOM_EJEMPLOS.map((t) => (
              <span
                key={t}
                className="rounded-full border border-sitev2-border bg-sitev2-card px-4 py-1.5 text-[13px] text-sitev2-fg"
              >
                {t}
              </span>
            ))}
          </div>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackConversion("cta_whatsapp", { source: "enterprise_v2" })}
            className="group mt-10 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-sitev2-fg px-6 text-[14.5px] font-medium text-sitev2-bg transition-all hover:-translate-y-0.5 hover:bg-black"
          >
            Hablar con DuLabs
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}

/* ===================== Contacto Enterprise (Custom) ===================== */
// Canal real de captura de leads Enterprise -- misma lógica/endpoint que la
// Home en producción (EnterpriseSections.tsx -> /api/enterprise/contacto),
// rediseñado con el lenguaje visual V2 (fase 6.2, punto 1 del brief). Nunca
// se reemplaza por un mailto ni se simula: si /api/enterprise/contacto falla
// o cambia de forma, este formulario deja de funcionar de verdad, tal como
// el de producción.
type EstadoFormContacto = "listo" | "enviando" | "exito" | "error";

const OPCIONES_NECESIDAD = ["IA & Automatización", "Software a medida", "Integraciones", "Datos & Operaciones", "Otro"];

const inputClassV2 =
  "w-full rounded-lg border border-sitev2-border bg-sitev2-bg px-3.5 py-2.5 text-[13.5px] text-sitev2-fg outline-none transition-colors placeholder:text-sitev2-subtle-fg focus:border-sitev2-primary/50";

export function EnterpriseContactSection() {
  const [estado, setEstado] = useState<EstadoFormContacto>("listo");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [correo, setCorreo] = useState("");
  const [telefono, setTelefono] = useState("");
  const [necesidad, setNecesidad] = useState("");
  const [detalle, setDetalle] = useState("");

  const formStarted = useRef(false);
  const marcarInicioFormulario = () => {
    if (formStarted.current) return;
    formStarted.current = true;
    trackConversion("form_enterprise_start");
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEstado("enviando");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/enterprise/contacto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, empresa, correo, telefono, necesidad, detalle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo enviar la solicitud.");
      trackConversion("form_enterprise_submit");
      setEstado("exito");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error enviando la solicitud.");
      setEstado("error");
    }
  };

  return (
    <section id="contacto" className="border-t border-sitev2-border">
      <div className="mx-auto max-w-[900px] px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
            Contacto
          </p>
          <h2 className="mt-4 font-display text-[clamp(1.9rem,4vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-sitev2-fg">
            Cuéntanos qué necesitas
          </h2>
          <p className="mt-5 text-[15.5px] leading-relaxed text-sitev2-muted-fg">
            Nuestro equipo revisará tu proyecto y te contactará para entender el alcance y proponerte la mejor
            solución.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <a
            href="mailto:contacto@dulabs.co"
            className="group flex items-center justify-between gap-3 rounded-xl border border-sitev2-border bg-sitev2-card p-5 transition-colors hover:border-sitev2-fg/20"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-sitev2-border bg-sitev2-surface-2">
                <Mail className="h-4 w-4 text-sitev2-primary" strokeWidth={1.8} />
              </span>
              <div>
                <p className="text-[13.5px] font-medium text-sitev2-fg">Correo</p>
                <p className="text-[12.5px] text-sitev2-muted-fg">contacto@dulabs.co</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-sitev2-subtle-fg transition-transform group-hover:translate-x-0.5 group-hover:text-sitev2-fg" />
          </a>
          <a
            href={whatsappVentasUrl(MENSAJE_WHATSAPP_CONTACTO_ES)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackConversion("cta_enterprise", { source: "contact_section_v2" })}
            className="group flex items-center justify-between gap-3 rounded-xl border border-sitev2-border bg-sitev2-card p-5 transition-colors hover:border-sitev2-fg/20"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-sitev2-border bg-sitev2-surface-2">
                <MessageCircle className="h-4 w-4 text-sitev2-primary" strokeWidth={1.8} />
              </span>
              <div>
                <p className="text-[13.5px] font-medium text-sitev2-fg">WhatsApp</p>
                <p className="text-[12.5px] text-sitev2-muted-fg">Habla directamente con DuLabs</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-sitev2-subtle-fg transition-transform group-hover:translate-x-0.5 group-hover:text-sitev2-fg" />
          </a>
        </div>

        <div className="mt-6 rounded-2xl border border-sitev2-border bg-sitev2-surface p-6 md:p-8">
          {estado === "exito" ? (
            <div className="py-6 text-center">
              <p className="font-display text-[17px] font-medium text-sitev2-fg">
                ¡Listo! Ya recibimos tu solicitud.
              </p>
              <p className="mt-2 text-[13.5px] text-sitev2-muted-fg">
                Te contactaremos para entender el alcance de tu proyecto.
              </p>
            </div>
          ) : (
            <form onSubmit={enviar} onFocus={marcarInicioFormulario} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="ec-nombre" className="mb-1.5 block text-[12px] font-medium text-sitev2-muted-fg">
                    Nombre
                  </label>
                  <input
                    id="ec-nombre"
                    required
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    className={inputClassV2}
                    placeholder="Tu nombre"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label htmlFor="ec-empresa" className="mb-1.5 block text-[12px] font-medium text-sitev2-muted-fg">
                    Empresa
                  </label>
                  <input
                    id="ec-empresa"
                    required
                    value={empresa}
                    onChange={(e) => setEmpresa(e.target.value)}
                    className={inputClassV2}
                    placeholder="Nombre de tu empresa"
                    autoComplete="organization"
                  />
                </div>
                <div>
                  <label htmlFor="ec-correo" className="mb-1.5 block text-[12px] font-medium text-sitev2-muted-fg">
                    Correo electrónico
                  </label>
                  <input
                    id="ec-correo"
                    required
                    type="email"
                    value={correo}
                    onChange={(e) => setCorreo(e.target.value)}
                    className={inputClassV2}
                    placeholder="tu@empresa.com"
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label htmlFor="ec-telefono" className="mb-1.5 block text-[12px] font-medium text-sitev2-muted-fg">
                    Teléfono / WhatsApp
                  </label>
                  <input
                    id="ec-telefono"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    className={inputClassV2}
                    placeholder="+57 300 000 0000"
                    autoComplete="tel"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ec-necesidad" className="mb-1.5 block text-[12px] font-medium text-sitev2-muted-fg">
                  ¿Qué necesitas?
                </label>
                <select
                  id="ec-necesidad"
                  required
                  value={necesidad}
                  onChange={(e) => setNecesidad(e.target.value)}
                  className={`${inputClassV2} appearance-none`}
                >
                  <option value="" disabled>
                    Selecciona una opción
                  </option>
                  {OPCIONES_NECESIDAD.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="ec-detalle" className="mb-1.5 block text-[12px] font-medium text-sitev2-muted-fg">
                  Cuéntanos brevemente sobre tu proyecto
                </label>
                <textarea
                  id="ec-detalle"
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  rows={4}
                  className={`${inputClassV2} resize-none`}
                  placeholder="¿Qué te gustaría resolver o automatizar?"
                />
              </div>

              {estado === "error" && errorMsg && <p className="text-[12.5px] text-red-600">{errorMsg}</p>}

              <button
                type="submit"
                disabled={estado === "enviando"}
                className="mt-1 inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-sitev2-fg px-6 text-[13.5px] font-medium text-sitev2-bg transition-all hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                {estado === "enviando" && <Loader2 className="h-4 w-4 animate-spin" />}
                Enviar solicitud <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

/* ============================== Empresa ============================== */
// Brief, sección 14: no existe página Empresa hoy. La creo aquí, pero SOLO
// con información ya confirmada en el sitio actual (footer/FAQ de
// producción) -- nada de historia, fundadores, equipo, oficinas, años de
// experiencia ni certificaciones inventadas.
export function EmpresaSection() {
  return (
    <section id="empresa" className="border-t border-sitev2-border">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-sitev2-subtle-fg">
            Empresa
          </p>
          <h2 className="mt-4 font-display text-[clamp(1.9rem,4vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-sitev2-fg">
            Una empresa de tecnología, no una agencia
          </h2>
          <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-sitev2-muted-fg">
            DuLabs es una empresa de tecnología con sede en Bogotá, Colombia, que diseña e
            implementa soluciones de inteligencia artificial, automatización, software e
            integraciones para empresas. WhatsApp con IA es uno de nuestros productos, no el
            único.
          </p>
          <p className="mt-4 max-w-lg text-[14.5px] leading-relaxed text-sitev2-muted-fg">
            DuLabs es la unidad tecnológica de{" "}
            <span className="text-sitev2-fg">People BPO</span>, enfocada en automatización e
            inteligencia artificial.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ============================ 08 · CTA final ============================ */
export function FinalCtaSection() {
  const href = whatsappVentasUrl(MENSAJE_WHATSAPP_GENERICO_ES);
  return (
    <section className="border-t border-sitev2-border bg-sitev2-bg">
      <div className="mx-auto max-w-[1280px] px-5 py-28 text-center sm:px-8 md:py-36">
        <h2 className="mx-auto max-w-3xl font-display text-[clamp(2.25rem,5.5vw,4rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-sitev2-fg">
          ¿Qué podemos construir juntos
          <span className="text-sitev2-primary">?</span>
        </h2>
        <div className="mt-10 flex justify-center">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackConversion("cta_whatsapp", { source: "final_cta_v2" })}
            className="group inline-flex h-[52px] items-center gap-2 rounded-full bg-sitev2-fg px-7 text-[15px] font-medium text-sitev2-bg transition-all hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_16px_40px_-14px_rgba(17,17,17,0.45)]"
          >
            Hablar con DuLabs
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
      </div>
    </section>
  );
}

/* ============================== Footer ============================== */
const FOOTER_COLS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Producto",
    links: [
      { label: "Plataforma", href: "#producto" },
      { label: "Precios", href: "#precios" },
      { label: "Iniciar sesión", href: "/login" },
    ],
  },
  {
    title: "Soluciones",
    links: [
      { label: "Qué automatizamos", href: "#soluciones" },
      { label: "DuLabs Custom", href: "#custom" },
      { label: "Casos", href: "#casos" },
    ],
  },
  {
    title: "Empresa",
    links: [
      { label: "Sobre DuLabs", href: "#empresa" },
      { label: "Recursos", href: "/recursos" },
      { label: "Preguntas frecuentes", href: "/preguntas-frecuentes" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacidad", href: "/privacidad" },
      { label: "Términos", href: "/terminos" },
      { label: "Eliminación de datos", href: "/eliminacion-de-datos-whatsapp" },
    ],
  },
];

export function FooterV2() {
  return (
    <footer className="border-t border-sitev2-border bg-sitev2-surface">
      <div className="mx-auto max-w-[1280px] px-5 py-16 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <LogoV2 className="text-[19px]" />
            <p className="mt-4 max-w-[24ch] text-[13.5px] leading-relaxed text-sitev2-muted-fg">
              IA, automatización y software para que tu operación funcione mejor.
            </p>
          </div>
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-sitev2-muted-fg">
                {col.title}
              </h3>
              <ul className="mt-4 flex flex-col gap-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-[13.5px] text-sitev2-muted-fg transition-colors hover:text-sitev2-fg"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Identificación legal del responsable del servicio -- misma información
            que ya está publicada en el Footer de producción (Sections.tsx),
            solo que compacta en una línea en vez del bloque de 2 columnas
            viejo, para mantener el poco-texto/mucho-espacio de V2. Ningún
            dato nuevo: People BPO como titular, DuLabs como nombre comercial,
            Colombia como país de operación. */}
        <div className="mt-14 border-t border-sitev2-border pt-6">
          <p className="text-[12px] leading-relaxed text-sitev2-muted-fg">
            DuLabs es una marca y plataforma tecnológica de <span className="text-sitev2-fg">People BPO</span>{" "}
            (titular del servicio) · País de operación: Colombia ·{" "}
            <a href="mailto:contacto@dulabs.co" className="transition-colors hover:text-sitev2-fg">
              contacto@dulabs.co
            </a>
          </p>
        </div>

        <div className="mt-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-[12.5px] text-sitev2-subtle-fg">
            © {new Date().getFullYear()} DuLabs · by People BPO
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-sitev2-subtle-fg">
            Tecnología con propósito
          </p>
        </div>
      </div>
    </footer>
  );
}
