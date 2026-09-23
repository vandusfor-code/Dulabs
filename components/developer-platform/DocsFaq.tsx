"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { DOCS_HREF, SECTION_IDS } from "./constants";
import { EnlaceFlecha, Encabezado } from "./ui";

// DuLabs Developer -- documentación (Build -> Read -> Ship) y 4 preguntas frecuentes. La landing no se convierte en documentación: cada
// entrada lleva a su guía, y el resto de preguntas vive en /developers. El acordeón es accesible (button + aria-expanded + región) y su
// única animación es la altura (grid-rows 0fr -> 1fr) y el contenido (opacity).

function DocsGrid() {
  const { t } = useI18n();
  const grupos = [
    {
      k: "Build",
      items: [
        { k: "Quickstart", d: t("Tu primer mensaje", "Your first message"), href: DOCS_HREF },
        { k: "Authentication", d: t("API keys y Bearer", "API keys and Bearer"), href: `${DOCS_HREF}/authentication` },
      ],
    },
    {
      k: "Read",
      items: [
        { k: "Messages", d: t("Envío y estado", "Send and status"), href: `${DOCS_HREF}/messages` },
        { k: "Webhooks", d: t("Eventos y firma", "Events and signature"), href: `${DOCS_HREF}/webhooks` },
        { k: "API Reference", d: "OpenAPI 3.1", href: `${DOCS_HREF}/reference` },
      ],
    },
    {
      k: "Ship",
      items: [
        { k: "Rate limits", d: t("Límites y 429", "Limits and 429"), href: `${DOCS_HREF}/rate-limits` },
        { k: "Errors", d: t("Códigos y request_id", "Codes and request_id"), href: `${DOCS_HREF}/errors` },
      ],
    },
  ];
  return (
    <div className="grid gap-8 sm:grid-cols-3 sm:gap-6">
      {grupos.map((g) => (
        <div key={g.k}>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dp-muted">{g.k}</p>
          <ul className="mt-3 border-t border-dp-border">
            {g.items.map((d) => (
              <li key={d.k}>
                <Link href={d.href} className="dp-btn dp-link group flex items-center justify-between gap-3 border-b border-dp-border py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium text-dp-text">{d.k}</span>
                    <span className="block truncate text-[12.5px] text-dp-muted group-hover:text-dp-text-2">{d.d}</span>
                  </span>
                  <span aria-hidden className="dp-flecha text-dp-muted group-hover:text-dp-text">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Faq() {
  const { t } = useI18n();
  const [abierta, setAbierta] = useState<number | null>(null);
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
        "DuLabs reintenta con backoff hasta 5 intentos. Si sigue fallando, el evento queda en la DLQ y puedes reenviarlo desde el dashboard.",
        "DuLabs retries with backoff for up to 5 attempts. If it keeps failing, the event goes to the DLQ and you can replay it from the dashboard.",
      ),
    },
    {
      q: t("¿Funciona en modo Coexistencia?", "Does it work in Coexistence mode?"),
      a: t(
        "Sí, cuando la configuración de WhatsApp/Meta lo permite: tu equipo sigue en la app de WhatsApp y, sobre el mismo número, conectas API y webhooks.",
        "Yes, when the WhatsApp/Meta configuration allows it: your team stays on the WhatsApp app and, on the same number, you connect API and webhooks.",
      ),
    },
  ];
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dp-muted">{t("Preguntas", "Questions")}</p>
      <ul className="mt-3 border-t border-dp-border">
        {faqs.map((f, i) => {
          const abierto = abierta === i;
          return (
            <li key={f.q} {...(abierto ? { "data-abierto": "" } : {})} className="border-b border-dp-border">
              <h3>
                <button
                  type="button"
                  id={`dp-faq-q${i}`}
                  aria-expanded={abierto}
                  aria-controls={`dp-faq-a${i}`}
                  onClick={() => setAbierta(abierto ? null : i)}
                  className="dp-link flex w-full items-center justify-between gap-4 py-3.5 text-left text-[14.5px] font-medium text-dp-text hover:text-white"
                >
                  {f.q}
                  <span aria-hidden className="dp-faq-signo flex-none font-mono text-dp-muted">
                    +
                  </span>
                </button>
              </h3>
              <div id={`dp-faq-a${i}`} role="region" aria-labelledby={`dp-faq-q${i}`} className="dp-faq-cuerpo" {...(abierto ? {} : { inert: true })}>
                <div>
                  <p className="max-w-[62ch] pb-4 text-[14px] leading-relaxed text-dp-text-2">{f.a}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4">
        <EnlaceFlecha href={DOCS_HREF}>{t("Más respuestas en la documentación", "More answers in the docs")}</EnlaceFlecha>
      </div>
    </div>
  );
}

export function DocsFaq() {
  const { t } = useI18n();
  return (
    <section id={SECTION_IDS.docs} className="scroll-mt-14 border-t border-dp-border py-14 md:py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado indice="08" etiqueta="Docs" titulo={t("Documentación con ejemplos que funcionan.", "Docs with examples that work.")} />
        <div className="mt-10 grid gap-12 md:mt-12 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-7">
            <DocsGrid />
          </div>
          <div className="lg:col-span-5">
            <Faq />
          </div>
        </div>
      </div>
    </section>
  );
}
