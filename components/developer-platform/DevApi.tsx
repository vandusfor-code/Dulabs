"use client";

import { useI18n } from "@/lib/i18n";
import { API_BASE_URL, DOCS_HREF, SECTION_IDS } from "./constants";
import { useBloque, useSecuencia } from "./motion";
import { ApiConsole, PASOS_API } from "./ApiConsole";
import { LifecycleTimeline } from "./LifecycleTimeline";
import { EnlaceFlecha, Encabezado } from "./ui";

// DuLabs Developer -- bloque API. Una sola secuencia gobierna la consola y el ciclo de vida, porque son el MISMO request:
//   0 imprimir -> 1 enviando (request) -> 2 201 (created) -> 3 queued -> 4 processing -> 5 sent -> 6 delivered, y vuelve a 1 con IDs nuevos.
// Debajo, la superficie pública completa del API (la del OpenAPI): lo que existe, nada más.

export function DevApi() {
  const { t } = useI18n();
  const { ref, activo, visto, atributos } = useBloque<HTMLElement>({ umbral: 0.3 });
  const { paso, vuelta, reiniciar } = useSecuencia(PASOS_API, { activo, bucleDesde: 1, pasoEstatico: 6 });

  const superficie = [
    ["POST", "/messages", t("Enviar un mensaje", "Send a message")],
    ["GET", "/messages/{id}", t("Estado de un mensaje", "Message status")],
    ["GET", "/whatsapp-numbers", t("Números conectados", "Connected numbers")],
    ["GET", "/whatsapp-numbers/{id}", t("Un número", "One number")],
    ["GET", "/webhooks", t("Webhooks configurados", "Configured webhooks")],
    ["POST", "/webhooks", t("Configurar un webhook", "Configure a webhook")],
    ["GET", "/usage", t("Uso del mes", "Monthly usage")],
    ["GET", "/me", t("Verificar la API key", "Verify the API key")],
  ];

  return (
    <section ref={ref} {...atributos} id={SECTION_IDS.api} className="scroll-mt-14 border-t border-dp-border py-14 md:py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado
          indice="03"
          etiqueta="API"
          titulo={t("Un POST inicia una cadena observable.", "One POST starts an observable chain.")}
          apoyo={t(
            "Autenticas con tu API key, envías con una Idempotency-Key y recibes un jobId. Desde ahí, cada estado queda registrado hasta el webhook firmado.",
            "Authenticate with your API key, send with an Idempotency-Key and get a jobId back. From there, every state is recorded up to the signed webhook.",
          )}
        />

        <div className="mt-12 grid gap-10 md:mt-14 lg:grid-cols-12 lg:gap-12">
          <div className="min-w-0 lg:col-span-7">
            <ApiConsole impreso={visto} enviando={paso === 1} respondido={paso >= 2} vuelta={vuelta} onEjecutar={() => reiniciar(1)} />
          </div>
          <div className="lg:col-span-5 lg:pt-1">
            <LifecycleTimeline actual={paso - 1} />
          </div>
        </div>

        {/* Superficie pública (OpenAPI), compacta. */}
        <div className="mt-12 border-t border-dp-border pt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dp-muted">{t("Superficie del API", "API surface")}</p>
            <p className="break-all font-mono text-[11.5px] text-dp-text-2">{API_BASE_URL}</p>
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 sm:gap-x-8 lg:grid-cols-4">
            {superficie.map(([m, ruta, d]) => (
              <li key={m + ruta} className="min-w-0 border-b border-dp-border py-2.5">
                <p className="flex min-w-0 items-baseline gap-2 font-mono text-[11.5px] sm:gap-3 sm:text-[12px]">
                  <span className={`flex-none sm:w-9 ${m === "POST" ? "text-dp-text" : "text-dp-muted"}`}>{m}</span>
                  <span className="truncate text-dp-text-2">{ruta}</span>
                </p>
                <p className="mt-0.5 hidden truncate text-[12px] text-dp-muted sm:ml-12 sm:block">{d}</p>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
            <EnlaceFlecha href={`${DOCS_HREF}/messages`}>{t("Guía de mensajes", "Messages guide")}</EnlaceFlecha>
            <EnlaceFlecha href={`${DOCS_HREF}/reference`}>{t("Referencia OpenAPI", "OpenAPI reference")}</EnlaceFlecha>
          </div>
        </div>
      </div>
    </section>
  );
}
