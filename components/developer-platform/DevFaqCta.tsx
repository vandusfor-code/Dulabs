"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { START_HREF, DOCS_HREF } from "./constants";

// DuLabs Developer V1 -- Fase 15. FAQ específico de Developer + CTA final.
// Preguntas reales del producto; sin inventar capacidades. FAQ como
// <details>/<summary> (accesible, sin JS).

export function DevFaq() {
  const { t } = useI18n();
  const faqs = [
    {
      q: t("¿Qué es DuLabs Developer?", "What is DuLabs Developer?"),
      a: t(
        "Una plataforma CPaaS: una API para enviar mensajes por WhatsApp Cloud API, recibir eventos por webhook y observar cada entrega, con API keys, workspaces, idempotencia y rate limits.",
        "A CPaaS platform: an API to send WhatsApp Cloud API messages, receive events via webhooks and observe every delivery, with API keys, workspaces, idempotency and rate limits.",
      ),
    },
    {
      q: t("¿Necesito saber programar?", "Do I need to know how to code?"),
      a: t(
        "Para integrar el API sí: es un producto para developers. La documentación tiene ejemplos en cURL y JavaScript/TypeScript listos para copiar.",
        "To integrate the API, yes: it's a product for developers. The docs have copy-paste examples in cURL and JavaScript/TypeScript.",
      ),
    },
    {
      q: t("¿Cómo conecto WhatsApp?", "How do I connect WhatsApp?"),
      a: t(
        "Conectas tu número de WhatsApp Cloud API desde el dashboard y obtienes su id para usarlo en la API. Los detalles están en la documentación.",
        "You connect your WhatsApp Cloud API number from the dashboard and get its id to use in the API. Details are in the docs.",
      ),
    },
    {
      q: t("¿Qué puedo construir sobre DuLabs?", "What can I build on DuLabs?"),
      a: t(
        "DuLabs es infraestructura: sobre ella conectas tu propio producto y construyes agentes de IA, CRMs, automatizaciones, notificaciones y campañas, usando WhatsApp Cloud API oficial de Meta.",
        "DuLabs is infrastructure: on top of it you connect your own product and build AI agents, CRMs, automations, notifications and campaigns, using Meta's official WhatsApp Cloud API.",
      ),
    },
    {
      q: t("¿Funciona en modo Coexistencia?", "Does it work in Coexistence mode?"),
      a: t(
        "Sí, cuando la configuración de WhatsApp/Meta lo permite: tu equipo sigue atendiendo desde la app de WhatsApp y, sobre el mismo número, conectas API, webhooks y agentes. Las capacidades dependen de esa configuración.",
        "Yes, when the WhatsApp/Meta configuration allows it: your team keeps replying from the WhatsApp app while, on the same number, you connect API, webhooks and agents. Capabilities depend on that configuration.",
      ),
    },
    {
      q: t("¿Cómo funcionan los webhooks?", "How do webhooks work?"),
      a: t(
        "Enviamos cada evento entrante y de estado a tu endpoint, firmado con HMAC-SHA256, con timestamp y Event-ID. Verificas la firma y deduplicas por Event-ID; hay reintentos con backoff y DLQ.",
        "We send each inbound and status event to your endpoint, signed with HMAC-SHA256, with a timestamp and Event-ID. You verify the signature and dedup by Event-ID; there are backoff retries and a DLQ.",
      ),
    },
    {
      q: t("¿Qué incluye cada plan?", "What's included in each plan?"),
      a: t(
        "Cada plan define mensajes mensuales incluidos, números, workspaces y miembros. Los valores exactos se muestran arriba, en Pricing, tomados directamente del catálogo.",
        "Each plan defines included monthly messages, numbers, workspaces and members. Exact values are shown above in Pricing, taken directly from the catalog.",
      ),
    },
    {
      q: t("¿Puedo usar mi propia API key?", "Can I use my own API key?"),
      a: t(
        "Generas tus API keys (dl_live_…) desde el dashboard, por workspace, y puedes rotarlas o revocarlas cuando quieras.",
        "You generate your own API keys (dl_live_…) from the dashboard, per workspace, and can rotate or revoke them anytime.",
      ),
    },
    {
      q: t("¿Puedo cambiar de plan?", "Can I change plans?"),
      a: t(
        "Sí, cambias de plan desde el dashboard. El pago se procesa dentro del panel, no en esta página.",
        "Yes, you change plans from the dashboard. Payment is handled inside the panel, not on this page.",
      ),
    },
    {
      q: t("¿Hay documentación?", "Is there documentation?"),
      a: t(
        "Sí: quickstart, autenticación, mensajes, webhooks, rate limits, errores y la referencia completa del API.",
        "Yes: quickstart, authentication, messages, webhooks, rate limits, errors and the full API reference.",
      ),
    },
    {
      q: t("¿Enterprise cómo funciona?", "How does Enterprise work?"),
      a: t(
        "Enterprise es de contratación asistida por ventas: escríbenos con el botón «Contactar ventas» y definimos límites y condiciones.",
        "Enterprise is sales-assisted: reach out via the “Contact sales” button and we define limits and terms together.",
      ),
    },
  ];
  return (
    <section className="border-t border-site-border py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-6">
        <p className="text-center font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-dev-accent">FAQ</p>
        <h2 className="mt-4 text-center font-display text-[28px] font-medium leading-[1.1] tracking-[-0.02em] text-site-fg md:text-[34px]">
          {t("Preguntas frecuentes", "Frequently asked questions")}
        </h2>
        <div className="mt-10 divide-y divide-site-border border-y border-site-border">
          {faqs.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-site-fg">
                {f.q}
                <span className="flex-none text-site-muted-fg transition-transform group-open:rotate-45" aria-hidden>+</span>
              </summary>
              <p className="mt-3 text-[14.5px] leading-relaxed text-site-muted-fg">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function DevFinalCta() {
  const { t } = useI18n();
  return (
    <section className="border-t border-site-border py-24 md:py-32">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="relative overflow-hidden rounded-3xl border border-site-border bg-site-card px-8 py-16 text-center md:py-20">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_50%_0%,var(--color-dev-accent-soft),transparent)]" aria-hidden />
          <h2 className="mx-auto max-w-2xl font-display text-[30px] font-medium leading-[1.08] tracking-[-0.02em] text-site-fg md:text-[44px]">
            {t("Construye tu integración sobre DuLabs.", "Build your integration on DuLabs.")}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-site-muted-fg">
            {t("Crea tu workspace, genera una API key y envía tu primer mensaje hoy.", "Create your workspace, generate an API key and send your first message today.")}
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href={START_HREF} className="inline-flex items-center gap-2 rounded-lg bg-dev-accent px-6 py-3 text-[14px] font-medium text-dev-accent-fg transition-colors hover:bg-dev-accent-hover">
              {t("Comenzar", "Get started")}
              <span aria-hidden>→</span>
            </Link>
            <Link href={DOCS_HREF} className="inline-flex items-center gap-2 rounded-lg border border-site-border bg-site-bg px-6 py-3 text-[14px] font-medium text-site-fg transition-colors hover:border-dev-accent/40">
              {t("Ver documentación", "View docs")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
