"use client";

import Link from "next/link";
import {
  KeyRound, Webhook, Radio, ScrollText, GaugeCircle, Boxes, Users, Timer,
  Fingerprint, ShieldCheck, Repeat, MessageSquareText, ArrowRight, Check, Lock, Network, FileCode2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { CodeSample } from "@/components/developers/CodeSample";
import { API_BASE_URL, DOCS_HREF, SECTION_IDS } from "./constants";

// DuLabs Developer V1 -- Fase 15. Secciones de contenido de la landing
// comercial. Todo el contenido es Developer/CPaaS (no Business). Las
// capacidades descritas son REALES (Fases 5/10/12/13/14); sin claims de
// certificaciones/compliance inexistentes.

function DevSectionHeading({ eyebrow, title, desc }: { eyebrow: string; title: string; desc?: string }) {
  return (
    <div className="max-w-2xl">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-dev-accent">{eyebrow}</p>
      <h2 className="mt-4 font-display text-[28px] font-medium leading-[1.1] tracking-[-0.02em] text-site-fg md:text-[36px]">{title}</h2>
      {desc ? <p className="mt-4 text-[15.5px] leading-relaxed text-site-muted-fg md:text-[16px]">{desc}</p> : null}
    </div>
  );
}

/* ============================ 3 · PLATFORM ============================ */

export function DevPlatform() {
  const { t } = useI18n();
  const caps = [
    { icon: MessageSquareText, title: "WhatsApp API", desc: t("Envía mensajes sobre la WhatsApp Cloud API oficial de Meta.", "Send messages over Meta's official WhatsApp Cloud API.") },
    { icon: KeyRound, title: "API Keys", desc: t("Claves dl_live_ por workspace, con rotación y revocación.", "dl_live_ keys per workspace, with rotation and revocation.") },
    { icon: Webhook, title: "Webhooks", desc: t("Recibe eventos entrantes y de estado firmados con HMAC.", "Receive inbound and status events signed with HMAC.") },
    { icon: Radio, title: t("Eventos", "Events"), desc: t("message.received y message.status en tiempo real.", "message.received and message.status in real time.") },
    { icon: ScrollText, title: "Logs", desc: t("Historial de entregas, intentos y errores por evento.", "Delivery history, attempts and errors per event.") },
    { icon: GaugeCircle, title: "Usage", desc: t("Consumo mensual de mensajes y números por cuenta.", "Monthly message and number usage per account.") },
    { icon: Boxes, title: "Workspaces", desc: t("Aísla proyectos y clientes con datos separados.", "Isolate projects and clients with separate data.") },
    { icon: Users, title: t("Miembros", "Members"), desc: t("Roles OWNER / ADMIN / MEMBER por workspace.", "OWNER / ADMIN / MEMBER roles per workspace.") },
    { icon: Timer, title: "Rate limits", desc: t("Límites por número y por workspace, con Retry-After.", "Per-number and per-workspace limits, with Retry-After.") },
    { icon: Repeat, title: "Idempotency", desc: t("Reintenta sin duplicar con Idempotency-Key.", "Retry without duplicating using Idempotency-Key.") },
    { icon: Network, title: t("Delivery tracking", "Delivery tracking"), desc: t("Sigue cada mensaje de created a sent o failed.", "Track each message from created to sent or failed.") },
    { icon: ShieldCheck, title: t("Tenant isolation", "Tenant isolation"), desc: t("Aislamiento estricto por cuenta y workspace.", "Strict isolation per account and workspace.") },
  ];
  return (
    <section id={SECTION_IDS.plataforma} className="scroll-mt-20 py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <DevSectionHeading
          eyebrow={t("La plataforma", "The platform")}
          title={t("Todo lo que necesitas para integrar WhatsApp, en un solo lugar.", "Everything you need to integrate WhatsApp, in one place.")}
          desc={t("No es una lista de features de IA: es infraestructura de mensajería con las piezas que un equipo de producto realmente necesita en producción.", "Not a list of AI features: it's messaging infrastructure with the pieces a product team actually needs in production.")}
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-site-border bg-site-border sm:grid-cols-2 lg:grid-cols-3">
          {caps.map((c) => (
            <div key={c.title} className="group bg-site-bg p-6 transition-colors hover:bg-site-card">
              <c.icon className="h-5 w-5 text-dev-accent" strokeWidth={1.75} aria-hidden />
              <h3 className="mt-4 font-display text-[16px] font-medium text-site-fg">{c.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-site-muted-fg">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================ 4 · API FIRST ============================ */

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

export function DevApiFirst() {
  const { t } = useI18n();
  const puntos = [
    t("Autenticación con API key vía Bearer.", "Authentication with an API key via Bearer."),
    t("Idempotency-Key para reintentar sin duplicar.", "Idempotency-Key to retry without duplicating."),
    t("Respuestas y errores con formato estable y request_id.", "Stable-shaped responses and errors with request_id."),
    t("Consulta el estado con GET /messages/{id}.", "Check status with GET /messages/{id}."),
  ];
  return (
    <section id={SECTION_IDS.api} className="scroll-mt-20 border-t border-site-border py-20 md:py-28">
      <div className="mx-auto grid max-w-[1440px] items-center gap-12 px-6 lg:grid-cols-2">
        <div>
          <DevSectionHeading
            eyebrow="API-first"
            title={t("Un POST y tu mensaje está en camino.", "One POST and your message is on its way.")}
            desc={t("Diseñada para leerse en un minuto. El mismo contrato en cURL, JavaScript o TypeScript.", "Designed to read in a minute. The same contract in cURL, JavaScript or TypeScript.")}
          />
          <ul className="mt-8 space-y-3">
            {puntos.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[14.5px] text-site-muted-fg">
                <Check className="mt-0.5 h-4 w-4 flex-none text-dev-accent" strokeWidth={2.25} aria-hidden />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <Link href={`${DOCS_HREF}/messages`} className="mt-8 inline-flex items-center gap-1.5 text-[14px] font-medium text-dev-accent hover:underline">
            {t("Ver la referencia de Mensajes", "See the Messages reference")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <div>
          <CodeSample curl={SEND_CURL} js={SEND_JS} titulo="POST /api/v1/messages" />
        </div>
      </div>
    </section>
  );
}

/* ============================ 5 · WEBHOOKS ============================ */

export function DevWebhooks() {
  const { t } = useI18n();
  const flujo = [
    { tag: "Meta", label: t("WhatsApp Cloud API notifica a DuLabs", "WhatsApp Cloud API notifies DuLabs") },
    { tag: "DuLabs", label: t("Normaliza, deduplica y firma el evento", "Normalizes, deduplicates and signs the event") },
    { tag: t("Tu endpoint", "Your endpoint"), label: t("Recibe el webhook firmado y verifica la firma", "Receives the signed webhook and verifies the signature") },
  ];
  return (
    <section id={SECTION_IDS.webhooks} className="scroll-mt-20 border-t border-site-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <DevSectionHeading
          eyebrow="Webhooks"
          title={t("Eventos en tiempo real, firmados y verificables.", "Real-time events, signed and verifiable.")}
          desc={t("Cada mensaje entrante y cada cambio de estado llega a tu endpoint como un evento firmado. Verificas la firma y confías en el origen.", "Every inbound message and every status change reaches your endpoint as a signed event. You verify the signature and trust the source.")}
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col justify-center gap-2 rounded-2xl border border-site-border bg-site-card p-6">
            {flujo.map((f, i) => (
              <div key={f.tag}>
                <div className="flex items-center gap-3 rounded-xl border border-site-border bg-site-bg px-4 py-3">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-dev-accent">{f.tag}</span>
                  <span className="text-[13px] text-site-fg">{f.label}</span>
                </div>
                {i < flujo.length - 1 ? <div className="flex justify-center py-1" aria-hidden><span className="h-4 w-px bg-site-border" /></div> : null}
              </div>
            ))}
          </div>
          {/* Mockup: entrega real de webhook firmado */}
          <div className="overflow-hidden rounded-2xl border border-site-border bg-site-card">
            <MockChrome label="webhook.delivery" live="200 OK" />
            <div className="space-y-3 p-5 font-mono text-[12px]">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-site-fg"><span className="text-site-muted-fg">POST </span>https://api.acme.dev/webhooks</span>
                <span className="flex-none text-site-muted-fg">87 ms</span>
              </div>
              <div className="space-y-1.5 rounded-lg border border-site-border bg-site-bg p-3">
                {[
                  ["X-DuLabs-Signature", "t=1712000271,v1=9f2a…8c"],
                  ["X-DuLabs-Timestamp", "1712000271"],
                  ["X-DuLabs-Event-ID", "evt_01HX8Z…d4"],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-wrap gap-x-2 text-[11.5px]">
                    <span className="text-site-muted-fg">{k}:</span>
                    <span className="text-site-fg">{v}</span>
                  </div>
                ))}
              </div>
              <pre className="overflow-x-auto rounded-lg border border-site-border bg-site-bg p-3 text-[11.5px] leading-relaxed text-site-fg"><code>{`{
  "type": "message.status",
  "data": { "wamid": "wamid.HBg…", "status": "delivered" }
}`}</code></pre>
            </div>
          </div>
        </div>
        <Link href={`${DOCS_HREF}/webhooks`} className="mt-8 inline-flex items-center gap-1.5 text-[14px] font-medium text-dev-accent hover:underline">
          {t("Cómo verificar la firma de un webhook", "How to verify a webhook signature")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

/* ========================= 6 · OBSERVABILITY ========================= */

const EVENT_ROWS: { st: "delivered" | "sent" | "processing" | "failed" | "queued"; ev: string; id: string; meta: string; time: string }[] = [
  { st: "delivered", ev: "message.status", id: "msg_01HX8Z…a1", meta: "245 ms", time: "12:04:31" },
  { st: "sent", ev: "message.status", id: "msg_01HX8Z…b2", meta: "180 ms", time: "12:04:29" },
  { st: "processing", ev: "message.created", id: "job_01HX8Z…c3", meta: "—", time: "12:04:27" },
  { st: "failed", ev: "webhook.delivery", id: "evt_01HX8Z…d4", meta: "retry 2/5", time: "12:04:22" },
  { st: "queued", ev: "message.created", id: "job_01HX8Z…e5", meta: "—", time: "12:04:20" },
];

function StDot({ st }: { st: string }) {
  const cls = st === "failed" ? "bg-[#f08a8a]" : st === "processing" || st === "queued" ? "bg-site-muted-fg" : "bg-site-fg";
  return <span className={`h-1.5 w-1.5 flex-none rounded-full ${cls}`} aria-hidden />;
}

/** Chrome de ventana de producto (barra de puntos + etiqueta + indicador opcional). */
function MockChrome({ label, live }: { label: string; live?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-site-border px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-site-border" aria-hidden />
      <span className="h-2.5 w-2.5 rounded-full bg-site-border" aria-hidden />
      <span className="h-2.5 w-2.5 rounded-full bg-site-border" aria-hidden />
      <span className="ml-2 font-mono text-[11px] text-site-muted-fg">{label}</span>
      {live ? (
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">
          <span className="h-1.5 w-1.5 rounded-full bg-site-fg" aria-hidden /> {live}
        </span>
      ) : null}
    </div>
  );
}

export function DevObservability() {
  const { t } = useI18n();
  const puntos = [
    t("Cada intento de entrega y su latencia real.", "Every delivery attempt and its real latency."),
    t("Reintentos con backoff y cola de fallidos (DLQ).", "Backoff retries and a dead-letter queue (DLQ)."),
    t("Replay de un evento con un clic desde el dashboard.", "Replay an event with one click from the dashboard."),
  ];
  return (
    <section className="scroll-mt-20 border-t border-site-border py-20 md:py-28">
      <div className="mx-auto grid max-w-[1440px] items-center gap-12 px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <DevSectionHeading
            eyebrow={t("Observabilidad", "Observability")}
            title={t("Ve exactamente qué pasó con cada evento.", "See exactly what happened to every event.")}
            desc={t("No adivines por qué no llegó un mensaje. Cada mensaje deja un rastro: estado, request id, latencia, intentos y timestamp.", "Don't guess why a message didn't arrive. Every message leaves a trail: status, request id, latency, attempts and timestamp.")}
          />
          <ul className="mt-8 space-y-3">
            {puntos.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[14.5px] text-site-muted-fg">
                <Check className="mt-0.5 h-4 w-4 flex-none text-dev-accent" strokeWidth={2.25} aria-hidden />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        {/* Mockup: stream de eventos del producto */}
        <div className="overflow-hidden rounded-xl border border-site-border bg-site-card">
          <MockChrome label="events" live={t("en vivo", "live")} />
          <div className="grid grid-cols-[auto_1fr_auto] gap-x-4 px-3.5 py-2 font-mono text-[10px] uppercase tracking-wider text-site-muted-fg sm:grid-cols-[auto_1fr_auto_auto_auto] sm:gap-x-6">
            <span>status</span>
            <span>event</span>
            <span className="hidden sm:block">id</span>
            <span className="hidden sm:block text-right">latency</span>
            <span className="text-right">time</span>
          </div>
          <div className="divide-y divide-site-border border-t border-site-border">
            {EVENT_ROWS.map((r) => (
              <div key={r.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 px-3.5 py-2.5 font-mono text-[12px] transition-colors hover:bg-site-bg/60 sm:grid-cols-[auto_1fr_auto_auto_auto] sm:gap-x-6">
                <span className="inline-flex items-center gap-2">
                  <StDot st={r.st} />
                  <span className={r.st === "failed" ? "text-[#f08a8a]" : "text-site-fg"}>{r.st}</span>
                </span>
                <span className="truncate text-site-muted-fg">{r.ev}</span>
                <span className="hidden truncate text-site-muted-fg sm:block">{r.id}</span>
                <span className="hidden text-right text-site-muted-fg sm:block">{r.meta}</span>
                <span className="text-right text-site-muted-fg">{r.time}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-site-border px-3.5 py-2 font-mono text-[10px] text-site-muted-fg">
            <span>GET /api/v1/events</span>
            <span>{t("actualizado hace 2s", "updated 2s ago")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================ 7 · SECURITY ============================ */

export function DevSecurity() {
  const { t } = useI18n();
  const items = [
    { icon: KeyRound, k: "API KEY", v: "dl_live_••••••••••3f2a", tag: t("Activa", "Active") },
    { icon: Fingerprint, k: "HMAC-SHA256", v: t("Firma verificada", "Signature verified"), tag: t("Verificada", "Verified") },
    { icon: Repeat, k: "IDEMPOTENCY", v: "Idempotency-Key", tag: t("Activada", "Enabled") },
    { icon: Timer, k: "RATE LIMIT", v: "120 req/min", tag: t("Aplicado", "Enforced") },
    { icon: ShieldCheck, k: "TENANT", v: t("Workspace aislado", "Workspace isolated"), tag: t("Aislado", "Isolated") },
    { icon: Lock, k: "SSRF", v: t("URLs de webhook validadas", "Webhook URLs validated"), tag: t("Protegido", "Protected") },
  ];
  return (
    <section className="border-t border-site-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <DevSectionHeading
          eyebrow={t("Seguridad", "Security")}
          title={t("Seguridad integrada, no un extra.", "Security built in, not bolted on.")}
          desc={t("Capacidades reales del producto. Sin claims de certificaciones que aún no tenemos.", "Real product capabilities. No claims of certifications we don't hold yet.")}
        />
        <div className="mt-10 overflow-hidden rounded-xl border border-site-border bg-site-card">
          <MockChrome label="security" live={t("aplicado", "enforced")} />
          <div className="divide-y divide-site-border">
            {items.map((it) => (
              <div key={it.k} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                <it.icon className="h-4 w-4 flex-none text-site-muted-fg" strokeWidth={1.75} aria-hidden />
                <span className="w-32 flex-none font-mono text-[11px] uppercase tracking-wider text-site-muted-fg sm:w-40">{it.k}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-site-fg">{it.v}</span>
                <span className="inline-flex flex-none items-center gap-1.5 rounded-full border border-site-border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-site-muted-fg">
                  <span className="h-1.5 w-1.5 rounded-full bg-site-fg" aria-hidden />
                  {it.tag}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================ 9 · DOCS ============================ */

export function DevDocs() {
  const { t } = useI18n();
  const docs = [
    { label: "Quickstart", href: DOCS_HREF },
    { label: "Authentication", href: `${DOCS_HREF}/authentication` },
    { label: "Messages", href: `${DOCS_HREF}/messages` },
    { label: "Webhooks", href: `${DOCS_HREF}/webhooks` },
    { label: "Rate limits", href: `${DOCS_HREF}/rate-limits` },
    { label: "Errors", href: `${DOCS_HREF}/errors` },
    { label: "API Reference", href: `${DOCS_HREF}/reference` },
  ];
  return (
    <section id={SECTION_IDS.docs} className="scroll-mt-20 border-t border-site-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <DevSectionHeading
            eyebrow={t("Documentación", "Documentation")}
            title={t("Docs claras, con ejemplos que funcionan.", "Clear docs, with examples that work.")}
            desc={t("Quickstart, autenticación, mensajes, webhooks, rate limits, errores y la referencia completa del API.", "Quickstart, authentication, messages, webhooks, rate limits, errors and the full API reference.")}
          />
          <Link href={DOCS_HREF} className="inline-flex flex-none items-center gap-2 rounded-lg bg-dev-accent px-5 py-3 text-[14px] font-medium text-dev-accent-fg transition-colors hover:bg-dev-accent-hover">
            <FileCode2 className="h-4 w-4" aria-hidden />
            {t("Explora la documentación", "Explore the docs")}
          </Link>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {docs.map((d) => (
            <Link key={d.label} href={d.href} className="group flex items-center justify-between rounded-xl border border-site-border bg-site-card px-4 py-3.5 transition-colors hover:border-dev-accent/40">
              <span className="text-[14px] font-medium text-site-fg">{d.label}</span>
              <ArrowRight className="h-4 w-4 text-site-muted-fg transition-transform group-hover:translate-x-0.5 group-hover:text-dev-accent" aria-hidden />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ====================== 8 · DASHBOARD PREVIEW ====================== */

export function DevDashboardPreview() {
  const { t } = useI18n();
  const nav = ["Overview", "API keys", "WhatsApp", "Webhooks", "Events", "Usage"];
  const metrics = [
    { k: t("Mensajes", "Messages"), v: "12,480", sub: "/ 20,000" },
    { k: t("Números", "Numbers"), v: "2", sub: "/ 2" },
    { k: "API keys", v: "3", sub: t("activas", "active") },
    { k: "p95", v: "212", sub: "ms" },
  ];
  return (
    <section className="border-t border-site-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <DevSectionHeading
          eyebrow="Dashboard"
          title={t("Un panel para operar tu integración.", "One dashboard to run your integration.")}
          desc={t("Workspaces, uso, números conectados, API keys, webhooks y el stream de eventos — todo en una sola herramienta.", "Workspaces, usage, connected numbers, API keys, webhooks and the event stream — all in one tool.")}
        />
        <div className="mt-10 overflow-hidden rounded-2xl border border-site-border bg-site-card">
          <MockChrome label="app.dulabs.co/developer" />
          <div className="grid grid-cols-1 md:grid-cols-[184px_1fr]">
            <aside className="hidden border-r border-site-border p-3 md:block">
              <div className="mb-3 flex items-center gap-1.5 px-2 py-1 text-[12px] font-semibold text-site-fg">
                DuLabs <span className="font-mono text-[9px] uppercase tracking-wider text-site-muted-fg">Dev</span>
              </div>
              {nav.map((n, i) => (
                <div key={n} className={`rounded-md px-2.5 py-1.5 text-[12px] ${i === 0 ? "bg-white/[0.06] text-site-fg" : "text-site-muted-fg"}`}>{n}</div>
              ))}
            </aside>
            <div className="min-w-0 p-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {metrics.map((m) => (
                  <div key={m.k} className="rounded-lg border border-site-border p-3">
                    <div className="font-mono text-[9.5px] uppercase tracking-wider text-site-muted-fg">{m.k}</div>
                    <div className="mt-1.5 font-mono text-[19px] tabular-nums text-site-fg">
                      {m.v} <span className="text-[11px] text-site-muted-fg">{m.sub}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 overflow-hidden rounded-lg border border-site-border">
                <div className="flex items-center justify-between border-b border-site-border px-3 py-2">
                  <span className="text-[11.5px] font-medium text-site-fg">{t("Eventos recientes", "Recent events")}</span>
                  <span className="font-mono text-[10px] text-site-muted-fg">message.status · webhook.delivery</span>
                </div>
                {EVENT_ROWS.slice(0, 4).map((r) => (
                  <div key={r.id} className="flex items-center gap-3 border-b border-site-border px-3 py-2 font-mono text-[11.5px] last:border-0">
                    <StDot st={r.st} />
                    <span className={`w-[74px] flex-none ${r.st === "failed" ? "text-[#f08a8a]" : "text-site-fg"}`}>{r.st}</span>
                    <span className="min-w-0 flex-1 truncate text-site-muted-fg">{r.ev}</span>
                    <span className="hidden flex-none text-site-muted-fg sm:block">{r.id}</span>
                    <span className="flex-none text-site-muted-fg">{r.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
