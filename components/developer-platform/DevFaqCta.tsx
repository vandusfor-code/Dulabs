"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { START_HREF, DOCS_HREF, API_HOST } from "./constants";
import { BotonPrimario, BotonSecundario } from "./ui";

// DuLabs Developer -- cierre de la landing. DevDocsFaq vive DENTRO del bloque de pricing (Build -> Read -> Ship + las preguntas que de
// verdad frenan una integración); DevFinalCta es el cierre developer-first. FAQ con <details>/<summary>: accesible y sin JS.

export function DevDocsFaq() {
  const { t } = useI18n();
  const docs = [
    { k: "Quickstart", d: t("Tu primer mensaje", "Your first message"), href: DOCS_HREF },
    { k: "Authentication", d: t("API keys y Bearer", "API keys and Bearer"), href: `${DOCS_HREF}/authentication` },
    { k: "Messages", d: t("Envío y estado", "Send and status"), href: `${DOCS_HREF}/messages` },
    { k: "Webhooks", d: t("Eventos y firma", "Events and signature"), href: `${DOCS_HREF}/webhooks` },
    { k: "Rate limits", d: t("Límites y 429", "Limits and 429"), href: `${DOCS_HREF}/rate-limits` },
    { k: "Errors", d: t("Códigos y request_id", "Codes and request_id"), href: `${DOCS_HREF}/errors` },
    { k: "API Reference", d: "OpenAPI 3.1", href: `${DOCS_HREF}/reference` },
  ];
  const faqs = [
    {
      q: t("¿Qué es DuLabs Developer?", "What is DuLabs Developer?"),
      a: t(
        "Infraestructura CPaaS sobre WhatsApp Cloud API oficial de Meta: una API para enviar mensajes, webhooks firmados para recibir eventos y un dashboard para operar cada entrega.",
        "CPaaS infrastructure on Meta's official WhatsApp Cloud API: an API to send messages, signed webhooks to receive events and a dashboard to operate every delivery.",
      ),
    },
    {
      q: t("¿Cómo conecto mi número de WhatsApp?", "How do I connect my WhatsApp number?"),
      a: t(
        "Desde el dashboard conectas tu número de WhatsApp Cloud API y obtienes su whatsappNumberId para usarlo en la API.",
        "From the dashboard you connect your WhatsApp Cloud API number and get its whatsappNumberId to use in the API.",
      ),
    },
    {
      q: t("¿Qué pasa si mi endpoint no responde?", "What if my endpoint doesn't respond?"),
      a: t(
        "DuLabs reintenta con backoff hasta 5 veces. Si sigue fallando, el evento queda en la DLQ y puedes reenviarlo desde el dashboard.",
        "DuLabs retries with backoff up to 5 times. If it keeps failing, the event goes to the DLQ and you can replay it from the dashboard.",
      ),
    },
    {
      q: t("¿Funciona en modo Coexistencia?", "Does it work in Coexistence mode?"),
      a: t(
        "Sí, cuando la configuración de WhatsApp/Meta lo permite: tu equipo sigue en la app de WhatsApp y, sobre el mismo número, conectas API y webhooks.",
        "Yes, when the WhatsApp/Meta configuration allows it: your team stays on the WhatsApp app and, on the same number, you connect API and webhooks.",
      ),
    },
    {
      q: t("¿Cómo funciona Enterprise?", "How does Enterprise work?"),
      a: t(
        "Es de contratación asistida: escríbenos desde «Contactar ventas» y definimos límites y condiciones.",
        "It's sales-assisted: reach out via “Contact sales” and we define limits and terms together.",
      ),
    },
  ];
  return (
    <div id="docs" className="mt-20 grid scroll-mt-14 gap-12 border-t border-dp-border pt-10 lg:grid-cols-12 lg:gap-8">
      <div className="lg:col-span-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dp-muted">Build → Read → Ship</p>
        <h3 className="mt-4 text-[22px] font-medium leading-[1.2] tracking-[-0.02em] text-dp-text">{t("Documentación con ejemplos que funcionan.", "Docs with examples that work.")}</h3>
        <ul className="mt-6 border-t border-dp-border">
          {docs.map((d) => (
            <li key={d.k}>
              <Link href={d.href} className="dp-btn dp-link group flex items-center gap-4 border-b border-dp-border py-3 hover:bg-white/[0.02]">
                <span className="w-32 flex-none text-[14px] font-medium text-dp-text">{d.k}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-dp-muted group-hover:text-dp-text-2">{d.d}</span>
                <span aria-hidden className="dp-flecha text-dp-muted group-hover:text-dp-text">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="lg:col-span-6 lg:col-start-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dp-muted">{t("Preguntas", "Questions")}</p>
        <div className="mt-4 border-t border-dp-border">
          {faqs.map((f) => (
            <details key={f.q} className="group border-b border-dp-border">
              <summary className="dp-link flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[14.5px] font-medium text-dp-text hover:text-white [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden className="flex-none font-mono text-dp-muted transition-transform duration-300 group-open:rotate-45">+</span>
              </summary>
              <p className="max-w-[62ch] pb-5 text-[14px] leading-relaxed text-dp-text-2">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DevFinalCta() {
  const { t } = useI18n();
  const pasos = [t("Crea tu workspace", "Create your workspace"), t("Genera una API key", "Generate an API key"), t("Envía tu primer mensaje", "Send your first message")];
  return (
    <section aria-labelledby="dp-cierre" className="border-t border-dp-border">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-6 py-20 md:py-28 lg:grid-cols-12 lg:gap-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dp-muted lg:col-span-3 lg:pt-4">
          <span className="text-dp-text">07</span> <span aria-hidden className="mx-2 inline-block h-px w-6 translate-y-[-3px] bg-dp-border-strong" /> {t("Empieza", "Start")}
        </p>
        <div className="lg:col-span-9">
          <h2 id="dp-cierre" className="text-[40px] font-medium leading-[1] tracking-[-0.045em] text-dp-text md:text-[64px]">
            {t("Construye sobre DuLabs.", "Build on DuLabs.")}
          </h2>
          <ol className="mt-8 flex flex-col gap-2 font-mono text-[13px] text-dp-text-2 md:flex-row md:gap-8">
            {pasos.map((p, i) => (
              <li key={p} className="flex items-center gap-3">
                <span className="text-dp-muted">{String(i + 1).padStart(2, "0")}</span>
                {p}
              </li>
            ))}
          </ol>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <BotonPrimario href={START_HREF}>Get API Key</BotonPrimario>
            <BotonSecundario href={DOCS_HREF}>{t("Leer la documentación", "Read the docs")}</BotonSecundario>
            <span className="font-mono text-[11.5px] text-dp-muted sm:ml-4">{API_HOST}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
