"use client";

import { useI18n } from "@/lib/i18n";
import { API_HOST } from "./constants";
import { estadoNodo, useBloque, useSecuencia } from "./motion";

// DuLabs Developer -- la ruta de un mensaje, viva. Un paquete recorre App -> API Gateway -> Queue -> Worker -> WhatsApp Cloud API ->
// Cliente; al llegar a cada nodo, el nodo pulsa una vez y muestra su micro-estado (AUTH OK, QUEUED, PROCESSING, SENT, DELIVERED). Lo
// recorrido queda confirmado; luego el sistema descansa y entra un request nuevo. Ciclo de 6 s con pausa: respira, no corre.
//
// Motion: SOLO transform/opacity (el paquete es un contenedor del largo del recorrido que se traslada; el tramo recorrido es un scaleX).
// La secuencia la lleva useSecuencia (un setTimeout por paso, solo con el bloque en pantalla). Reduced motion: todo confirmado, sin
// paquete. Desktop: banda horizontal con los dominios (tu producto / DuLabs / Meta / tu cliente). Mobile: la misma ruta en vertical.

// request · gateway · queue · worker · Meta · cliente · reposo · reinicio (ms). 0 -> 0.6 -> 1.2 -> 1.8 -> 2.6 -> 3.4 -> 4.5 -> 5.5 s.
const PASOS = [600, 600, 600, 800, 800, 1100, 1000, 500] as const;
const REPOSO = 6;
const REINICIO = 7;

type Nodo = { k: string; sub: string; chip: string; tono?: "ok" };

export function InfrastructureFlow() {
  const { t } = useI18n();
  const { ref, activo, atributos } = useBloque<HTMLDivElement>({ umbral: 0.35 });
  const { paso } = useSecuencia(PASOS, { activo, pasoEstatico: REPOSO });

  const nodos: Nodo[] = [
    { k: t("Tu app", "Your app"), sub: "POST /v1/messages", chip: "POST" },
    { k: "API Gateway", sub: t("auth · límites · idempotencia", "auth · limits · idempotency"), chip: "AUTH OK · 201" },
    { k: "Queue", sub: "at-least-once · jobId", chip: "QUEUED" },
    { k: "Worker", sub: t("reintentos · backoff", "retries · backoff"), chip: "PROCESSING" },
    { k: "WhatsApp Cloud API", sub: t("oficial de Meta", "official, by Meta"), chip: "SENT" },
    { k: t("Cliente", "Customer"), sub: "WhatsApp", chip: "DELIVERED", tono: "ok" },
  ];
  // La etiqueta viaja con el paquete: es lo que va por cada conexión.
  const tramo = ["request", "POST", "201", "job", "send", "delivered"];

  const actual = paso === REINICIO ? -1 : paso; // en el reposo (6) todo queda confirmado
  const enNodo = Math.min(Math.max(paso, 0), 5);
  const pos = paso === REINICIO ? 0 : enNodo;
  const visible = paso <= 5;
  const progreso = paso === REINICIO ? 0 : enNodo / 5;
  const flujo = { "data-viaje": "", ...(paso === REINICIO ? { "data-reinicio": "" } : {}) };

  const nodo = (n: Nodo, i: number) => ({
    "data-estado": estadoNodo(i, actual),
    ...(n.tono && i <= actual ? { "data-tono": n.tono } : {}),
  });

  return (
    <div ref={ref} {...atributos}>
      <figure {...flujo} className="dp-flujo dp-revela overflow-clip [overflow-clip-margin:16px]" aria-labelledby="dp-ruta-titulo">
        <figcaption className="mb-6 flex items-center justify-between gap-4 font-mono text-[10.5px] uppercase tracking-[0.18em] text-dp-muted md:mb-8">
          <span id="dp-ruta-titulo" className="inline-flex items-center gap-2.5">
            <span aria-hidden className="dp-senal dp-anim" />
            {t("Ruta de un mensaje", "Path of a message")}
          </span>
          <span className="normal-case tracking-normal">
            {t("ilustrativo", "illustrative")} <span className="hidden sm:inline">· {API_HOST}</span>
          </span>
        </figcaption>

        {/* Desktop / tablet: banda horizontal. */}
        <div className="hidden md:block">
          <div aria-hidden className="grid grid-cols-6 font-mono text-[10px] uppercase tracking-[0.18em]">
            {[
              { k: t("Tu producto", "Your product"), span: "col-span-1", fuerte: false },
              { k: "DuLabs", span: "col-span-3", fuerte: true },
              { k: "Meta", span: "col-span-1", fuerte: false },
              { k: t("Tu cliente", "Your customer"), span: "col-span-1", fuerte: false },
            ].map((g) => (
              <div key={g.k} className={`${g.span} pr-4`}>
                <p className={g.fuerte ? "text-dp-text" : "text-dp-muted"}>{g.k}</p>
                <div className={`mt-2 h-px ${g.fuerte ? "bg-dp-border-strong" : "bg-dp-border"}`} />
              </div>
            ))}
          </div>

          <div className="relative mt-9">
            {/* Recorrido: del primer punto al último (5 de 6 columnas). */}
            <div aria-hidden className="absolute top-[4px] h-px bg-dp-border" style={{ left: 4, right: "calc(100% / 6 - 4px)" }}>
              <div className="dp-recorrido absolute inset-0 bg-dp-text-2" style={{ transform: `scaleX(${progreso})` }} />
              <div className="dp-paquete-x" style={{ transform: `translateX(${pos * 20}%)`, opacity: visible ? 1 : 0 }}>
                <span className="dp-paquete-punto absolute left-0 top-0 block h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-dp-signal" />
                <span key={paso} className="dp-cruce absolute bottom-[9px] left-[-4px] whitespace-nowrap font-mono text-[10.5px] text-dp-signal">
                  {tramo[enNodo]}
                </span>
              </div>
            </div>

            <ol className="grid grid-cols-6">
              {nodos.map((n, i) => (
                <li key={n.k} {...nodo(n, i)} className="min-w-0 pr-4">
                  <span className="dp-nodo-punto" />
                  <p className="dp-nodo-nombre mt-5 font-mono text-[13px] leading-snug">{n.k}</p>
                  <p className="mt-1 truncate font-mono text-[11px] text-dp-muted">{n.sub}</p>
                  <p className="dp-chip mt-3 h-4 font-mono text-[10.5px] uppercase tracking-[0.12em]">{n.chip}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Mobile: la misma ruta en vertical, compacta. */}
        <div className="relative md:hidden">
          <div aria-hidden className="absolute left-[4px] w-px bg-dp-border" style={{ top: 26, bottom: 26 }}>
            <div className="dp-recorrido-y absolute inset-0 bg-dp-text-2" style={{ transform: `scaleY(${progreso})` }} />
            <div className="dp-paquete-y" style={{ transform: `translateY(${pos * 20}%)`, opacity: visible ? 1 : 0 }}>
              <span className="dp-paquete-punto absolute left-0 top-0 block h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-dp-signal" />
            </div>
          </div>
          <ol className="border-y border-dp-border">
            {nodos.map((n, i) => (
              <li key={n.k} {...nodo(n, i)} className={`flex h-[52px] items-center gap-4 ${i > 0 ? "border-t border-dp-border" : ""}`}>
                <span className="dp-nodo-punto flex-none" />
                <span className="min-w-0 flex-1">
                  <span className="dp-nodo-nombre block truncate font-mono text-[13px]">{n.k}</span>
                  <span className="block truncate font-mono text-[10.5px] text-dp-muted">{n.sub}</span>
                </span>
                <span className="dp-chip flex-none font-mono text-[10px] uppercase tracking-[0.1em]">{n.chip.replace(" · 201", "")}</span>
              </li>
            ))}
          </ol>
        </div>
      </figure>
    </div>
  );
}
