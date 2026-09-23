"use client";

import { useI18n } from "@/lib/i18n";
import { SECTION_IDS } from "./constants";
import { useBloque, useSecuencia } from "./motion";
import { Encabezado } from "./ui";

// DuLabs Developer -- «No construyas todo desde cero». Dos lados y un contrato entre ellos: DuLabs resuelve la infraestructura, tú
// construyes el producto, y lo que los une es la API y los webhooks (dos paquetes cruzando en sentidos opuestos). El lado del producto
// recorre sus ejemplos uno a uno: cualquiera de ellos se construye sobre la misma capa.

const PASOS = [1100, 1100, 1100, 1100, 1100, 1100, 1100, 1100] as const;

export function InfraProducto() {
  const { t } = useI18n();
  const { ref, activo, atributos } = useBloque<HTMLElement>({ umbral: 0.3 });
  const { paso, estatico } = useSecuencia(PASOS, { activo });
  const infra = ["AUTH", "QUEUE", "RETRY", "WEBHOOKS", "DELIVERY", "IDEMPOTENCY", "RATE CONTROL", "EVENTS"];
  const producto = [
    "CRM",
    t("Agente de IA", "AI agent"),
    t("Reservas", "Booking"),
    "E-commerce",
    t("Notificaciones", "Notifications"),
    "Marketing",
    t("Soporte", "Support"),
    t("Automatización", "Automation"),
  ];
  return (
    <section ref={ref} {...atributos} id={SECTION_IDS.infra} className="scroll-mt-14 border-t border-dp-border py-14 md:py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado
          indice="02"
          etiqueta={t("DuLabs + tú", "DuLabs + you")}
          titulo={t("Deja la infraestructura compleja a DuLabs.", "Leave the hard infrastructure to DuLabs.")}
        />
        <div className="dp-revela mt-10 grid items-stretch gap-0 md:mt-12 md:grid-cols-[1fr_120px_1fr]">
          <div className="rounded-dp-lg border border-dp-border bg-dp-surface p-5 md:p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dp-text">DuLabs</p>
            <p className="mt-1 text-[14px] text-dp-text-2">{t("resuelve la infraestructura", "handles the infrastructure")}</p>
            <ul className="mt-5 grid grid-cols-2 gap-2">
              {infra.map((k) => (
                <li key={k} className="flex items-center gap-2 rounded-[6px] border border-dp-border px-2.5 py-2 font-mono text-[11px] tracking-[0.06em] text-dp-text">
                  <span aria-hidden className="h-1 w-1 flex-none rounded-full bg-dp-ok" />
                  {k}
                </li>
              ))}
            </ul>
          </div>

          {/* El contrato: API (tú -> DuLabs) y webhooks (DuLabs -> tú), en sentidos opuestos. */}
          <div aria-hidden className="relative flex h-24 items-center justify-center md:h-auto">
            <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-dp-border-strong md:left-0 md:right-0 md:top-1/2 md:h-px md:w-full md:translate-x-0" />
            <span className="relative z-10 bg-dp-bg px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-dp-muted">API · webhooks</span>
            <span className="dp-movil absolute inset-0 hidden md:block">
              <span className="dp-anim dp-derecha absolute inset-x-0 top-1/2 h-0">
                <span className="absolute left-0 top-0 block h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-dp-signal" />
              </span>
              <span className="dp-anim dp-izquierda absolute inset-x-0 top-1/2 h-0">
                <span className="absolute left-0 top-0 block h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-dp-text" />
              </span>
            </span>
            <span className="dp-movil absolute inset-0 md:hidden">
              <span className="dp-anim dp-baja absolute inset-y-0 left-1/2 w-0">
                <span className="absolute left-0 top-0 block h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-dp-signal" />
              </span>
              <span className="dp-anim dp-sube absolute inset-y-0 left-1/2 w-0">
                <span className="absolute left-0 top-0 block h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-dp-text" />
              </span>
            </span>
          </div>

          <div className="rounded-dp-lg border border-dp-border-strong bg-dp-surface p-5 md:p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dp-text">{t("Tú", "You")}</p>
            <p className="mt-1 text-[14px] text-dp-text-2">{t("construyes el producto", "build the product")}</p>
            <ul className="mt-5 grid grid-cols-2 gap-2">
              {producto.map((k, n) => {
                const encendido = !estatico && n === paso;
                return (
                  <li
                    key={k}
                    className={`rounded-[6px] border px-2.5 py-2 text-[13px] transition-colors duration-300 ${encendido ? "border-dp-signal/60 text-dp-text" : "border-dp-border text-dp-text-2"}`}
                  >
                    {k}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
