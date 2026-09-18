"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { START_HREF, DOCS_HREF } from "./constants";

// DuLabs Developer V1 -- rediseño Resend-level. Hero: el producto es el
// protagonista. Mensaje central: infraestructura oficial de WhatsApp para
// developers. En vez de tarjetas de estado, un request/response REAL de la API
// (mismo contrato que /developers y el gateway) + el ciclo de vida animado.
// Nomenclatura real: POST /api/v1/messages, Bearer dl_live_, Idempotency-Key.

const REQUEST = `curl -X POST https://api.dulabs.co/api/v1/messages \\
  -H "Authorization: Bearer dl_live_9c2f…a1" \\
  -H "Idempotency-Key: 8f2a1c…" \\
  -d '{
    "whatsappNumberId": "wn_01HX8Z…",
    "to": "573000000000",
    "type": "text",
    "text": { "body": "Hola desde DuLabs" }
  }'`;

const LIFECYCLE = ["created", "queued", "sent", "delivered"];

export function DevHero() {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden pt-28 pb-16 md:pt-36 md:pb-24">
      <div className="mx-auto grid max-w-[1440px] items-center gap-14 px-6 lg:grid-cols-[1fr_1.05fr]">
        {/* Mensaje */}
        <div className="max-w-xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-site-border bg-site-card px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-site-muted-fg">
            <span className="dev-live-dot h-1.5 w-1.5 rounded-full bg-site-fg" />
            {t("Infraestructura de WhatsApp para developers", "WhatsApp infrastructure for developers")}
          </p>
          <h1 className="mt-6 font-display text-[38px] font-medium leading-[1.05] tracking-[-0.03em] text-site-fg md:text-[56px]">
            {t("Construye sobre WhatsApp sin construir la infraestructura.", "Build on WhatsApp without building the infrastructure.")}
          </h1>
          <p className="mt-6 text-[16px] leading-relaxed text-site-muted-fg md:text-[17px]">
            {t(
              "Una sola API sobre WhatsApp Cloud API oficial de Meta: envía mensajes, recibe eventos por webhook y observa cada entrega. API keys, workspaces, idempotencia, rate limits y firma de webhooks incluidos desde el día uno.",
              "One API on top of Meta's official WhatsApp Cloud API: send messages, receive events via webhooks and observe every delivery. API keys, workspaces, idempotency, rate limits and webhook signing built in from day one.",
            )}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href={START_HREF}
              className="inline-flex items-center gap-2 rounded-lg bg-dev-accent px-5 py-3 text-[14px] font-medium text-dev-accent-fg transition-colors hover:bg-dev-accent-hover"
            >
              {t("Get API Key", "Get API Key")}
              <span aria-hidden>→</span>
            </Link>
            <Link
              href={DOCS_HREF}
              className="inline-flex items-center gap-2 rounded-lg border border-site-border bg-site-card px-5 py-3 text-[14px] font-medium text-site-fg transition-colors hover:border-white/25"
            >
              {t("Ver documentación", "View docs")}
            </Link>
          </div>
          <p className="mt-5 font-mono text-[11.5px] text-site-muted-fg">
            {t("Empieza gratis en el dashboard · sin tarjeta para explorar", "Start in the dashboard · no card to explore")}
          </p>
        </div>

        {/* Producto: request real -> response -> ciclo de vida animado */}
        <div className="relative">
          <div className="overflow-hidden rounded-2xl border border-site-border bg-site-card">
            <div className="flex items-center gap-2 border-b border-site-border px-3.5 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-site-border" />
              <span className="h-2.5 w-2.5 rounded-full bg-site-border" />
              <span className="h-2.5 w-2.5 rounded-full bg-site-border" />
              <span className="ml-2 font-mono text-[11px] text-site-muted-fg">POST /api/v1/messages</span>
              <span className="ml-auto rounded-full border border-site-border px-2 py-0.5 font-mono text-[10px] text-site-muted-fg">Bearer dl_live_</span>
            </div>
            <pre className="overflow-x-auto bg-site-bg px-4 py-4 font-mono text-[11.5px] leading-relaxed text-site-fg"><code>{REQUEST}<span className="dev-caret text-site-muted-fg" aria-hidden>▍</span></code></pre>
            <div className="border-t border-site-border px-4 py-3.5">
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="rounded border border-site-border px-1.5 py-0.5 text-site-fg">201</span>
                <span className="text-site-muted-fg">Created · 142 ms</span>
              </div>
              <pre className="mt-2 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-site-fg"><code>{`{ "jobId": "job_01HX8Z…", "status": "created" }`}</code></pre>
            </div>
            <div className="flex items-center gap-1.5 border-t border-site-border px-4 py-3 font-mono text-[11px]">
              {LIFECYCLE.map((s, i) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span
                    className={`dev-step ${i === LIFECYCLE.length - 1 ? "text-site-fg" : "text-site-muted-fg"}`}
                    style={{ ["--dev-i" as string]: i }}
                  >
                    {s}
                  </span>
                  {i < LIFECYCLE.length - 1 ? <span className="text-site-border" aria-hidden>→</span> : null}
                </span>
              ))}
              <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-site-muted-fg">
                <span className="dev-live-dot h-1.5 w-1.5 rounded-full bg-site-fg" /> webhook
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
