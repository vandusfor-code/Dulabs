"use client";

import { useI18n } from "@/lib/i18n";
import { hexDe } from "./motion";
import { PASO_ENTREGA, claseTono, entregaDe, escenarioDe, eventoDe, horaDe } from "./webhooks-guion";

// DuLabs Developer -- stream de eventos (consola viva) y el inspector de la entrega en curso. No hay un ticker aparte: cada fila nueva
// ES la entrega que acaba de hacer el WebhookFlow de al lado (una por vuelta, cada ~6 s), y su estado cambia en su sitio (503 ->
// retry -> 200, o -> DLQ). Colores solo de estado: 200 verde apagado, reintento ámbar, fallo/DLQ rojo apagado.

const FILAS = 6;
const ALTO_FILA = 36;

export function eventIdDe(k: number) {
  return `${hexDe(k + 400, 8)}-…-${hexDe(k + 800, 4)}`;
}

/** "503 · retry 2/5": solo el código lleva color de estado; el resto queda en gris (sin convertir la consola en un semáforo). */
function EntregaTexto({ texto, clase, animar }: { texto: string; clase: string; animar: boolean }) {
  const [codigo, ...resto] = texto.split(" · ");
  return (
    <span className={`text-right tabular-nums ${animar ? "dp-cruce" : ""}`}>
      <span className={clase}>{codigo}</span>
      {resto.length ? <span className="text-dp-muted"> · {resto.join(" · ")}</span> : null}
    </span>
  );
}

export function EventStream({ paso, vuelta }: { paso: number; vuelta: number }) {
  const { t } = useI18n();
  // La vuelta en curso solo aparece cuando su evento llega al endpoint (PASO_ENTREGA); las anteriores ya están resueltas.
  const tope = paso >= PASO_ENTREGA ? vuelta : vuelta - 1;
  const filas = Array.from({ length: FILAS }, (_, j) => tope - j);

  return (
    <div className="dp-panel dp-revela min-w-0 overflow-hidden rounded-dp-lg border border-dp-border bg-dp-surface">
      <div className="flex items-center justify-between border-b border-dp-border px-4 py-3">
        <span className="font-mono text-[11.5px] text-dp-text-2">events</span>
        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-dp-muted">
          <span aria-hidden className="dp-senal dp-anim" /> {t("en vivo · ejemplo", "live · example")}
        </span>
      </div>
      <div className="grid grid-cols-[62px_1fr_auto] gap-x-3 border-b border-dp-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dp-muted sm:grid-cols-[70px_150px_1fr_auto] sm:gap-x-4">
        <span>{t("hora", "time")}</span>
        <span>{t("evento", "event")}</span>
        <span className="hidden sm:block">{t("detalle", "detail")}</span>
        <span className="text-right">{t("entrega", "delivery")}</span>
      </div>
      <div className="overflow-hidden" style={{ height: FILAS * ALTO_FILA }}>
        <ol key={tope} className={tope === vuelta ? "dp-empuja" : undefined} style={{ ["--fila" as string]: `${ALTO_FILA}px` }} aria-label={t("Eventos recientes (ejemplo)", "Recent events (example)")}>
          {filas.map((k) => {
            const ev = eventoDe(k, eventIdDe(k));
            const enCurso = k === vuelta;
            const entrega = entregaDe(escenarioDe(k), enCurso ? paso : null, k);
            return (
              <li
                key={k}
                className={`grid items-center gap-x-3 border-b border-dp-border px-4 font-mono text-[11.5px] sm:gap-x-4 grid-cols-[62px_1fr_auto] sm:grid-cols-[70px_150px_1fr_auto] ${enCurso ? "dp-fila-nueva" : ""}`}
                style={{ height: ALTO_FILA }}
              >
                <span className="tabular-nums text-dp-muted">{horaDe(k)}</span>
                <span className="truncate text-dp-text-2">{ev.tipo}</span>
                <span className="hidden truncate text-dp-text sm:block">{ev.detalle}</span>
                <EntregaTexto key={entrega.texto} texto={entrega.texto} clase={claseTono(entrega.tono)} animar={enCurso} />
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** Inspector de la entrega en curso: cabeceras (la firma se «genera» al pasar por «Firma») y el cuerpo real (snake_case). */
export function DeliveryInspector({ paso, vuelta, firmado }: { paso: number; vuelta: number; firmado: boolean }) {
  const eventId = eventIdDe(vuelta);
  const ev = eventoDe(vuelta, eventId);
  const entrega = entregaDe(escenarioDe(vuelta), paso, vuelta);
  const llego = paso >= PASO_ENTREGA;
  const cabeceras: [string, string, boolean][] = [
    ["X-DuLabs-Signature", `${hexDe(vuelta + 31, 8)}…${hexDe(vuelta + 57, 4)}`, true],
    ["X-DuLabs-Timestamp", String(1712000271 + vuelta * 5), false],
    ["X-DuLabs-Event-ID", eventId, false],
  ];
  return (
    <div className="dp-panel dp-revela min-w-0 overflow-hidden rounded-dp-lg border border-dp-border bg-dp-surface">
      <div className="flex items-center justify-between gap-3 border-b border-dp-border px-4 py-3 font-mono text-[11.5px]">
        <span className="truncate text-dp-text-2">
          POST <span className="text-dp-text">https://api.acme.dev/webhooks/dulabs</span>
        </span>
        <span key={llego ? entrega.codigo : "—"} className={`dp-cruce flex-none tabular-nums ${llego ? claseTono(entrega.tono) : "text-dp-muted"}`}>
          {llego ? entrega.codigo : "—"}
        </span>
      </div>
      <dl className="space-y-1.5 border-b border-dp-border px-4 py-3.5 font-mono text-[11.5px]">
        {cabeceras.map(([k, v, esFirma]) => (
          <div key={k} className="flex min-w-0 gap-x-2">
            <dt className="flex-none text-dp-muted">{k}:</dt>
            <dd className="relative min-w-0 truncate text-dp-text">
              {esFirma ? (
                <span key={vuelta} {...(firmado ? { "data-firmado": "" } : {})} className="dp-firma inline-block text-dp-text">
                  {v}
                </span>
              ) : (
                <span className={firmado ? "text-dp-text" : "text-dp-muted"}>{firmado ? v : "…"}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[11.5px] leading-[1.65] text-dp-text-2">{ev.cuerpo}</pre>
    </div>
  );
}

/** Cómo verificar la firma en tu endpoint (la fórmula real de lib/developer/webhook-signature.ts). */
export function VerificacionFirma() {
  const { t } = useI18n();
  return (
    <div className="border-t border-dp-border pt-4">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dp-muted">{t("Verificación en tu endpoint", "Verification on your endpoint")}</p>
      <p className="mt-2 break-words font-mono text-[11.5px] leading-relaxed text-dp-text-2">
        hmac_sha256(secret, <span className="text-dp-text">timestamp + &quot;.&quot; + body</span>) == X-DuLabs-Signature
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-dp-muted">
        {t("Tolerancia de 5 minutos · deduplica por Event-ID. La firma de esta vista es representada, no calculada en la página.", "5-minute tolerance · dedupe by Event-ID. The signature in this view is depicted, not computed on the page.")}
      </p>
    </div>
  );
}
