"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { START_HREF, DOCS_HREF } from "./constants";

// DuLabs Developer V1 -- Fase 15. Hero de la landing comercial. La visual es
// el ciclo real de un mensaje (request -> queued -> sent -> webhook), no un
// mockup de teléfono. Términos y estados reales del gateway (Fase 5/10/13).

function FlowNode({ tag, title, sub, tone = "default" }: { tag: string; title: string; sub: string; tone?: "default" | "accent" | "ok" }) {
  const toneCls =
    tone === "accent"
      ? "border-dev-accent/40 bg-dev-accent-soft"
      : tone === "ok"
        ? "border-success/40 bg-success/10"
        : "border-site-border bg-site-card";
  return (
    <div className={`rounded-xl border ${toneCls} px-4 py-3`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">{tag}</span>
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-40" aria-hidden />
      </div>
      <div className="mt-1 font-mono text-[13px] text-site-fg">{title}</div>
      <div className="mt-0.5 text-[11.5px] text-site-muted-fg">{sub}</div>
    </div>
  );
}

function Conector() {
  return (
    <div className="flex justify-center py-1" aria-hidden>
      <span className="h-4 w-px bg-gradient-to-b from-site-border to-transparent" />
    </div>
  );
}

export function DevHero() {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden pt-28 pb-16 md:pt-36 md:pb-24">
      <div className="mx-auto grid max-w-[1440px] items-center gap-14 px-6 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Columna de mensaje */}
        <div className="max-w-xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-site-border bg-site-card px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-dev-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-dev-accent shadow-[0_0_6px_var(--color-dev-accent)]" />
            CPaaS · WhatsApp Cloud API
          </p>
          <h1 className="mt-6 font-display text-[38px] font-medium leading-[1.05] tracking-[-0.03em] text-site-fg md:text-[56px]">
            {t("Construye sobre WhatsApp sin construir la infraestructura.", "Build on WhatsApp without building the infrastructure.")}
          </h1>
          <p className="mt-6 text-[16px] leading-relaxed text-site-muted-fg md:text-[17px]">
            {t(
              "Una API para enviar mensajes, recibir eventos por webhook y observar cada entrega. API keys, workspaces, idempotencia, rate limits y firma de webhooks incluidos desde el día uno.",
              "One API to send messages, receive events via webhooks and observe every delivery. API keys, workspaces, idempotency, rate limits and webhook signing built in from day one.",
            )}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href={START_HREF}
              className="inline-flex items-center gap-2 rounded-lg bg-dev-accent px-5 py-3 text-[14px] font-medium text-dev-accent-fg shadow-sm transition-colors hover:bg-dev-accent-hover"
            >
              {t("Comenzar", "Get started")}
              <span aria-hidden>→</span>
            </Link>
            <Link
              href={DOCS_HREF}
              className="inline-flex items-center gap-2 rounded-lg border border-site-border bg-site-card px-5 py-3 text-[14px] font-medium text-site-fg transition-colors hover:border-dev-accent/40"
            >
              {t("Ver documentación", "View docs")}
            </Link>
          </div>
          <p className="mt-5 font-mono text-[11.5px] text-site-muted-fg">
            {t("Empieza gratis en el dashboard · sin tarjeta para explorar", "Start in the dashboard · no card to explore")}
          </p>
        </div>

        {/* Visual: ciclo de vida real de un mensaje */}
        <div className="relative">
          <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[28px] bg-[radial-gradient(60%_60%_at_70%_20%,var(--color-dev-accent-soft),transparent)] opacity-70" aria-hidden />
          <div className="rounded-2xl border border-site-border bg-site-card p-4 md:p-5">
            <div className="mb-3 flex items-center gap-2 px-1">
              <span className="h-2.5 w-2.5 rounded-full bg-site-border" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-site-border" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-site-border" aria-hidden />
              <span className="ml-2 font-mono text-[11px] text-site-muted-fg">message lifecycle</span>
            </div>
            <FlowNode tag="1 · request" title="POST /api/v1/messages" sub={t("Autenticado con tu API key + Idempotency-Key", "Authenticated with your API key + Idempotency-Key")} tone="accent" />
            <Conector />
            <FlowNode tag="2 · accepted" title={`201 · { "jobId": "…", "status": "created" }`} sub={t("Encolado con rate limit e idempotencia", "Queued with rate limiting and idempotency")} />
            <Conector />
            <FlowNode tag="3 · sent" title={`GET /messages/{id} → "sent"`} sub={t("Entregado a WhatsApp Cloud API", "Delivered to WhatsApp Cloud API")} />
            <Conector />
            <FlowNode tag="4 · webhook" title="POST tu endpoint · message.status" sub={t("Firmado con HMAC-SHA256 + Event-ID", "Signed with HMAC-SHA256 + Event-ID")} tone="ok" />
          </div>
        </div>
      </div>
    </section>
  );
}
