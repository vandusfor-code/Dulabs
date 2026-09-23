"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { API_BASE_URL, DOCS_HREF, SECTION_IDS } from "./constants";
import { useBloque, useMenosMovimiento, useTic } from "./motion";
import { Encabezado, EnlaceFlecha, MarcaEstado, NotaEjemplo, type Estado } from "./ui";

// DuLabs Developer -- bloques de contenido de la landing (02-06). Una sola narrativa: el sistema (02), el request que lo recorre (03), los
// eventos que devuelve (04), el lugar desde donde se opera (05) y por qué aguanta producción (06).
//
// Veracidad: todo lo técnico sale del producto real -- rutas de lib/developers/openapi.ts, respuestas del gateway (201 {jobId, status},
// error {code, message, request_id}), cabeceras reales de la firma (lib/developer/webhook-signature.ts), el cuerpo real que envía el worker
// (lib/developer/inbound-event-mapper.ts), 5 intentos de entrega + DLQ (lib/developer/events-store.ts) y los límites reales del gateway.
// Los IDs, horas y cifras de las vistas de producto son de EJEMPLO y se rotulan así; sin claims de certificaciones.

/* ============================== 02 · PLATAFORMA ============================== */

function Etapas() {
  const { t } = useI18n();
  const etapas = [
    { k: t("Tu app", "Your app"), a: "cURL · JS · TS", b: "HTTPS + API key" },
    { k: "API Gateway", a: t("auth · límites", "auth · rate limits"), b: "Idempotency-Key" },
    { k: "Queue", a: "at-least-once", b: "jobId" },
    { k: "Workers", a: t("reintentos · backoff", "retries · backoff"), b: "DLQ" },
    { k: "WhatsApp Cloud API", a: t("oficial de Meta", "official, by Meta"), b: "wamid" },
    { k: t("Cliente", "Customer"), a: t("recibe en WhatsApp", "gets it on WhatsApp"), b: "sent → delivered" },
  ];
  return (
    <>
      {/* Desktop: seis etapas en columnas abiertas; un evento recorre la línea y cada etapa se ilumina al pasar. */}
      <ol className="relative hidden grid-cols-6 border-y border-dp-border md:grid">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[52px] h-px bg-dp-border-strong">
          <span className="dp-anim dp-viajero-x -ml-[3px] -mt-[2.5px] block h-1.5 w-1.5 rounded-full bg-dp-signal shadow-[0_0_10px_rgba(94,140,255,0.8)]" />
        </div>
        {etapas.map((e, i) => (
          <li key={e.k} className={`relative px-4 pb-6 pt-5 lg:px-5 ${i > 0 ? "border-l border-dp-border" : ""}`} style={{ ["--dp-i" as string]: i }}>
            <span className="block font-mono text-[10.5px] leading-4 text-dp-muted">{String(i + 1).padStart(2, "0")}</span>
            <span aria-hidden className="dp-anim dp-etapa-marca absolute left-4 top-[49px] z-10 block h-[7px] w-[7px] rounded-full lg:left-5" />
            <p className="dp-anim dp-etapa-nombre mt-10 font-mono text-[13px] leading-snug">{e.k}</p>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-dp-muted">{e.a}</p>
            <p className="font-mono text-[11px] leading-relaxed text-dp-muted">{e.b}</p>
          </li>
        ))}
      </ol>

      {/* Mobile: la misma secuencia en vertical, con el evento bajando por el rail. */}
      <ol className="relative border-y border-dp-border md:hidden">
        <div aria-hidden className="pointer-events-none absolute bottom-0 left-[3px] top-0 w-px bg-dp-border-strong">
          <span className="dp-anim dp-viajero-y -ml-[2.5px] -mt-[3px] block h-1.5 w-1.5 rounded-full bg-dp-signal shadow-[0_0_10px_rgba(94,140,255,0.8)]" />
        </div>
        {etapas.map((e, i) => (
          <li key={e.k} className={`relative flex h-[76px] items-center gap-5 pl-6 ${i > 0 ? "border-t border-dp-border" : ""}`} style={{ ["--dp-i" as string]: i }}>
            <span aria-hidden className="dp-anim dp-etapa-marca absolute left-0 top-1/2 z-10 -mt-[3.5px] block h-[7px] w-[7px] rounded-full" />
            <span className="w-5 flex-none font-mono text-[10.5px] text-dp-muted">{String(i + 1).padStart(2, "0")}</span>
            <span className="min-w-0">
              <span className="dp-anim dp-etapa-nombre block font-mono text-[13px]">{e.k}</span>
              <span className="block truncate font-mono text-[11px] text-dp-muted">
                {e.a} · {e.b}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

export function DevPlataforma() {
  const { t } = useI18n();
  const { ref, atributos } = useBloque<HTMLElement>({ umbral: 0.2 });
  return (
    <section ref={ref} {...atributos} id={SECTION_IDS.plataforma} className="scroll-mt-14 border-t border-dp-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado
          indice="01"
          etiqueta={t("Plataforma", "Platform")}
          titulo={t("Del POST al WhatsApp de tu cliente.", "From your POST to your customer's WhatsApp.")}
          apoyo={t(
            "Tú haces un request. DuLabs autentica, aplica límites, encola, entrega a Meta, reintenta si algo falla y te devuelve cada evento firmado.",
            "You make a request. DuLabs authenticates, rate-limits, queues, hands off to Meta, retries when something fails and sends every event back to you, signed.",
          )}
        />
        <div className="mt-14 md:mt-16">
          <Etapas />
          {/* Camino de vuelta: lo que regresa a tu sistema. */}
          <div className="flex flex-col gap-2 border-b border-dp-border py-4 font-mono text-[11.5px] text-dp-muted md:flex-row md:items-center md:justify-between">
            <span>
              <span className="text-dp-text-2">↩ {t("vuelta", "return")}</span> · WhatsApp → DuLabs → {t("tu endpoint", "your endpoint")}
            </span>
            <span>message.received · message.status · HMAC-SHA256</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================== 03 · API ============================== */

const SEND_CURL = `curl ${API_BASE_URL}/messages \\
  -H "Authorization: Bearer dl_live_your_api_key" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "whatsappNumberId": "00000000-0000-0000-0000-000000000000",
    "to": "573000000000",
    "type": "text",
    "text": { "body": "Hola desde DuLabs" }
  }'`;

const SEND_JS = `const res = await fetch("${API_BASE_URL}/messages", {
  method: "POST",
  headers: {
    "Authorization": "Bearer dl_live_your_api_key",
    "Idempotency-Key": crypto.randomUUID(),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    whatsappNumberId: "00000000-0000-0000-0000-000000000000",
    to: "573000000000",
    type: "text",
    text: { body: "Hola desde DuLabs" },
  }),
});
const { jobId, status } = await res.json(); // 201 { jobId, status: "created" }`;

/** Panel de request: pestañas cURL / JavaScript, copiar con confirmación y la respuesta real del gateway. */
function PanelRequest() {
  const { t } = useI18n();
  const [lang, setLang] = useState<"curl" | "js">("curl");
  const [copiado, setCopiado] = useState(false);
  const codigo = lang === "curl" ? SEND_CURL : SEND_JS;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1600);
    } catch {
      // Sin portapapeles (contexto inseguro): no es crítico.
    }
  }

  return (
    <div className="dp-panel min-w-0 overflow-hidden rounded-dp-lg border border-dp-border bg-dp-surface">
      <div className="flex items-center justify-between gap-3 border-b border-dp-border px-4">
        <div role="tablist" aria-label={t("Lenguaje", "Language")} className="flex">
          {(["curl", "js"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={lang === l}
              onClick={() => setLang(l)}
              className={`dp-link relative py-3 pr-5 font-mono text-[12px] ${lang === l ? "text-dp-text" : "text-dp-muted hover:text-dp-text-2"}`}
            >
              {l === "curl" ? "cURL" : "JavaScript"}
              {lang === l ? <span aria-hidden className="absolute bottom-0 left-0 right-5 h-px bg-dp-text" /> : null}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-4">
          <span className="hidden truncate font-mono text-[11px] text-dp-muted sm:block">POST /api/v1/messages</span>
          <button
            type="button"
            onClick={copiar}
            aria-live="polite"
            className="dp-link flex-none rounded-dp border border-dp-border px-2.5 py-1 font-mono text-[11px] text-dp-text-2 hover:border-dp-border-strong hover:text-dp-text"
          >
            {copiado ? t("Copiado ✓", "Copied ✓") : t("Copiar", "Copy")}
          </button>
        </div>
      </div>
      <pre key={lang} className="dp-cruce overflow-x-auto px-4 py-5 font-mono text-[12px] leading-[1.7] text-dp-text md:text-[12.5px]">
        <code>{codigo}</code>
      </pre>
      <div className="border-t border-dp-border px-4 py-4 font-mono text-[12px]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-dp-text">201 Created</span>
          <span className="text-dp-muted">X-Request-Id: 8c1f…e04a</span>
        </div>
        <pre className="mt-2 overflow-x-auto text-dp-text-2">{`{ "jobId": "5f0c2a91-…-7d3e", "status": "created" }`}</pre>
      </div>
    </div>
  );
}

export function DevApi() {
  const { t } = useI18n();
  const { ref, atributos } = useBloque<HTMLElement>({ umbral: 0.3 });
  const ciclo: { k: string; via: string; d: string; senal?: boolean }[] = [
    { k: "request", via: "API", d: t("Bearer dl_live_… + Idempotency-Key", "Bearer dl_live_… + Idempotency-Key") },
    { k: "created", via: "201", d: t("aceptado, con jobId", "accepted, with a jobId") },
    { k: "queued", via: "GET /messages/{id}", d: t("en cola para un worker", "queued for a worker") },
    { k: "processing", via: "GET /messages/{id}", d: t("un worker lo está enviando", "a worker is sending it") },
    { k: "sent", via: "GET /messages/{id}", d: t("entregado a WhatsApp Cloud API", "handed off to WhatsApp Cloud API") },
    { k: "delivered", via: "webhook · message.status", d: t("confirmado por WhatsApp, firmado a tu endpoint", "confirmed by WhatsApp, signed to your endpoint"), senal: true },
  ];
  const superficie = [
    ["POST", "/messages", t("Enviar un mensaje", "Send a message")],
    ["GET", "/messages/{id}", t("Estado de un mensaje", "Message status")],
    ["GET", "/whatsapp-numbers", t("Números conectados", "Connected numbers")],
    ["GET", "/whatsapp-numbers/{id}", t("Un número", "One number")],
    ["GET", "/webhooks", t("Webhooks configurados", "Configured webhooks")],
    ["POST", "/webhooks", t("Configurar un webhook", "Configure a webhook")],
    ["GET", "/usage", t("Uso del mes", "Monthly usage")],
    ["GET", "/me", t("Verificar la API key", "Verify the API key")],
  ];
  return (
    <section ref={ref} {...atributos} id={SECTION_IDS.api} className="scroll-mt-14 border-t border-dp-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado
          indice="02"
          etiqueta="API"
          titulo={t("Un POST inicia una cadena observable.", "One POST starts an observable chain.")}
          apoyo={t(
            "Autenticas con tu API key, envías con una Idempotency-Key y recibes un jobId. Desde ahí, cada estado queda registrado hasta el webhook firmado.",
            "Authenticate with your API key, send with an Idempotency-Key and get a jobId back. From there, every state is recorded up to the signed webhook.",
          )}
        />

        <div className="mt-14 grid gap-10 md:mt-16 lg:grid-cols-12 lg:gap-12">
          <div className="min-w-0 lg:col-span-7">
            <PanelRequest />
          </div>

          <div className="lg:col-span-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dp-muted">{t("Ciclo de vida", "Lifecycle")}</p>
            <ol className="mt-5">
              {ciclo.map((c, i) => (
                <li key={c.k} className="dp-estado relative grid grid-cols-[20px_1fr] gap-x-4 pb-5 last:pb-0" style={{ ["--dp-i" as string]: i }} {...(c.senal ? { "data-senal": "" } : {})}>
                  {i < ciclo.length - 1 ? <span aria-hidden className="absolute bottom-0 left-[4.5px] top-4 w-px bg-dp-border" /> : null}
                  <span aria-hidden className="dp-estado-marca relative mt-[5px] block h-2.5 w-2.5 rounded-full border border-dp-border-strong bg-dp-bg" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-3 font-mono text-[13px]">
                      <span className="text-dp-text">{c.k}</span>
                      <span className="text-[11px] text-dp-muted">{c.via}</span>
                    </p>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-dp-text-2">{c.d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-6 border-t border-dp-border pt-4 text-[12.5px] leading-relaxed text-dp-muted">
              {t(
                "GET /messages/{id} reporta queued, processing, sent o failed. delivered y read llegan por el webhook message.status.",
                "GET /messages/{id} reports queued, processing, sent or failed. delivered and read arrive through the message.status webhook.",
              )}
            </p>
          </div>
        </div>

        {/* Superficie pública completa (OpenAPI): lo que existe, nada más. */}
        <div className="mt-16 grid gap-6 border-t border-dp-border pt-8 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dp-muted">{t("Superficie del API", "API surface")}</p>
            <p className="mt-3 break-all font-mono text-[11.5px] text-dp-text-2">{API_BASE_URL}</p>
          </div>
          <ul className="grid gap-x-10 sm:grid-cols-2 lg:col-span-9">
            {superficie.map(([m, ruta, d]) => (
              <li key={m + ruta} className="flex items-baseline gap-3 border-b border-dp-border py-2.5 font-mono text-[12px]">
                <span className={`w-10 flex-none ${m === "POST" ? "text-dp-text" : "text-dp-muted"}`}>{m}</span>
                <span className="min-w-0 flex-1 truncate text-dp-text-2">{ruta}</span>
                <span className="hidden flex-none font-sans text-[12.5px] text-dp-muted md:inline">{d}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-x-8 gap-y-3 lg:col-span-9 lg:col-start-4">
            <EnlaceFlecha href={`${DOCS_HREF}/messages`}>{t("Guía de mensajes", "Messages guide")}</EnlaceFlecha>
            <EnlaceFlecha href={`${DOCS_HREF}/reference`}>{t("Referencia OpenAPI", "OpenAPI reference")}</EnlaceFlecha>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================== 04 · WEBHOOKS + EVENTOS ============================== */

type Evento = { id: number; hora: string; tipo: "message.received" | "message.status"; detalle: string; estado: Estado; entrega: string };

// Guion de ejemplo (en bucle): lo que un workspace ve pasar. Tipos, estados y la política de reintentos son los reales del producto.
const GUION: Omit<Evento, "id" | "hora">[] = [
  { tipo: "message.status", detalle: "sent", estado: "sent", entrega: "200 · 41 ms" },
  { tipo: "message.status", detalle: "delivered", estado: "delivered", entrega: "200 · 38 ms" },
  { tipo: "message.received", detalle: "text", estado: "received", entrega: "503 · retry 2/5" },
  { tipo: "message.received", detalle: "text", estado: "received", entrega: "200 · 52 ms" },
  { tipo: "message.status", detalle: "read", estado: "read", entrega: "200 · 36 ms" },
  { tipo: "message.status", detalle: "failed", estado: "failed", entrega: "200 · 44 ms" },
  { tipo: "message.status", detalle: "sent", estado: "sent", entrega: "200 · 40 ms" },
];

function horaDe(base: number, paso: number): string {
  const s = base + paso * 3;
  const hh = 12;
  const mm = 4 + Math.floor(s / 60);
  return `${hh}:${String(mm % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Stream de eventos: una fila nueva cada pocos segundos mientras el bloque está en pantalla (en pausa fuera de ella / sin movimiento). */
function useStream(activo: boolean, filas: number) {
  const menos = useMenosMovimiento();
  const [n, setN] = useState(filas);
  useTic(activo && !menos, 2800, () => setN((x) => x + 1));
  const lista: Evento[] = [];
  for (let k = n - 1; k >= Math.max(0, n - filas); k--) lista.push({ ...GUION[k % GUION.length]!, id: k, hora: horaDe(20, k) });
  return { lista, ultimo: n - 1 };
}

function StreamEventos({ activo }: { activo: boolean }) {
  const { t } = useI18n();
  const { lista, ultimo } = useStream(activo, 6);
  return (
    <div className="dp-panel min-w-0 overflow-hidden rounded-dp-lg border border-dp-border bg-dp-surface">
      <div className="flex items-center justify-between border-b border-dp-border px-4 py-3">
        <span className="font-mono text-[11.5px] text-dp-text-2">events</span>
        <span className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-dp-muted">
          <span aria-hidden className="dp-senal" /> {t("en vivo · ejemplo", "live · example")}
        </span>
      </div>
      <div className="grid grid-cols-[64px_1fr_auto] gap-x-4 border-b border-dp-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dp-muted sm:grid-cols-[72px_150px_1fr_auto]">
        <span>{t("hora", "time")}</span>
        <span>{t("evento", "event")}</span>
        <span className="hidden sm:block">{t("estado", "status")}</span>
        <span className="text-right">{t("entrega", "delivery")}</span>
      </div>
      <ol aria-label={t("Eventos recientes (ejemplo)", "Recent events (example)")}>
        {lista.map((e) => (
          <li
            key={e.id}
            className={`grid grid-cols-[64px_1fr_auto] items-center gap-x-4 border-b border-dp-border px-4 py-2.5 font-mono text-[12px] last:border-0 sm:grid-cols-[72px_150px_1fr_auto] ${e.id === ultimo && ultimo > 5 ? "dp-fila-nueva" : ""}`}
          >
            <span className="text-dp-muted">{e.hora}</span>
            <span className="truncate text-dp-text-2">{e.tipo}</span>
            <span className="hidden items-center gap-2 sm:inline-flex">
              <MarcaEstado estado={e.estado} />
              <span className={e.estado === "failed" ? "text-dp-danger" : "text-dp-text"}>{e.detalle}</span>
            </span>
            <span className={`text-right ${e.entrega.startsWith("200") ? "text-dp-muted" : "text-dp-signal"}`}>{e.entrega}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function InspectorEntrega() {
  const { t } = useI18n();
  return (
    <div className="dp-panel min-w-0 overflow-hidden rounded-dp-lg border border-dp-border bg-dp-surface">
      <div className="flex items-center justify-between gap-3 border-b border-dp-border px-4 py-3 font-mono text-[11.5px]">
        <span className="truncate text-dp-text-2">
          POST <span className="text-dp-text">https://api.acme.dev/dulabs</span>
        </span>
        <span className="flex-none text-dp-text">200</span>
      </div>
      <dl className="space-y-1.5 border-b border-dp-border px-4 py-4 font-mono text-[11.5px]">
        {[
          ["X-DuLabs-Signature", "9f2a41c0…b78c"],
          ["X-DuLabs-Timestamp", "1712000271"],
          ["X-DuLabs-Event-ID", "0c7e5d1a-…-41f2"],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-x-2">
            <dt className="text-dp-muted">{k}:</dt>
            <dd className="text-dp-text">{v}</dd>
          </div>
        ))}
      </dl>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[11.5px] leading-[1.7] text-dp-text-2">{`{
  "event_type": "message.status",
  "event_id": "0c7e5d1a-…-41f2",
  "wamid": "wamid.HBgM…",
  "status": "delivered",
  "timestamp": "1712000270"
}`}</pre>
      <div className="border-t border-dp-border px-4 py-4">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dp-muted">{t("Verificación", "Verification")}</p>
        <p className="mt-2 break-words font-mono text-[11.5px] leading-relaxed text-dp-text-2">
          hmac_sha256(secret, <span className="text-dp-text">timestamp + &quot;.&quot; + body</span>) == X-DuLabs-Signature
        </p>
        <p className="mt-1 text-[12px] text-dp-muted">{t("Tolerancia de 5 minutos · deduplica por Event-ID", "5-minute tolerance · dedup by Event-ID")}</p>
      </div>
    </div>
  );
}

export function DevEventos() {
  const { t } = useI18n();
  const { ref, activo, atributos } = useBloque<HTMLElement>({ umbral: 0.2 });
  return (
    <section ref={ref} {...atributos} id={SECTION_IDS.webhooks} className="scroll-mt-14 border-t border-dp-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado
          indice="03"
          etiqueta={t("Webhooks y eventos", "Webhooks & events")}
          titulo={t("Cada evento, firmado y trazable.", "Every event, signed and traceable.")}
          apoyo={t(
            "Los mensajes entrantes y cada cambio de estado llegan a tu endpoint firmados con HMAC-SHA256. Si tu endpoint falla, DuLabs reintenta con backoff hasta 5 veces; después, el evento queda en la cola de fallidos (DLQ) y lo reenvías desde el dashboard.",
            "Inbound messages and every status change reach your endpoint signed with HMAC-SHA256. If your endpoint fails, DuLabs retries with backoff up to 5 times; after that the event lands in the dead-letter queue (DLQ) and you replay it from the dashboard.",
          )}
        />
        <div className="mt-14 grid gap-6 md:mt-16 lg:grid-cols-12 lg:gap-8">
          <div className="min-w-0 lg:col-span-7">
            <StreamEventos activo={activo} />
          </div>
          <div className="min-w-0 lg:col-span-5">
            <InspectorEntrega />
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <NotaEjemplo>{t("Datos de ejemplo · tipos, cabeceras y política de reintentos reales", "Example data · real event types, headers and retry policy")}</NotaEjemplo>
          <EnlaceFlecha href={`${DOCS_HREF}/webhooks`}>{t("Cómo verificar la firma", "How to verify the signature")}</EnlaceFlecha>
        </div>
      </div>
    </section>
  );
}

/* ============================== 05 · CONTROL (dashboard) ============================== */

export function DevControl() {
  const { t } = useI18n();
  const { ref, activo, atributos } = useBloque<HTMLElement>({ umbral: 0.25 });
  const { lista, ultimo } = useStream(activo, 4);
  const enviados = 12480 + Math.max(0, ultimo - 3) * 3;
  const nav = ["Overview", "API keys", "WhatsApp", "Webhooks", "Events", "Usage", "Members", "Plan"];
  const metricas = [
    { k: t("Mensajes este mes", "Messages this month"), v: enviados.toLocaleString("en-US"), sub: "/ 20,000", barra: enviados / 20000, cambia: true },
    { k: t("Números", "Numbers"), v: "2", sub: "/ 2" },
    { k: "API keys", v: "3", sub: t("activas", "active") },
    { k: "DLQ", v: "1", sub: t("por reenviar", "to replay") },
  ];
  return (
    <section ref={ref} {...atributos} id={SECTION_IDS.control} className="scroll-mt-14 border-t border-dp-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado
          indice="04"
          etiqueta={t("Control", "Control")}
          titulo={t("Opera tu integración desde un solo lugar.", "Run your integration from one place.")}
          apoyo={t(
            "Workspaces, números conectados, API keys, webhooks, uso del plan y el stream de eventos con reenvío desde la DLQ.",
            "Workspaces, connected numbers, API keys, webhooks, plan usage and the event stream with DLQ replay.",
          )}
        />

        <figure className="mt-14 md:mt-16">
          <div className="dp-panel overflow-hidden rounded-dp-lg border border-dp-border bg-dp-surface">
            <div className="flex items-center gap-3 border-b border-dp-border px-4 py-2.5">
              <span aria-hidden className="flex gap-1.5">
                <span className="h-2 w-2 rounded-full bg-white/10" />
                <span className="h-2 w-2 rounded-full bg-white/10" />
                <span className="h-2 w-2 rounded-full bg-white/10" />
              </span>
              <span className="font-mono text-[11px] text-dp-muted">dulabs.co/developer</span>
            </div>
            <div className="grid md:grid-cols-[200px_1fr]">
              <nav aria-hidden className="hidden border-r border-dp-border p-3 md:block">
                <p className="px-2.5 pb-3 pt-1 text-[12.5px] font-medium text-dp-text">
                  acme-prod <span className="font-mono text-[10px] text-dp-muted">workspace</span>
                </p>
                {nav.map((n, i) => (
                  <p key={n} className={`rounded-md px-2.5 py-1.5 text-[12.5px] ${i === 0 ? "bg-white/[0.06] text-dp-text" : "text-dp-muted"}`}>
                    {n}
                  </p>
                ))}
              </nav>
              <div className="min-w-0 p-4 md:p-6">
                <div className="grid grid-cols-2 border-l border-t border-dp-border lg:grid-cols-4">
                  {metricas.map((m) => (
                    <div key={m.k} className="border-b border-r border-dp-border p-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-dp-muted">{m.k}</p>
                      <p className="mt-2 font-mono text-[20px] tabular-nums text-dp-text md:text-[22px]">
                        <span key={m.cambia ? m.v : undefined} className={m.cambia && ultimo > 3 ? "dp-cambio" : undefined}>
                          {m.v}
                        </span>{" "}
                        <span className="text-[11.5px] text-dp-muted">{m.sub}</span>
                      </p>
                      {m.barra !== undefined ? (
                        <div aria-hidden className="mt-3 h-px bg-dp-border">
                          <div className="h-px bg-dp-text transition-[width] duration-700" style={{ width: `${Math.min(100, m.barra * 100)}%` }} />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="mt-5">
                  <div className="flex items-center justify-between pb-2">
                    <p className="text-[12.5px] font-medium text-dp-text">{t("Eventos recientes", "Recent events")}</p>
                    <p className="font-mono text-[10.5px] text-dp-muted">message.received · message.status</p>
                  </div>
                  <ol className="border-t border-dp-border">
                    {lista.map((e) => (
                      <li
                        key={e.id}
                        className={`flex items-center gap-3 border-b border-dp-border py-2 font-mono text-[11.5px] ${e.id === ultimo && ultimo > 3 ? "dp-fila-nueva" : ""}`}
                      >
                        <MarcaEstado estado={e.estado} />
                        <span className={`w-20 flex-none ${e.estado === "failed" ? "text-dp-danger" : "text-dp-text"}`}>{e.detalle}</span>
                        <span className="min-w-0 flex-1 truncate text-dp-muted">{e.tipo}</span>
                        <span className="hidden flex-none text-dp-muted sm:inline">{e.entrega}</span>
                        <span className="flex-none text-dp-muted">{e.hora}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          </div>
          <figcaption className="mt-4">
            <NotaEjemplo>{t("Vista ilustrativa del dashboard · datos de ejemplo", "Illustrative dashboard view · example data")}</NotaEjemplo>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/* ============================== 06 · PRODUCCIÓN ============================== */

export function DevProduccion() {
  const { t } = useI18n();
  const controles = [
    { k: "API key", v: t("dl_live_… por workspace · rotación y revocación", "dl_live_… per workspace · rotate and revoke") },
    { k: "HMAC-SHA256", v: t("firma de cada webhook sobre timestamp.body", "every webhook signed over timestamp.body") },
    { k: "Idempotency-Key", v: t("un reintento nunca duplica el envío", "a retry never duplicates a send") },
    { k: "Rate limits", v: t("2 msg/s por número · 1.200 msg/min y 300 lecturas/min por workspace", "2 msg/s per number · 1,200 msg/min and 300 reads/min per workspace") },
    { k: t("Aislamiento", "Isolation"), v: t("keys, números y eventos confinados a su workspace", "keys, numbers and events scoped to their workspace") },
    { k: "SSRF", v: t("URLs de webhook validadas antes de cada entrega", "webhook URLs validated before every delivery") },
    { k: t("Auditoría", "Audit"), v: t("registro de acciones de cuenta y facturación", "log of account and billing actions") },
  ];
  return (
    <section id={SECTION_IDS.produccion} className="scroll-mt-14 border-t border-dp-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado
          indice="05"
          etiqueta={t("Producción", "Production")}
          titulo={t("Pensado para producción desde el primer request.", "Built for production from the first request.")}
          apoyo={t(
            "Controles aplicados por la plataforma, no configuraciones opcionales. Sin claims de certificaciones que aún no tenemos.",
            "Controls enforced by the platform, not optional settings. No claims of certifications we don't hold yet.",
          )}
        />
        <div className="mt-14 grid gap-12 md:mt-16 lg:grid-cols-12 lg:gap-8">
          <dl className="border-t border-dp-border lg:col-span-7">
            {controles.map((c) => (
              <div key={c.k} className="grid grid-cols-1 gap-1 border-b border-dp-border py-3.5 sm:grid-cols-[170px_1fr_auto] sm:items-center sm:gap-4">
                <dt className="font-mono text-[12px] uppercase tracking-[0.08em] text-dp-text">{c.k}</dt>
                <dd className="text-[13.5px] leading-relaxed text-dp-text-2">{c.v}</dd>
                <dd className="hidden font-mono text-[10.5px] uppercase tracking-[0.14em] text-dp-muted sm:block">{t("aplicado", "enforced")}</dd>
              </div>
            ))}
          </dl>

          {/* Coexistencia: una capacidad operativa, no otra sección. */}
          <div className="lg:col-span-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dp-muted">{t("Coexistencia", "Coexistence")}</p>
            <h3 className="mt-4 text-[22px] font-medium leading-[1.2] tracking-[-0.02em] text-dp-text">{t("El mismo número, a mano y por API.", "The same number, by hand and by API.")}</h3>
            <div className="mt-6 border-y border-dp-border py-5 font-mono text-[12px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-dp-text">{t("Tu equipo", "Your team")}</span>
                <span className="text-dp-muted">{t("app de WhatsApp", "WhatsApp app")}</span>
              </div>
              <div aria-hidden className="my-2.5 flex items-center gap-3 text-dp-muted">
                <span className="h-px flex-1 bg-dp-border" /> ⇅ <span className="h-px flex-1 bg-dp-border" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-dp-text">{t("Número de WhatsApp", "WhatsApp number")}</span>
                <span className="text-dp-muted">{t("mismo número", "same number")}</span>
              </div>
              <div aria-hidden className="my-2.5 flex items-center gap-3 text-dp-muted">
                <span className="h-px flex-1 bg-dp-border" /> ⇅ <span className="h-px flex-1 bg-dp-border" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-dp-text">DuLabs</span>
                <span className="text-dp-muted">API · webhooks · {t("agentes", "agents")}</span>
              </div>
            </div>
            <p className="mt-5 text-[13.5px] leading-relaxed text-dp-text-2">
              {t(
                "Cuando la configuración de Meta lo permite, tu equipo sigue atendiendo desde la app de WhatsApp mientras automatizas sobre el mismo número, sin migrarlo.",
                "When Meta's configuration allows it, your team keeps replying from the WhatsApp app while you automate on the same number, without migrating it.",
              )}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
