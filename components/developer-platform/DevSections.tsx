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
  const attrs = [
    { icon: Fingerprint, k: "X-DuLabs-Signature", v: t("HMAC-SHA256 de timestamp + body.", "HMAC-SHA256 of timestamp + body.") },
    { icon: Timer, k: "X-DuLabs-Timestamp", v: t("Tolerancia de 5 min contra replay.", "5-min tolerance against replay.") },
    { icon: Repeat, k: "X-DuLabs-Event-ID", v: t("Dedup at-least-once en tu lado.", "At-least-once dedup on your side.") },
    { icon: Network, k: t("Reintentos + DLQ", "Retries + DLQ"), v: t("Reintentos con backoff y cola de fallidos.", "Backoff retries and a dead-letter queue.") },
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
          <div className="grid gap-px overflow-hidden rounded-2xl border border-site-border bg-site-border sm:grid-cols-2">
            {attrs.map((a) => (
              <div key={a.k} className="bg-site-bg p-5">
                <a.icon className="h-5 w-5 text-dev-accent" strokeWidth={1.75} aria-hidden />
                <div className="mt-3 font-mono text-[12.5px] text-site-fg">{a.k}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-site-muted-fg">{a.v}</p>
              </div>
            ))}
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

export function DevObservability() {
  const { t } = useI18n();
  const items = [
    t("Eventos entregados y pendientes", "Delivered and pending events"),
    t("Intentos de entrega y su resultado", "Delivery attempts and their outcome"),
    t("Errores y cola de fallidos (DLQ)", "Errors and dead-letter queue (DLQ)"),
    t("Consumo de mensajes y números", "Message and number usage"),
    t("Estado de cada mensaje: created → sent / failed", "Each message status: created → sent / failed"),
    t("Replay de eventos desde el dashboard", "Event replay from the dashboard"),
  ];
  return (
    <section className="border-t border-site-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <DevSectionHeading
          eyebrow={t("Observabilidad", "Observability")}
          title={t("Ve exactamente qué pasó con cada evento.", "See exactly what happened to every event.")}
          desc={t("No adivines por qué no llegó un mensaje. El dashboard muestra entregas, intentos, errores y la DLQ, con replay cuando lo necesites.", "Don't guess why a message didn't arrive. The dashboard shows deliveries, attempts, errors and the DLQ, with replay when you need it.")}
        />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div key={it} className="flex items-start gap-3 rounded-xl border border-site-border bg-site-card p-4">
              <Check className="mt-0.5 h-4 w-4 flex-none text-dev-accent" strokeWidth={2.25} aria-hidden />
              <span className="text-[14px] text-site-fg">{it}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================ 7 · SECURITY ============================ */

export function DevSecurity() {
  const { t } = useI18n();
  const items = [
    { icon: KeyRound, title: "API Keys", desc: t("Claves por workspace, rotables y revocables.", "Per-workspace keys, rotatable and revocable.") },
    { icon: Fingerprint, title: t("Firma HMAC de webhooks", "HMAC webhook signing"), desc: t("HMAC-SHA256 con tolerancia de tiempo contra replay.", "HMAC-SHA256 with a time tolerance against replay.") },
    { icon: Repeat, title: "Idempotencia", desc: t("Idempotency-Key evita cobros y envíos duplicados.", "Idempotency-Key avoids duplicate charges and sends.") },
    { icon: ShieldCheck, title: t("Aislamiento por tenant", "Tenant isolation"), desc: t("Datos separados por cuenta y workspace.", "Data separated per account and workspace.") },
    { icon: Timer, title: "Rate limiting", desc: t("Protección por número y por workspace.", "Protection per number and per workspace.") },
    { icon: Lock, title: t("Protección SSRF", "SSRF protection"), desc: t("Las URLs de webhook se validan contra SSRF.", "Webhook URLs are validated against SSRF.") },
    { icon: ScrollText, title: t("Eventos auditables", "Auditable events"), desc: t("Historial append-only de eventos y entregas.", "Append-only history of events and deliveries.") },
  ];
  return (
    <section className="border-t border-site-border py-20 md:py-28">
      <div className="mx-auto max-w-[1440px] px-6">
        <DevSectionHeading
          eyebrow={t("Seguridad", "Security")}
          title={t("Seguridad integrada, no un extra.", "Security built in, not bolted on.")}
          desc={t("Capacidades reales del producto. Sin claims de certificaciones que aún no tenemos.", "Real product capabilities. No claims of certifications we don't hold yet.")}
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div key={it.title} className="rounded-2xl border border-site-border bg-site-card p-6">
              <it.icon className="h-5 w-5 text-dev-accent" strokeWidth={1.75} aria-hidden />
              <h3 className="mt-4 font-display text-[15.5px] font-medium text-site-fg">{it.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-site-muted-fg">{it.desc}</p>
            </div>
          ))}
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
