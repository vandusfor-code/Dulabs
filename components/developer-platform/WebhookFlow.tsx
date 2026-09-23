"use client";

import { useI18n } from "@/lib/i18n";
import { estadoNodo } from "./motion";
import { PASO_ENTREGA, PASO_REINICIO, PASO_REPOSO, entregaDe, type Escenario, type Tono } from "./webhooks-guion";

// DuLabs Developer -- el camino de vuelta: de WhatsApp a tu endpoint. El evento viaja Meta -> DuLabs (verifica la firma de Meta) ->
// normaliza -> deduplica -> firma -> tu endpoint, y en el endpoint el resultado tiene significado: 200, o 503 -> reintento con backoff,
// o 5/5 intentos -> DLQ. Cada paso existe en el producto (inbound-event-mapper, UNIQUE(event_id), webhook-signature, events-store).
// El paso y el escenario los decide el bloque (DevWebhooks): este componente solo los dibuja.

export function WebhookFlow({ paso, escenario, vuelta }: { paso: number; escenario: Escenario; vuelta: number }) {
  const { t } = useI18n();
  const entrega = entregaDe(escenario, paso, vuelta);
  const tonoEndpoint: Tono = paso < PASO_ENTREGA ? "neutro" : entrega.tono;
  const chipEndpoint = paso < PASO_ENTREGA ? "" : escenario === "ok" || entrega.codigo === "200" ? `${entrega.codigo} OK` : entrega.texto.replace("DLQ · 5/5", "DLQ");

  const nodos = [
    { k: "WhatsApp · Meta", sub: t("mensaje entrante o estado", "inbound message or status"), chip: "WEBHOOK" },
    { k: "DuLabs", sub: t("verifica la firma de Meta", "verifies Meta's signature"), chip: "VERIFIED" },
    { k: t("Normaliza", "Normalize"), sub: t("payload estable · snake_case", "stable payload · snake_case"), chip: "NORMALIZED" },
    { k: t("Deduplica", "Deduplicate"), sub: t("event_id único", "unique event_id"), chip: "UNIQUE" },
    { k: t("Firma", "Sign"), sub: "HMAC-SHA256 · timestamp.body", chip: "SIGNED" },
    { k: t("Tu endpoint", "Your endpoint"), sub: t("POST a tu URL", "POST to your URL"), chip: chipEndpoint },
  ];

  const reinicio = paso === PASO_REINICIO;
  const actual = reinicio ? -1 : Math.min(paso, PASO_REPOSO === paso ? 6 : 5);
  const pos = reinicio ? 0 : Math.min(paso, 5);
  const visible = paso < PASO_REPOSO;
  const progreso = reinicio ? 0 : Math.min(paso, 5) / 5;

  const resumen =
    escenario === "ok"
      ? t("Entregado al primer intento.", "Delivered on the first attempt.")
      : escenario === "retry"
        ? t("503 → reintento con backoff (+30 s) → 200 en el intento 2 de 5.", "503 → retry with backoff (+30 s) → 200 on attempt 2 of 5.")
        : t("5 intentos fallidos (backoff 30 s → 240 s) → DLQ, reenviable desde el dashboard.", "5 failed attempts (backoff 30 s → 240 s) → DLQ, replayable from the dashboard.");

  return (
    <figure data-viaje="" {...(reinicio ? { "data-reinicio": "" } : {})} className="dp-flujo dp-revela" aria-labelledby="dp-vuelta-titulo">
      <figcaption id="dp-vuelta-titulo" className="mb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-dp-muted">
        {t("De WhatsApp a tu endpoint", "From WhatsApp to your endpoint")}
      </figcaption>
      <div className="relative">
        <div aria-hidden className="absolute left-[4px] w-px bg-dp-border" style={{ top: 28, bottom: 28 }}>
          <div className="dp-recorrido-y absolute inset-0 bg-dp-text-2" style={{ transform: `scaleY(${progreso})` }} />
          <div className="dp-paquete-y" style={{ transform: `translateY(${pos * 20}%)`, opacity: visible ? 1 : 0 }}>
            <span className="dp-paquete-punto absolute left-0 top-0 block h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-dp-signal" />
          </div>
        </div>
        <ol className="border-y border-dp-border">
          {nodos.map((n, i) => {
            const esEndpoint = i === 5;
            const tono = esEndpoint && tonoEndpoint !== "neutro" ? { "data-tono": tonoEndpoint } : {};
            return (
              <li key={i} data-estado={estadoNodo(i, actual)} {...tono} className={`flex h-14 items-center gap-4 ${i > 0 ? "border-t border-dp-border" : ""}`}>
                <span className="dp-nodo-punto flex-none" />
                <span className="min-w-0 flex-1">
                  <span className="dp-nodo-nombre block truncate font-mono text-[13px]">{n.k}</span>
                  <span className="block truncate font-mono text-[10.5px] text-dp-muted">{n.sub}</span>
                </span>
                <span key={esEndpoint ? n.chip : undefined} className={`dp-chip flex-none font-mono text-[10.5px] uppercase tracking-[0.1em] ${esEndpoint && n.chip ? "dp-cruce" : ""}`}>
                  {n.chip}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-4 min-h-[2.6em] text-[12.5px] leading-relaxed text-dp-text-2" aria-live="off">
        {paso >= PASO_ENTREGA && !reinicio ? resumen : " "}
      </p>
    </figure>
  );
}
