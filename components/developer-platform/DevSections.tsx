"use client";

import Link from "next/link";
import { KeyRound, Timer, Fingerprint, ShieldCheck, Repeat, ArrowRight, Check, Lock, FileCode2 } from "lucide-react";
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

/** Flecha del pipeline: → en desktop, ↓ apilado en móvil. */
function PipeArrow() {
  return (
    <span className="flex items-center justify-center text-site-muted-fg" aria-hidden>
      <span className="md:hidden">↓</span>
      <span className="hidden md:inline">→</span>
    </span>
  );
}

export function DevPlatform() {
  const { t } = useI18n();
  const pipeline = [
    { k: t("Tu app", "Your app"), s: "cURL · JS · TS" },
    { k: "API Gateway", s: t("auth · rate limit · idempotency", "auth · rate limit · idempotency") },
    { k: "Queue", s: "at-least-once" },
    { k: "Workers", s: t("reintentos · DLQ", "retries · DLQ") },
    { k: "WhatsApp Cloud API", s: t("envío oficial de Meta", "Meta official send") },
    { k: t("Cliente", "Customer"), s: t("recibe en WhatsApp", "receives on WhatsApp") },
  ];
  const incluido = ["API keys", "webhooks", "events", "logs", "usage", "workspaces", "members", "rate limits", "idempotency", "tenant isolation"];
  return (
    <section id={SECTION_IDS.plataforma} className="scroll-mt-20 py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <DevSectionHeading
          eyebrow={t("La plataforma", "The platform")}
          title={t("La infraestructura de mensajería, ya construida.", "The messaging infrastructure, already built.")}
          desc={t("Tú haces un POST. Nosotros manejamos autenticación, rate limiting, idempotencia, la cola, los reintentos, la firma de webhooks y la entrega a Meta.", "You make a POST. We handle auth, rate limiting, idempotency, the queue, retries, webhook signing and delivery to Meta.")}
        />
        {/* Diagrama de arquitectura real (no cards) */}
        <div className="mt-12 rounded-2xl border border-site-border bg-site-card p-5 md:p-7">
          <div className="flex flex-col gap-2.5 md:flex-row md:items-stretch md:gap-2.5">
            {pipeline.map((n, i) => (
              <div key={n.k} className="contents md:flex md:flex-1 md:items-stretch">
                <div className="dev-step flex-1 rounded-xl border border-site-border bg-site-bg px-4 py-3.5" style={{ ["--dev-i" as string]: i }}>
                  <div className="font-mono text-[12.5px] text-site-fg">{n.k}</div>
                  <div className="mt-1 font-mono text-[10px] leading-relaxed text-site-muted-fg">{n.s}</div>
                </div>
                {i < pipeline.length - 1 ? <PipeArrow /> : null}
              </div>
            ))}
          </div>
          {/* Camino de retorno: webhooks firmados */}
          <div className="mt-3 flex flex-col gap-2.5 border-t border-site-border pt-4 sm:flex-row sm:items-center">
            <span className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">↳ {t("eventos", "events")}</span>
            <div className="flex flex-1 flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="rounded-xl border border-site-border bg-site-bg px-4 py-2.5">
                <span className="font-mono text-[12px] text-site-fg">{t("Webhooks firmados", "Signed webhooks")}</span>
                <span className="ml-2 font-mono text-[10px] text-site-muted-fg">HMAC-SHA256</span>
              </div>
              <span className="hidden text-site-muted-fg sm:inline" aria-hidden>→</span>
              <div className="rounded-xl border border-site-border bg-site-bg px-4 py-2.5">
                <span className="font-mono text-[12px] text-site-fg">{t("Tu endpoint", "Your endpoint")}</span>
              </div>
            </div>
          </div>
        </div>
        {/* Incluido (tira mono, no cards) */}
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2.5 font-mono text-[12px] text-site-muted-fg">
          {incluido.map((x) => (
            <span key={x} className="inline-flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-site-muted-fg" aria-hidden />
              {x}
            </span>
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
          <span className="dev-live-dot h-1.5 w-1.5 rounded-full bg-site-fg" aria-hidden /> {live}
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
            {EVENT_ROWS.map((r, i) => (
              <div key={r.id} style={{ ["--dev-i" as string]: i }} className="dev-stream-row grid grid-cols-[auto_1fr_auto] items-center gap-x-4 px-3.5 py-2.5 font-mono text-[12px] transition-colors hover:bg-site-bg/60 sm:grid-cols-[auto_1fr_auto_auto_auto] sm:gap-x-6">
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
                {EVENT_ROWS.slice(0, 4).map((r, i) => (
                  <div key={r.id} style={{ ["--dev-i" as string]: i }} className="dev-stream-row flex items-center gap-3 border-b border-site-border px-3 py-2 font-mono text-[11.5px] last:border-0">
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

/* =================== 10 · BUILD ON OFFICIAL WHATSAPP =================== */

/** Nodo de un stack vertical (producto → infra → Meta → cliente). */
function StackNode({ k, s, i, last }: { k: string; s: string; i: number; last?: boolean }) {
  return (
    <div className="flex flex-col items-stretch">
      <div className="dev-step rounded-xl border border-site-border bg-site-bg px-4 py-3.5" style={{ ["--dev-i" as string]: i }}>
        <div className="font-mono text-[12.5px] text-site-fg">{k}</div>
        <div className="mt-1 font-mono text-[10.5px] leading-relaxed text-site-muted-fg">{s}</div>
      </div>
      {!last ? (
        <div className="flex h-6 items-center justify-center" aria-hidden>
          <span className="dev-wire-y h-full w-px bg-site-border" style={{ ["--dev-i" as string]: i }} />
        </div>
      ) : null}
    </div>
  );
}

export function DevBuild() {
  const { t } = useI18n();
  const stack = [
    { k: t("Tu agente de IA · tu app", "Your AI agent · your app"), s: t("IA · CRM · automatización", "AI · CRM · automation") },
    { k: "DuLabs API", s: t("API keys · webhooks · eventos · logs", "API keys · webhooks · events · logs") },
    { k: "WhatsApp Cloud API", s: t("oficial de Meta", "official, by Meta") },
    { k: t("Cliente", "Customer"), s: t("recibe en WhatsApp", "receives on WhatsApp") },
  ];
  const usos = [
    t("Agentes de IA", "AI agents"),
    "CRMs",
    t("Automatizaciones", "Automations"),
    t("Campañas", "Campaigns"),
    t("Notificaciones", "Notifications"),
    t("Soporte", "Support"),
    t("Reservas", "Bookings"),
    t("Ventas", "Sales"),
    t("Integraciones", "Integrations"),
  ];
  return (
    <section className="scroll-mt-20 border-t border-site-border py-20 md:py-28">
      <div className="mx-auto grid max-w-[1440px] items-center gap-12 px-6 lg:grid-cols-[1fr_0.95fr]">
        <div>
          <DevSectionHeading
            eyebrow={t("Sobre WhatsApp oficial", "On official WhatsApp")}
            title={t("WhatsApp oficial. Tu producto. Tu infraestructura.", "Official WhatsApp. Your product. Your infrastructure.")}
            desc={t(
              "DuLabs es la infraestructura, no otro chatbot. Conectas WhatsApp Cloud API de Meta a tu propio producto y construyes encima: agentes de IA, CRMs, automatizaciones y sistemas propios.",
              "DuLabs is the infrastructure, not another chatbot. You connect Meta's WhatsApp Cloud API to your own product and build on top: AI agents, CRMs, automations and your own systems.",
            )}
          />
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2.5 font-mono text-[12px] text-site-muted-fg">
            {usos.map((x) => (
              <span key={x} className="inline-flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-site-muted-fg" aria-hidden />
                {x}
              </span>
            ))}
          </div>
          <p className="mt-8 max-w-lg rounded-xl border border-site-border bg-site-card p-4 text-[13.5px] leading-relaxed text-site-muted-fg">
            {t(
              "Construyes sobre la infraestructura oficial de WhatsApp de Meta y operas dentro de sus políticas y mecanismos de mensajería.",
              "You build on Meta's official WhatsApp infrastructure and operate within its messaging policies and mechanisms.",
            )}
          </p>
        </div>
        {/* Stack: tu producto -> DuLabs -> WhatsApp Cloud API -> cliente */}
        <div className="overflow-hidden rounded-2xl border border-site-border bg-site-card">
          <MockChrome label={t("arquitectura", "architecture")} live={t("oficial", "official")} />
          <div className="p-5 md:p-6">
            {stack.map((n, i) => (
              <StackNode key={n.k} k={n.k} s={n.s} i={i} last={i === stack.length - 1} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ====================== 11 · MESSAGE LIFECYCLE ====================== */

export function DevLifecycle() {
  const { t } = useI18n();
  const steps = [
    { n: "01", k: "request", d: "POST /api/v1/messages", note: t("Autenticado con API key + Idempotency-Key", "Authenticated with API key + Idempotency-Key"), meta: "12:41:03.011" },
    { n: "02", k: "accepted", d: `201 · { "status": "created" }`, note: t("Encolado con rate limit e idempotencia", "Queued with rate limit and idempotency"), meta: "+142 ms" },
    { n: "03", k: "queued", d: "queue · at-least-once", note: t("En cola, listo para un worker", "In queue, ready for a worker"), meta: "+8 ms" },
    { n: "04", k: "sent", d: `GET /messages/{id} → "sent"`, note: t("Entregado a WhatsApp Cloud API", "Handed off to WhatsApp Cloud API"), meta: "+240 ms" },
    { n: "05", k: "delivered", d: "message.status → delivered", note: t("Confirmado por WhatsApp", "Confirmed by WhatsApp"), meta: "+1.2 s" },
    { n: "06", k: "webhook", d: t("POST tu endpoint · message.status", "POST your endpoint · message.status"), note: t("Firmado HMAC-SHA256 + Event-ID", "Signed HMAC-SHA256 + Event-ID"), meta: "200 OK" },
  ];
  return (
    <section className="scroll-mt-20 border-t border-site-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <DevSectionHeading
          eyebrow={t("Ciclo de vida", "Message lifecycle")}
          title={t("Sigue cada mensaje, del POST al webhook.", "Follow every message, from POST to webhook.")}
          desc={t(
            "Un mensaje no es «enviar y rezar». Cada estado queda registrado con su request id, latencia y timestamp, y termina en un webhook firmado en tu endpoint.",
            "A message isn't fire-and-forget. Every state is recorded with its request id, latency and timestamp, and ends in a signed webhook on your endpoint.",
          )}
        />
        <div className="mt-10 overflow-hidden rounded-2xl border border-site-border bg-site-card">
          <MockChrome label="message.lifecycle" live={t("en vivo", "live")} />
          <div className="divide-y divide-site-border">
            {steps.map((st, i) => (
              <div key={st.n} className="grid grid-cols-[2rem_1fr_auto] items-stretch gap-4 px-4 py-4 sm:px-5">
                <div className="flex flex-col items-center">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-site-border font-mono text-[9.5px] text-site-muted-fg">{st.n}</span>
                  {i < steps.length - 1 ? <span className="dev-wire-y mt-1.5 w-px flex-1 bg-site-border" style={{ ["--dev-i" as string]: i }} aria-hidden /> : null}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 font-mono text-[12.5px]">
                    <span className="dev-step text-site-fg" style={{ ["--dev-i" as string]: i }}>{st.k}</span>
                    <span className="min-w-0 truncate text-site-muted-fg">{st.d}</span>
                  </div>
                  <div className="mt-1 text-[12.5px] leading-relaxed text-site-muted-fg">{st.note}</div>
                </div>
                <div className="text-right font-mono text-[11px] text-site-muted-fg">{st.meta}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ===================== 12 · MESSAGING & CAMPAIGNS ===================== */

export function DevMessaging() {
  const { t } = useI18n();
  const puntos = [
    t("Transaccionales, notificaciones, conversacionales y campañas con plantillas.", "Transactional, notifications, conversational and template campaigns."),
    t("Seguimiento por estado: enviado, entregado, leído y fallido.", "Status tracking: sent, delivered, read and failed."),
    t("Reintentos con backoff, DLQ y webhooks de estado por cada mensaje.", "Backoff retries, DLQ and status webhooks for every message."),
  ];
  const funnel = [
    { k: t("encolados", "queued"), v: "12,480", w: "100%" },
    { k: t("enviados", "sent"), v: "12,455", w: "99.8%" },
    { k: t("entregados", "delivered"), v: "12,390", w: "99.3%" },
    { k: t("leídos", "read"), v: "9,102", w: "73%" },
    { k: t("fallidos", "failed"), v: "25", w: "2%", danger: true },
  ];
  return (
    <section className="scroll-mt-20 border-t border-site-border py-20 md:py-28">
      <div className="mx-auto grid max-w-[1440px] items-center gap-12 px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <DevSectionHeading
            eyebrow={t("Mensajería", "Messaging")}
            title={t("Mensajería a escala, con reglas claras.", "Messaging at scale, with clear rules.")}
            desc={t(
              "Envía desde una confirmación hasta una campaña, y observa cada entrega. El envío de plantillas y campañas sigue las categorías y políticas de mensajería de WhatsApp/Meta.",
              "Send anything from a single confirmation to a campaign, and observe every delivery. Template and campaign sending follows WhatsApp/Meta's messaging categories and policies.",
            )}
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
        {/* Panel de entrega: funnel con estados reales de WhatsApp */}
        <div className="overflow-hidden rounded-2xl border border-site-border bg-site-card">
          <MockChrome label="delivery" live={t("último envío", "last send")} />
          <div className="space-y-3.5 p-5 md:p-6">
            {funnel.map((f, i) => (
              <div key={f.k} style={{ ["--dev-i" as string]: i }} className="dev-stream-row">
                <div className="flex items-baseline justify-between font-mono text-[11.5px]">
                  <span className={f.danger ? "text-[#f08a8a]" : "text-site-fg"}>{f.k}</span>
                  <span className="tabular-nums text-site-muted-fg">
                    {f.v} <span className="text-site-border">·</span> {f.w}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className={`h-full rounded-full ${f.danger ? "bg-[#f08a8a]/70" : "bg-site-fg/70"}`} style={{ width: f.w }} />
                </div>
              </div>
            ))}
            <p className="border-t border-site-border pt-3 font-mono text-[10.5px] leading-relaxed text-site-muted-fg">
              {t("Estados provistos por WhatsApp Cloud API · sin promesas de «cero bloqueos».", "Statuses provided by WhatsApp Cloud API · no “zero blocks” promises.")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ========================= 13 · COEXISTENCE ========================= */

export function DevCoexistence() {
  const { t } = useI18n();
  const nodos = [
    { k: t("Tu equipo", "Your team"), s: t("app de WhatsApp", "WhatsApp app") },
    { k: t("Número de WhatsApp", "WhatsApp number"), s: t("mismo número", "same number") },
    { k: "DuLabs", s: t("API · webhooks · agentes", "API · webhooks · agents") },
  ];
  const puntos = [
    t("Un mismo número atiende de forma manual y por API, según la configuración de Meta.", "A single number is served both manually and via API, per Meta's configuration."),
    t("Automatiza e integra agentes y sistemas propios sin migrar el número.", "Automate and integrate your own agents and systems without migrating the number."),
    t("Las capacidades disponibles dependen de la configuración de WhatsApp/Meta.", "Available capabilities depend on the WhatsApp/Meta configuration."),
  ];
  return (
    <section className="scroll-mt-20 border-t border-site-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <DevSectionHeading
          eyebrow={t("Coexistencia", "Coexistence")}
          title={t("Automatiza sin dejar de atender a mano.", "Automate without giving up manual replies.")}
          desc={t(
            "Cuando la configuración de Meta lo permite, DuLabs trabaja en modo Coexistencia: tu equipo sigue usando la app de WhatsApp y, sobre el mismo número, conectas API, webhooks y agentes.",
            "When Meta's configuration allows it, DuLabs works in Coexistence mode: your team keeps using the WhatsApp app while, on the same number, you connect API, webhooks and agents.",
          )}
        />
        <div className="mt-10 overflow-hidden rounded-2xl border border-site-border bg-site-card p-5 md:p-7">
          <div className="flex flex-col gap-2.5 md:flex-row md:items-stretch">
            {nodos.map((n, i) => (
              <div key={n.k} className="contents md:flex md:flex-1 md:items-stretch">
                <div
                  className={`dev-step flex-1 rounded-xl border px-4 py-4 ${i === 1 ? "border-white/25 bg-site-bg" : "border-site-border bg-site-bg"}`}
                  style={{ ["--dev-i" as string]: i }}
                >
                  <div className="font-mono text-[12.5px] text-site-fg">{n.k}</div>
                  <div className="mt-1 font-mono text-[10.5px] text-site-muted-fg">{n.s}</div>
                </div>
                {i < nodos.length - 1 ? (
                  <span className="flex items-center justify-center text-site-muted-fg" aria-hidden>
                    <span className="md:hidden">↕</span>
                    <span className="hidden md:inline">⇄</span>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <ul className="mt-6 grid gap-3 border-t border-site-border pt-5 sm:grid-cols-3">
            {puntos.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-site-muted-fg">
                <Check className="mt-0.5 h-4 w-4 flex-none text-dev-accent" strokeWidth={2.25} aria-hidden />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
