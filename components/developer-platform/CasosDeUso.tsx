"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { SECTION_IDS } from "./constants";
import { useBloque, useSecuencia } from "./motion";
import { Encabezado, NotaEjemplo } from "./ui";

// DuLabs Developer -- casos de uso: seis productos concretos que se construyen sobre la API y los webhooks, cada uno con una
// microvisualización (sin imágenes, sin ilustraciones, sin iconos). Una sola secuencia de 4 pasos mueve las seis a la vez, solo con el
// bloque en pantalla; con reduced motion, todas en su estado final. Datos de ejemplo.

const PASOS = [1300, 1300, 1300, 2200] as const;
// Envíos masivos (demo): la barra se calcula de las mismas cifras que se muestran.
const TOTAL = 1248;
const ENTREGADOS = [118, 520, 968, 1183];

function Mini({ children }: { children: ReactNode }) {
  return <div className="mt-5 h-[88px] overflow-hidden rounded-dp border border-dp-border bg-dp-bg/60 p-2.5 font-mono text-[10.5px]">{children}</div>;
}

function aparece(visible: boolean) {
  return `transition-[opacity,transform] duration-300 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`;
}

export function CasosDeUso() {
  const { t } = useI18n();
  const { ref, activo, atributos } = useBloque<HTMLElement>({ umbral: 0.25 });
  const { paso } = useSecuencia(PASOS, { activo });

  const casos: { k: string; d: string; mini: ReactNode }[] = [
    {
      k: t("Agente de ventas con IA", "AI sales agent"),
      d: t("Atiende leads, los califica y deriva la conversación a tu equipo.", "Answers leads, qualifies them and hands the conversation to your team."),
      mini: (
        <Mini>
          <p className="ml-auto w-fit rounded-[5px] bg-white/[0.07] px-2 py-1 text-dp-text">{t("¿Precio del plan Pro?", "Pro plan pricing?")}</p>
          <p className={`mt-1.5 w-fit rounded-[5px] border border-dp-border px-2 py-1 text-dp-text-2 ${aparece(paso >= 1)}`}>
            {paso >= 2 ? t("Te lo envío. ¿Para cuántas personas?", "Sending it. For how many people?") : "···"}
          </p>
          <p className={`mt-1.5 text-dp-ok ${aparece(paso >= 3)}`}>lead · {t("calificado → ventas", "qualified → sales")}</p>
        </Mini>
      ),
    },
    {
      k: t("Recordatorios", "Reminders"),
      d: t("Mensajes automáticos por WhatsApp antes de cada cita o vencimiento.", "Automatic WhatsApp messages before every appointment or due date."),
      mini: (
        <Mini>
          <div className="flex justify-between text-dp-muted">
            <span>appointment.created</span>
            <span>−24 h</span>
          </div>
          <div aria-hidden className="relative mt-2 h-px bg-dp-border-strong">
            <div className="absolute inset-0 origin-left bg-dp-signal transition-transform duration-1000 ease-out" style={{ transform: `scaleX(${paso >= 1 ? 1 : 0})` }} />
          </div>
          <p className={`mt-2.5 text-dp-text-2 ${aparece(paso >= 2)}`}>
            {t("«Mañana 10:00, te esperamos»", "“Tomorrow 10:00, see you”")} <span className={paso >= 3 ? "text-dp-ok" : "text-dp-muted"}>{paso >= 3 ? "delivered" : "sent"}</span>
          </p>
        </Mini>
      ),
    },
    {
      k: t("Envíos masivos", "Bulk messaging"),
      d: t("Campañas y comunicaciones gestionadas por la cola y sus límites.", "Campaigns and communications managed by the queue and its limits."),
      mini: (
        <Mini>
          <div className="flex justify-between text-dp-muted">
            <span>spring-promo</span>
            <span>{t("demo", "demo")}</span>
          </div>
          <div aria-hidden className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full origin-left bg-dp-text-2 transition-transform duration-700" style={{ transform: `scaleX(${ENTREGADOS[paso]! / TOTAL})` }} />
          </div>
          <p className="mt-2.5 tabular-nums text-dp-text-2">
            <span className="text-dp-ok">{ENTREGADOS[paso]!.toLocaleString("en-US")}</span> / {TOTAL.toLocaleString("en-US")} delivered
          </p>
        </Mini>
      ),
    },
    {
      k: t("Citas", "Appointments"),
      d: t("Agendamiento y confirmaciones automatizadas en la misma conversación.", "Booking and automated confirmations in the same conversation."),
      mini: (
        <Mini>
          <p className="w-fit rounded-[5px] border border-dp-border px-2 py-1 text-dp-text-2">{t("¿Confirmas jue 10:00?", "Confirm Thu 10:00?")}</p>
          <p className={`ml-auto mt-1.5 w-fit rounded-[5px] bg-white/[0.07] px-2 py-1 text-dp-text ${aparece(paso >= 1)}`}>{t("Sí", "Yes")}</p>
          <p className={`mt-1.5 ${aparece(paso >= 2)} ${paso >= 3 ? "text-dp-ok" : "text-dp-signal"}`}>appointment · {paso >= 3 ? "confirmed ✓" : "updating…"}</p>
        </Mini>
      ),
    },
    {
      k: t("CRM propio", "Custom CRM"),
      d: t("Tu propia interfaz de conversaciones y contactos sobre la API.", "Your own conversations and contacts UI on top of the API."),
      mini: (
        <Mini>
          {[
            ["Ana R.", t("¿Tienen envío?", "Do you ship?"), t("nuevo", "new")],
            ["Luis M.", t("¡Gracias!", "Thanks!"), t("resuelto", "resolved")],
            ["Sofía P.", t("Pago listo", "Paid"), t("resuelto", "resolved")],
          ]
            .slice(paso >= 1 ? 0 : 1)
            .map(([n, m, e], j) => (
              <p key={n} className={`flex gap-2 ${j === 0 && paso >= 1 ? "dp-cruce" : ""}`}>
                <span className="w-14 flex-none text-dp-text">{n}</span>
                <span className="min-w-0 flex-1 truncate text-dp-muted">{m}</span>
                <span className={j === 0 && paso >= 1 ? "text-dp-signal" : "text-dp-muted"}>{e}</span>
              </p>
            ))}
        </Mini>
      ),
    },
    {
      k: t("Automatización", "Automation"),
      d: t("Conecta eventos, reglas y acciones con tu backend.", "Connect events, rules and actions with your backend."),
      mini: (
        <Mini>
          <div className="flex h-full items-center justify-between gap-1.5">
            {["lead.created", "rule", "send", "webhook"].map((k, j) => (
              <span key={k} className="flex min-w-0 items-center gap-1.5">
                <span
                  className={`truncate rounded-[4px] border px-1.5 py-1 transition-colors duration-300 ${j === paso ? "border-dp-signal/60 text-dp-signal" : j < paso ? "border-dp-border text-dp-text" : "border-dp-border text-dp-muted"}`}
                >
                  {k}
                </span>
                {j < 3 ? <span aria-hidden className="text-dp-muted">→</span> : null}
              </span>
            ))}
          </div>
        </Mini>
      ),
    },
  ];

  return (
    <section ref={ref} {...atributos} id={SECTION_IDS.casos} className="scroll-mt-14 border-t border-dp-border py-14 md:py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado
          indice="05"
          etiqueta={t("Casos de uso", "Use cases")}
          titulo={t("Productos que construyes encima.", "Products you build on top.")}
          apoyo={t(
            "Ejemplos concretos sobre la misma API y los mismos webhooks. El producto es tuyo; la infraestructura, nuestra.",
            "Concrete examples on the same API and the same webhooks. The product is yours; the infrastructure is ours.",
          )}
        />
        <ul className="dp-revela -mx-6 mt-10 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 md:mt-12 lg:grid-cols-3">
          {casos.map((c) => (
            <li key={c.k} className="dp-panel w-[82%] flex-none snap-start rounded-dp-lg border border-dp-border bg-dp-surface p-5 sm:w-auto">
              <h3 className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-dp-text">{c.k}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-dp-text-2">{c.d}</p>
              {c.mini}
            </li>
          ))}
        </ul>
        <div className="mt-5">
          <NotaEjemplo>{t("Datos de ejemplo · cada caso usa POST /v1/messages y los webhooks message.received / message.status", "Demo data · every case uses POST /v1/messages and the message.received / message.status webhooks")}</NotaEjemplo>
        </div>
      </div>
    </section>
  );
}
