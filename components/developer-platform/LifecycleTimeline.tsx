"use client";

import { useI18n } from "@/lib/i18n";
import { estadoNodo } from "./motion";

// DuLabs Developer -- ciclo de vida de UN mensaje. El mismo request de la consola recorre request -> created -> queued -> processing ->
// sent -> delivered: el estado actual pulsa y muestra su tiempo; los anteriores quedan confirmados (sin actividad); los siguientes,
// inactivos. `actual` lo decide la secuencia del bloque (DevApi). Los tiempos son ilustrativos y así se rotulan.

export function LifecycleTimeline({ actual }: { actual: number }) {
  const { t } = useI18n();
  const fases: { k: string; via: string; d: string; tiempo: string; tono?: "ok" }[] = [
    { k: "request", via: "POST /messages", d: t("API key + Idempotency-Key", "API key + Idempotency-Key"), tiempo: "t0" },
    { k: "created", via: "201", d: t("aceptado, con jobId", "accepted, with a jobId"), tiempo: "+3 ms" },
    { k: "queued", via: "GET /messages/{id}", d: t("en cola para un worker", "queued for a worker"), tiempo: "+8 ms" },
    { k: "processing", via: "GET /messages/{id}", d: t("un worker lo está enviando", "a worker is sending it"), tiempo: "+240 ms" },
    { k: "sent", via: "GET /messages/{id}", d: t("entregado a WhatsApp Cloud API", "handed off to WhatsApp Cloud API"), tiempo: "+0.9 s" },
    { k: "delivered", via: "webhook · message.status", d: t("confirmado por WhatsApp, firmado a tu endpoint", "confirmed by WhatsApp, signed to your endpoint"), tiempo: "+1.2 s", tono: "ok" },
  ];

  return (
    <div className="dp-revela">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dp-muted">{t("Ciclo de vida", "Lifecycle")}</p>
        <p className="font-mono text-[10.5px] text-dp-muted">{t("tiempos ilustrativos", "illustrative timings")}</p>
      </div>
      <ol className="mt-5" aria-label={t("Estados de un mensaje", "Message states")}>
        {fases.map((f, i) => {
          const estado = estadoNodo(i, actual);
          return (
            <li
              key={f.k}
              data-estado={estado}
              {...(f.tono && estado !== "pendiente" ? { "data-tono": f.tono } : {})}
              aria-current={estado === "activo" ? "step" : undefined}
              className="dp-fase relative grid grid-cols-[9px_1fr_auto] gap-x-4 pb-4 last:pb-0"
            >
              {i < fases.length - 1 ? (
                <span aria-hidden className="absolute bottom-0 left-[4px] top-[15px] w-px bg-dp-border">
                  <span className="dp-recorrido-y absolute inset-0 bg-dp-text-2" style={{ transform: `scaleY(${i < actual ? 1 : 0})` }} />
                </span>
              ) : null}
              <span className="dp-nodo-punto mt-[5px]" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-3 font-mono text-[13px]">
                  <span className="dp-nodo-nombre">{f.k}</span>
                  <span className="text-[11px] text-dp-muted">{f.via}</span>
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-dp-text-2">{f.d}</p>
              </div>
              <span className="dp-chip pt-0.5 font-mono text-[11px] tabular-nums">{f.tiempo}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-5 border-t border-dp-border pt-4 text-[12.5px] leading-relaxed text-dp-muted">
        {t(
          "GET /messages/{id} reporta queued, processing, sent o failed. delivered y read llegan por el webhook message.status.",
          "GET /messages/{id} reports queued, processing, sent or failed. delivered and read arrive through the message.status webhook.",
        )}
      </p>
    </div>
  );
}
