"use client";

import { useI18n } from "@/lib/i18n";
import { DOCS_HREF, SECTION_IDS } from "./constants";
import { useBloque, useSecuencia } from "./motion";
import { WebhookFlow } from "./WebhookFlow";
import { DeliveryInspector, EventStream, VerificacionFirma } from "./EventStream";
import { PASOS_WEBHOOK, PASO_FIRMA, PASO_REINICIO, PASO_REPOSO, escenarioDe } from "./webhooks-guion";
import { EnlaceFlecha, Encabezado, NotaEjemplo } from "./ui";

// DuLabs Developer -- bloque Webhooks y eventos. Una secuencia (un evento por vuelta, ~6 s) mueve las tres piezas a la vez: el evento
// viaja por el WebhookFlow, la firma se genera en el inspector cuando pasa por «Firma», y al llegar al endpoint entra como fila nueva en el
// stream, donde su estado cambia en su sitio (503 -> retry -> 200, o -> DLQ). Todo en pausa fuera de pantalla.

export function DevWebhooks() {
  const { t } = useI18n();
  const { ref, activo, atributos } = useBloque<HTMLElement>({ umbral: 0.2 });
  const { paso, vuelta } = useSecuencia(PASOS_WEBHOOK, { activo, pasoEstatico: PASO_REPOSO });
  const escenario = escenarioDe(vuelta);
  const firmado = paso >= PASO_FIRMA && paso !== PASO_REINICIO;

  return (
    <section ref={ref} {...atributos} id={SECTION_IDS.webhooks} className="scroll-mt-14 border-t border-dp-border py-14 md:py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado
          indice="04"
          etiqueta={t("Webhooks y eventos", "Webhooks & events")}
          titulo={t("Cada evento, firmado y trazable.", "Every event, signed and traceable.")}
          apoyo={t(
            "Los mensajes entrantes y cada cambio de estado llegan a tu endpoint firmados con HMAC-SHA256. Si tu endpoint falla, DuLabs reintenta con backoff hasta completar 5 intentos; después, el evento queda en la cola de fallidos (DLQ) y lo reenvías desde el dashboard.",
            "Inbound messages and every status change reach your endpoint signed with HMAC-SHA256. If your endpoint fails, DuLabs retries with backoff for up to 5 attempts; after that the event lands in the dead-letter queue (DLQ) and you replay it from the dashboard.",
          )}
        />

        <div className="mt-12 grid gap-10 md:mt-14 lg:grid-cols-12 lg:gap-12">
          <div className="flex flex-col gap-6 lg:col-span-5">
            <WebhookFlow paso={paso} escenario={escenario} vuelta={vuelta} />
            <VerificacionFirma />
          </div>
          <div className="grid min-w-0 gap-4 lg:col-span-7">
            <EventStream paso={paso} vuelta={vuelta} />
            <DeliveryInspector paso={paso} vuelta={vuelta} firmado={firmado} />
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <NotaEjemplo>{t("Datos de ejemplo · tipos, cabeceras y política de reintentos reales", "Example data · real event types, headers and retry policy")}</NotaEjemplo>
          <EnlaceFlecha href={`${DOCS_HREF}/webhooks`}>{t("Cómo verificar la firma", "How to verify the signature")}</EnlaceFlecha>
        </div>
      </div>
    </section>
  );
}
