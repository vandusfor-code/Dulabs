"use client";

import { useI18n } from "@/lib/i18n";
import { MOTION, useSecuencia } from "./motion";
import { Ruta } from "./Ruta";

// DuLabs Developer -- las 8 microvisualizaciones de «Qué puedes construir». Cada una ES la explicación de su capacidad (no decoración):
// una secuencia propia (useSecuencia) que solo corre si la capacidad está activa y el bloque en pantalla; con reduced motion queda en su
// estado final. Datos de ejemplo rotulados. Lo que es del developer (su agente, su scheduler, sus reglas) se dice explícitamente.

type Props = { activo: boolean; bucle: boolean };

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-dp border border-dp-border bg-dp-bg/60 ${className}`}>{children}</div>;
}

function Demo() {
  const { t } = useI18n();
  return <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dp-muted">{t("demo", "demo")}</span>;
}

/* 01 · Coexistencia: dos flujos a la vez desde el mismo número. */
const P_COEX = [700, 700, 700, 700, 1800] as const;
function VisualCoexistencia({ activo, bucle }: Props) {
  const { t } = useI18n();
  const { paso } = useSecuencia(P_COEX, { activo, bucle });
  const servicios = [t("Agente de IA", "AI agent"), t("Automatización", "Automation"), "Webhooks", "CRM"];
  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-[340px] rounded-dp border border-dp-border-strong bg-dp-bg px-4 py-3 text-center">
        <p className="font-mono text-[12.5px] text-dp-text">WhatsApp Business</p>
        <p className="font-mono text-[10.5px] text-dp-muted">+57 300 ••• ••12 · {t("el mismo número", "the same number")}</p>
      </div>
      {/* Bifurcación: un rail por lado, con un paquete bajando por cada uno A LA VEZ. */}
      <div aria-hidden className="relative mx-auto h-14 w-[62%]">
        <span className="absolute left-1/2 top-0 h-3 w-px bg-dp-border-strong" />
        <span className="absolute left-0 right-0 top-3 h-px bg-dp-border-strong" />
        {[0, 1].map((lado) => (
          <span key={lado} className={`absolute top-3 bottom-0 w-px bg-dp-border-strong ${lado ? "right-0" : "left-0"}`}>
            <span className="dp-movil dp-anim dp-baja absolute inset-0">
              <span className={`absolute left-0 top-0 block h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full ${lado ? "bg-dp-signal" : "bg-dp-text"}`} />
            </span>
          </span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        <Panel className="p-3.5">
          <p className="font-mono text-[12.5px] text-dp-text">{t("Equipo humano", "Human team")}</p>
          <p className="font-mono text-[10.5px] text-dp-muted">{t("app de WhatsApp Business", "WhatsApp Business app")}</p>
          <p className="mt-3 font-mono text-[10.5px] text-dp-ok">● {t("sigue atendiendo", "keeps replying")}</p>
        </Panel>
        <Panel className="p-3.5">
          <p className="font-mono text-[12.5px] text-dp-text">DuLabs API</p>
          <p className="font-mono text-[10.5px] text-dp-muted">{t("lo que tú construyes", "what you build")}</p>
          <ul className="mt-2.5 space-y-1">
            {servicios.map((s, i) => (
              <li key={s} data-estado={paso > i ? "hecho" : paso === i ? "activo" : "pendiente"} className="flex items-center gap-2 font-mono text-[10.5px]">
                <span className="dp-nodo-punto scale-75" />
                <span className="dp-nodo-nombre truncate">{s}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <p className="mt-auto pt-4 text-[12px] leading-relaxed text-dp-muted">
        {t("Disponible según los requisitos y la disponibilidad de Meta para tu número.", "Available subject to Meta's requirements and availability for your number.")}
      </p>
    </div>
  );
}

/* 02 · API por número: autenticado -> número conectado -> listo para la API. */
const P_NUMERO = [700, 700, 700, 900, 900, 1900] as const;
function VisualNumero({ activo, bucle }: Props) {
  const { t } = useI18n();
  const { paso } = useSecuencia(P_NUMERO, { activo, bucle });
  const conectado = paso >= 3;
  const linea = (visible: boolean, contenido: React.ReactNode) => (
    <p className={`transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}>{contenido}</p>
  );
  return (
    <div className="grid h-full gap-4 sm:grid-cols-[1.25fr_1fr]">
      <Panel className="p-4 font-mono text-[11.5px] leading-[1.75]">
        {linea(true, <><span className="text-dp-muted">$</span> GET /v1/me <span className={paso >= 1 ? "text-dp-ok" : "text-dp-muted"}>{paso >= 1 ? "200" : "…"}</span></>)}
        {linea(paso >= 1, <span className="text-dp-muted">› {t("autenticado", "authenticated")} · dl_live_…</span>)}
        {linea(paso >= 2, <><span className="text-dp-muted">$</span> GET /v1/whatsapp-numbers <span className="text-dp-ok">200</span></>)}
        {linea(
          paso >= 2,
          <span className="block whitespace-pre text-dp-text-2">
            {`{ "id": "4f1c…9a2e",\n  "phoneNumberId": "1098…",\n  "status": `}
            <span key={conectado ? "c" : "p"} className={`dp-cruce ${conectado ? "text-dp-ok" : "text-dp-warn"}`}>{conectado ? '"conectado"' : '"pendiente"'}</span>
            {" }"}
          </span>,
        )}
        {linea(paso >= 4, <span className="text-dp-signal">› {t("listo para", "ready for")} POST /v1/messages</span>)}
      </Panel>
      <dl className="grid content-start gap-px overflow-hidden rounded-dp border border-dp-border bg-dp-border font-mono text-[11px]">
        {[
          [t("Número", "Number"), "+57 300 ••• ••12", ""],
          [t("Estado", "Status"), conectado ? "conectado" : "pendiente", conectado ? "text-dp-ok" : "text-dp-warn"],
          ["API", "POST /v1/messages", paso >= 4 ? "text-dp-text" : "text-dp-muted"],
          ["Webhook", "https://tu-app.dev/webhooks", paso >= 4 ? "text-dp-text" : "text-dp-muted"],
        ].map(([k, v, c]) => (
          <div key={k} className="bg-dp-surface px-3.5 py-2.5">
            <dt className="text-[9.5px] uppercase tracking-[0.16em] text-dp-muted">{k}</dt>
            <dd className={`mt-0.5 truncate ${c || "text-dp-text"}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* 03 · Envíos masivos: la campaña entra a una cola y se procesa con control de ritmo. */
const P_MASIVO = [600, 600, 700, 900, 900, 900, 1600] as const;
function VisualMasivo({ activo, bucle }: Props) {
  const { t } = useI18n();
  const { paso } = useSecuencia(P_MASIVO, { activo, bucle });
  const total = 1248;
  const enviados = paso >= 5 ? 1197 : paso >= 4 ? 862 : paso >= 3 ? 318 : 0;
  const entregados = paso >= 6 ? 1183 : paso >= 5 ? 1049 : paso >= 4 ? 590 : 0;
  const enCola = paso >= 2 ? total - enviados : 0;
  const pctEntregados = enviados ? ((entregados / enviados) * 100).toFixed(1) : "0.0";
  const nodos = [
    { k: t("Tu campaña", "Your campaign"), sub: t("tu lista · tu código", "your list · your code") },
    { k: t("Audiencia", "Audience"), sub: `${total.toLocaleString("en-US")} ${t("destinatarios", "recipients")}` },
    { k: "Rate control", sub: t("gateway · 2 msg/s por número", "gateway · 2 msg/s per number"), chip: "PACED" },
    { k: t("Cola", "Queue"), sub: "DuLabs · jobs", chip: "QUEUED" },
    { k: t("Entrega", "Delivery"), sub: "WhatsApp Cloud API", chip: "SENT" },
    { k: t("Eventos", "Events"), sub: "webhook · message.status", chip: "DELIVERED", tono: "ok" as const },
  ];
  return (
    <div className="grid h-full gap-5 sm:grid-cols-[1fr_1fr]">
      <Ruta nodos={nodos} actual={paso >= 6 ? 6 : paso} alto={42} />
      <Panel className="flex flex-col p-4">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dp-muted">{t("Campaña", "Campaign")} · spring-promo</p>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dp-muted">{t("demo · tiempo comprimido", "demo · compressed time")}</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 font-mono">
          {[
            ["queued", enCola, "text-dp-text"],
            ["processing", paso >= 3 && paso < 6 ? Math.min(enCola, 24) : 0, "text-dp-signal"],
            ["sent", enviados, "text-dp-text"],
            ["delivered", entregados, "text-dp-ok"],
          ].map(([k, v, c]) => (
            <div key={k as string}>
              <dt className="text-[10px] text-dp-muted">{k}</dt>
              <dd key={String(v)} className={`dp-cruce text-[18px] tabular-nums ${c}`}>{(v as number).toLocaleString("en-US")}</dd>
            </div>
          ))}
        </dl>
        <div aria-hidden className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full origin-left bg-dp-text-2 transition-transform duration-700" style={{ transform: `scaleX(${enviados / total})` }} />
        </div>
        <p className="mt-2 font-mono text-[10.5px] text-dp-muted">
          {enviados ? `${pctEntregados} % ${t("de los enviados, entregados", "of sent delivered")}` : t("encolando…", "queueing…")}
        </p>
        <p className="mt-auto pt-3 text-[11.5px] leading-relaxed text-dp-muted">
          {t("Tu servidor no dispara miles de requests a Meta: el gateway marca el ritmo (429 + Retry-After) y la cola entrega con reintentos.", "Your server doesn't fire thousands of requests at Meta: the gateway sets the pace (429 + Retry-After) and the queue delivers with retries.")}
        </p>
      </Panel>
    </div>
  );
}

/* 04 · Protección: una ráfaga de requests sale a ritmo controlado (500 ms entre salidas = 2 msg/s por número). */
const P_RITMO = [500, 500, 500, 500, 500, 500, 500, 500, 500, 1300] as const;
function VisualProteccion({ activo, bucle }: Props) {
  const { t } = useI18n();
  const { paso, estatico } = useSecuencia(P_RITMO, { activo, bucle });
  const N = 8;
  const controles = ["RATE LIMIT", "QUEUE", "RETRY", "IDEMPOTENCY", "THROTTLING", "DELIVERY STATUS"];
  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-[72px_1fr_72px] items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-dp-muted">
        <span>{t("tu servidor", "your server")}</span>
        <span className="text-center">gateway · 2 msg/s {t("por número", "per number")}</span>
        <span className="text-right">{t("cola → Meta", "queue → Meta")}</span>
      </div>
      <div className="relative mt-3 h-24 overflow-hidden rounded-dp border border-dp-border bg-dp-bg/60">
        <span aria-hidden className="absolute bottom-2 left-1/2 top-2 w-px bg-dp-border-strong" />
        <span aria-hidden className="absolute left-1/2 top-2 -translate-x-1/2 rounded-[3px] border border-dp-border-strong bg-dp-bg px-1 font-mono text-[9px] text-dp-muted">gate</span>
        {Array.from({ length: N }, (_, i) => {
          // Cada paso (500 ms) deja salir UN request: la ráfaga llega junta y sale espaciada. Sin movimiento: la salida ya espaciada.
          const salio = paso > i;
          const x = estatico ? (i / (N - 1)) * 100 : salio ? 100 : 0;
          return (
            <div
              key={i}
              aria-hidden
              className="absolute bottom-0 top-0"
              style={{ left: 18, right: 22, transform: `translateX(${x}%)`, transition: "transform 900ms linear, opacity 280ms ease-out", opacity: !estatico && salio && paso > i + 2 ? 0 : 1 }}
            >
              <span
                className={`absolute left-0 block h-[7px] w-[7px] -translate-x-1/2 rounded-full ${salio || estatico ? "bg-dp-signal" : "bg-dp-text-2"}`}
                style={{ top: 22 + (i % 4) * 14, marginLeft: salio || estatico ? 0 : (i >> 2) * 10 }}
              />
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-dp-text-2">
        {t(
          "Si superas el límite, el gateway responde 429 con Retry-After; lo aceptado entra en cola, se reintenta con backoff y cada envío tiene su estado.",
          "Over the limit, the gateway answers 429 with Retry-After; accepted sends are queued, retried with backoff and every send has its status.",
        )}
      </p>
      <ul className="mt-auto flex flex-wrap gap-1.5 pt-4">
        {controles.map((c) => (
          <li key={c} className="rounded-[4px] border border-dp-border px-2 py-1 font-mono text-[10px] tracking-[0.08em] text-dp-text-2">
            {c}
          </li>
        ))}
        <li className="rounded-[4px] border border-dashed border-dp-border px-2 py-1 font-mono text-[10px] tracking-[0.08em] text-dp-muted">OPT-OUT · {t("tu producto", "your product")}</li>
      </ul>
    </div>
  );
}

/* 05 · Agentes de IA: mensaje entra -> tu agente procesa (y usa una herramienta) -> la respuesta sale por la API. */
const P_AGENTE = [800, 500, 1000, 500, 1100, 250, 700, 1100, 1100, 1500] as const;
function VisualAgente({ activo, bucle }: Props) {
  const { t } = useI18n();
  const { paso } = useSecuencia(P_AGENTE, { activo, bucle });
  const segunda = paso >= 5;
  const actual = paso === 5 ? -1 : [0, 1, 2, 3, 4, -1, 0, 2, 4, 5][paso]!;
  const nodos = [
    { k: "WhatsApp", sub: t("tu cliente escribe", "your customer writes") },
    { k: "DuLabs", sub: "webhook · message.received" },
    {
      k: t("Tu agente", "Your agent"),
      sub: segunda ? t("herramienta · calendar.create", "tool · calendar.create") : t("contexto · memoria · conocimiento", "context · memory · knowledge"),
      chip: segunda ? "TOOL" : "THINK",
    },
    { k: "DuLabs API", sub: "POST /v1/messages" },
    { k: "WhatsApp", sub: t("respuesta", "reply"), chip: "SENT", tono: "ok" as const },
  ];
  const burbujas: { quien: "u" | "a" | "tool"; texto: string; desde: number }[] = [
    { quien: "u", texto: t("Quiero una cita mañana.", "I'd like an appointment tomorrow."), desde: 0 },
    { quien: "a", texto: t("Claro. Tengo disponibilidad a las 10:00 o 14:30. ¿Cuál prefieres?", "Sure. I have 10:00 or 14:30 available. Which one works?"), desde: 4 },
    { quien: "u", texto: t("A las 10:00.", "10:00, please."), desde: 6 },
    { quien: "tool", texto: "calendar.create → 201 · event.created", desde: 7 },
    { quien: "a", texto: t("Listo: tu cita quedó mañana a las 10:00.", "Done: you're booked for tomorrow at 10:00."), desde: 8 },
  ];
  return (
    <div className="grid h-full gap-5 sm:grid-cols-[1fr_1.1fr]">
      <Ruta nodos={nodos} actual={actual} alto={46} />
      <Panel className="flex flex-col gap-2 p-3.5">
        <div className="flex items-center justify-between pb-1">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dp-muted">{t("Conversación", "Conversation")}</p>
          <Demo />
        </div>
        {burbujas
          .filter((b) => paso >= b.desde)
          .map((b, i) =>
            b.quien === "tool" ? (
              <p key={i} className="dp-cruce self-start font-mono text-[10.5px] text-dp-ok">
                {b.texto}
              </p>
            ) : (
              <p
                key={i}
                className={`dp-cruce max-w-[88%] rounded-dp px-3 py-2 text-[12.5px] leading-snug ${b.quien === "u" ? "self-end bg-white/[0.07] text-dp-text" : "self-start border border-dp-border text-dp-text-2"}`}
              >
                {b.texto}
              </p>
            ),
          )}
        {paso === 2 || paso === 7 ? (
          <p className="dp-cruce self-start font-mono text-[10px] uppercase tracking-[0.14em] text-dp-signal">
            {paso === 2 ? "context · memory · knowledge" : "tools → calendar"}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

/* 06 · Recordatorios: evento -> tu scheduler -> (tiempo) -> la API envía. */
const P_RECORDATORIO = [700, 700, 1300, 700, 900, 1800] as const;
function VisualRecordatorio({ activo, bucle }: Props) {
  const { t } = useI18n();
  const { paso } = useSecuencia(P_RECORDATORIO, { activo, bucle });
  const nodos = [
    { k: "appointment.created", sub: t("tu sistema · cita jue 10:00", "your system · appt Thu 10:00") },
    { k: "Scheduler", sub: t("tu cron o tu cola", "your cron or queue"), chip: "−24 h" },
    { k: t("Espera", "Wait"), sub: t("mié 10:00", "Wed 10:00") },
    { k: "DuLabs API", sub: "POST /v1/messages" },
    { k: "WhatsApp", sub: "Carlos", chip: "DELIVERED", tono: "ok" as const },
  ];
  return (
    <div className="grid h-full gap-5 sm:grid-cols-[1fr_1fr]">
      <Ruta nodos={nodos} actual={paso >= 5 ? 5 : paso} alto={46} />
      <div className="flex min-w-0 flex-col gap-4">
        <Panel className="p-3.5">
          <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-dp-muted">
            <span>{t("hoy", "today")}</span>
            <span>{t("mié 10:00", "Wed 10:00")}</span>
            <span>{t("jue 10:00 · cita", "Thu 10:00 · appt")}</span>
          </div>
          {/* El paso del tiempo, conceptual: una sola barra que avanza una vez por ciclo (sin reloj corriendo). */}
          <div aria-hidden className="relative mt-2.5 h-px bg-dp-border-strong">
            <div className="absolute inset-0 origin-left bg-dp-signal transition-transform duration-[1200ms] ease-out" style={{ transform: `scaleX(${paso >= 2 ? 0.5 : 0})` }} />
            <span className="absolute left-1/2 top-1/2 h-2 w-px -translate-y-1/2 bg-dp-text-2" />
          </div>
        </Panel>
        <div className={`transition-opacity duration-300 ${paso >= 4 ? "opacity-100" : "opacity-0"}`}>
          <p className="max-w-[92%] rounded-dp border border-dp-border px-3 py-2.5 text-[12.5px] leading-snug text-dp-text-2">
            {t("Hola Carlos, te recordamos que mañana tienes tu cita a las 10:00.", "Hi Carlos, a reminder that your appointment is tomorrow at 10:00.")}
          </p>
          <p className="mt-1.5 font-mono text-[10px] text-dp-muted">{t("mié 10:00 · enviado por la API", "Wed 10:00 · sent via the API")}</p>
        </div>
        <p className="mt-auto text-[11.5px] leading-relaxed text-dp-muted">
          {t(
            "Fuera de la ventana de 24 h, WhatsApp exige plantillas aprobadas por Meta; la API V1 envía mensajes de texto.",
            "Outside the 24-hour window WhatsApp requires Meta-approved templates; API V1 sends text messages.",
          )}
        </p>
      </div>
    </div>
  );
}

/* 07 · Automatizaciones: trigger -> condición -> acciones -> webhook (tus reglas sobre los eventos). */
const P_AUTOMATIZACION = [700, 800, 800, 800, 800, 1700] as const;
function VisualAutomatizacion({ activo, bucle }: Props) {
  const { t } = useI18n();
  const { paso } = useSecuencia(P_AUTOMATIZACION, { activo, bucle });
  const nodos = [
    { etiqueta: "trigger", k: "lead.created", chip: t("evento", "event") },
    { etiqueta: "condition", k: "qualified == true", chip: "true" },
    { etiqueta: "action", k: "send_message", sub: "POST /v1/messages", chip: "201" },
    { etiqueta: "action", k: "assign_agent", sub: t("tu CRM", "your CRM"), chip: "OK" },
    { etiqueta: "webhook", k: "POST tu-app.dev/hooks", chip: "200", tono: "ok" as const },
  ];
  const codigo = [
    `on("lead.created", async (lead) => {`,
    `  if (!lead.qualified) return;`,
    `  await sendMessage(lead.phone, "Hola 👋");  // POST /v1/messages`,
    `  await assignAgent(lead);                   // ${t("tu CRM", "your CRM")}`,
    `  await notify(HOOK_URL, lead);              // ${t("tu integración", "your integration")}`,
    `});`,
  ];
  const lineaActiva = paso >= 5 ? -1 : paso;
  return (
    <div className="grid h-full gap-5 sm:grid-cols-[1fr_1.05fr]">
      <Ruta nodos={nodos} actual={paso >= 5 ? 5 : paso} alto={50} compacta />
      <Panel className="overflow-x-auto p-3.5">
        <p className="pb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-dp-muted">{t("tu backend", "your backend")}</p>
        <pre className="font-mono text-[11px] leading-[1.8]">
          {codigo.map((l, i) => (
            <span key={i} className={`block transition-colors duration-300 ${i === lineaActiva ? "text-dp-signal" : "text-dp-text-2"}`}>
              {l}
            </span>
          ))}
        </pre>
      </Panel>
    </div>
  );
}

/* 08 · Webhooks e integraciones: entra (WhatsApp -> tu backend, 200 OK) y sale (tu backend -> WhatsApp, 201). */
const P_WEBHOOKS = [600, 600, 600, 900, 600, 600, 600, 900, 1500] as const;
function VisualWebhooks({ activo, bucle }: Props) {
  const { t } = useI18n();
  const { paso } = useSecuencia(P_WEBHOOKS, { activo, bucle });
  const entrada = [
    { k: "WhatsApp", sub: "message.received" },
    { k: "DuLabs", sub: t("normaliza · deduplica", "normalize · dedupe") },
    { k: "Webhook", sub: "HMAC-SHA256", chip: "SIGNED" },
    { k: t("Tu backend", "Your backend"), sub: "https://tu-app.dev", chip: "200 OK", tono: "ok" as const },
  ];
  const salida = [
    { k: t("Tu backend", "Your backend"), sub: t("decide qué responder", "decides the reply") },
    { k: "DuLabs API", sub: "POST /v1/messages", chip: "201" },
    { k: t("Cola", "Queue"), sub: t("reintentos · backoff", "retries · backoff") },
    { k: "WhatsApp", sub: t("tu cliente", "your customer"), chip: "SENT", tono: "ok" as const },
  ];
  return (
    <div className="grid h-full gap-6 sm:grid-cols-2">
      <div>
        <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-dp-muted">{t("Entra", "Inbound")} ↓</p>
        <Ruta nodos={entrada} actual={paso >= 4 ? 4 : paso} alto={48} />
      </div>
      <div>
        <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-dp-muted">{t("Sale", "Outbound")} ↓</p>
        <Ruta nodos={salida} actual={paso < 4 ? -1 : paso >= 8 ? 4 : paso - 4} alto={48} />
      </div>
    </div>
  );
}

export const VISUALES = [
  { Visual: VisualCoexistencia, duracion: sum(P_COEX) },
  { Visual: VisualNumero, duracion: sum(P_NUMERO) },
  { Visual: VisualMasivo, duracion: sum(P_MASIVO) },
  { Visual: VisualProteccion, duracion: sum(P_RITMO) },
  { Visual: VisualAgente, duracion: sum(P_AGENTE) },
  { Visual: VisualRecordatorio, duracion: sum(P_RECORDATORIO) },
  { Visual: VisualAutomatizacion, duracion: sum(P_AUTOMATIZACION) },
  { Visual: VisualWebhooks, duracion: sum(P_WEBHOOKS) },
] as const;

export const MARGEN_LECTURA = MOTION.sistema * 2;
