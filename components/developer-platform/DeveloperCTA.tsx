"use client";

import { useI18n } from "@/lib/i18n";
import { START_HREF, DOCS_HREF, API_HOST } from "./constants";
import { estadoNodo, useBloque, useSecuencia } from "./motion";
import { BotonPrimario, BotonSecundario } from "./ui";

// DuLabs Developer -- cierre. «Tu producto. Nuestra infraestructura.» y una última micro-secuencia que resume toda la página: request
// -> 201 -> delivered. Mismo lenguaje de nodos que el hero (pulso de llegada, lo recorrido confirmado); en pausa fuera de pantalla.

const PASOS = [900, 900, 1800, 700, 300] as const; // request · 201 · delivered · reposo · reinicio
const REINICIO = 4;

export function DeveloperCTA() {
  const { t } = useI18n();
  const { ref, activo, atributos } = useBloque<HTMLElement>({ umbral: 0.4 });
  const { paso } = useSecuencia(PASOS, { activo, pasoEstatico: 3 });
  const etapas = [
    { k: "request", sub: "POST /messages" },
    { k: "201", sub: "created" },
    { k: "delivered", sub: "message.status", tono: "ok" as const },
  ];
  const reinicio = paso === REINICIO;
  const actual = reinicio ? -1 : paso;
  const pos = reinicio ? 0 : Math.min(paso, 2);

  return (
    <section ref={ref} {...atributos} aria-labelledby="dp-cierre" className="border-t border-dp-border">
      <div className="mx-auto max-w-[1440px] px-6 py-20 md:py-28">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dp-muted">{t("Construye sobre DuLabs", "Build on DuLabs")}</p>
        <h2 id="dp-cierre" className="dp-display mt-6 font-medium text-dp-text">
          <span className="block">{t("Tu producto.", "Your product.")}</span>
          <span className="block text-dp-muted">{t("Nuestra infraestructura.", "Our infrastructure.")}</span>
        </h2>

        <div className="mt-10 grid gap-10 md:mt-14 lg:grid-cols-12 lg:items-end lg:gap-12">
          <div className="lg:col-span-6">
            <ol className="mb-8 flex flex-col gap-2 font-mono text-[12.5px] text-dp-text-2 sm:flex-row sm:gap-6">
              {[t("Crea tu API key", "Create your API key"), t("Lee el quickstart", "Read the quickstart"), t("Envía tu primer request", "Send your first request")].map((p, n) => (
                <li key={p} className="flex items-center gap-2.5">
                  <span className="text-dp-muted">{String(n + 1).padStart(2, "0")}</span>
                  {p}
                </li>
              ))}
            </ol>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <BotonPrimario href={START_HREF}>Get API Key</BotonPrimario>
              <BotonSecundario href={DOCS_HREF}>{t("Leer la documentación", "Read the docs")}</BotonSecundario>
            </div>
          </div>

          <figure data-viaje="" {...(reinicio ? { "data-reinicio": "" } : {})} className="dp-flujo overflow-clip [overflow-clip-margin:16px] lg:col-span-6" aria-label={t("Un request, de principio a fin", "One request, end to end")}>
            <div className="relative">
              <div aria-hidden className="absolute top-[4px] h-px bg-dp-border" style={{ left: 4, right: "calc(100% / 3 - 4px)" }}>
                <div className="dp-recorrido absolute inset-0 bg-dp-text-2" style={{ transform: `scaleX(${reinicio ? 0 : pos / 2})` }} />
                <div className="dp-paquete-x" style={{ transform: `translateX(${pos * 50}%)`, opacity: paso <= 2 ? 1 : 0 }}>
                  <span className="dp-paquete-punto absolute left-0 top-0 block h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-dp-signal" />
                </div>
              </div>
              <ol className="grid grid-cols-3">
                {etapas.map((e, i) => (
                  <li key={e.k} data-estado={estadoNodo(i, actual)} {...(e.tono && i <= actual ? { "data-tono": e.tono } : {})} className="min-w-0 pr-3">
                    <span className="dp-nodo-punto" />
                    <p className="dp-nodo-nombre mt-4 font-mono text-[13px]">{e.k}</p>
                    <p className="mt-0.5 truncate font-mono text-[10.5px] text-dp-muted">{e.sub}</p>
                  </li>
                ))}
              </ol>
            </div>
            <figcaption className="mt-5 font-mono text-[11px] text-dp-muted">{API_HOST}</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
