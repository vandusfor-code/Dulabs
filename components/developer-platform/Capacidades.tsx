"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { SECTION_IDS } from "./constants";
import { useBloque, useEscritorio, useMenosMovimiento } from "./motion";
import { VISUALES } from "./CapacidadesVisuales";
import { Encabezado } from "./ui";

// DuLabs Developer -- «Qué puedes construir». Ocho capacidades en una composición editorial: la lista a la izquierda, un escenario a la
// derecha donde la capacidad activa se EXPLICA con su propia microanimación. Se activa al pasar el cursor, con el foco o con un clic; si
// nadie interactúa, avanza sola mientras el bloque está en pantalla (una barra fina muestra el tiempo). Cada capacidad dice si es nativa
// de DuLabs o si la construyes tú con la API y los webhooks: no se inventa nada que el producto no haga.
// Mobile: fila de pestañas con scroll interno + el mismo escenario debajo; allí no hay autoplay (la altura solo cambia si el usuario elige).

type Tipo = "nativo" | "api";

export function Capacidades() {
  const { t } = useI18n();
  const { ref, activo, atributos } = useBloque<HTMLElement>({ umbral: 0.3 });
  const menos = useMenosMovimiento();
  const escritorio = useEscritorio();
  const [i, setI] = useState(0);
  const [fijado, setFijado] = useState(false);
  const pestanas = useRef<HTMLDivElement>(null);

  const capacidades: { k: string; corto: string; d: string; tipo: Tipo }[] = [
    {
      k: t("Modo coexistencia", "Coexistence mode"),
      corto: t("Coexistencia", "Coexistence"),
      d: t(
        "Conecta la infraestructura sin abandonar la operación existente: tu equipo sigue en la app de WhatsApp Business y, sobre el mismo número, construyes con la API.",
        "Connect the infrastructure without leaving your existing operation: your team stays on the WhatsApp Business app and, on the same number, you build with the API.",
      ),
      tipo: "nativo",
    },
    {
      k: t("API por número", "API per number"),
      corto: t("API por número", "Per-number API"),
      d: t(
        "Cada número conectado es un recurso de la API, con su id, su estado y su webhook. Autenticas, compruebas que está conectado y envías.",
        "Each connected number is an API resource with its id, status and webhook. Authenticate, check it's connected and send.",
      ),
      tipo: "nativo",
    },
    {
      k: t("Envíos masivos", "Bulk sends"),
      corto: t("Masivos", "Bulk"),
      d: t(
        "Tu campaña entra por la API y la infraestructura marca el ritmo: límites por número y por workspace, cola, reintentos y un estado por mensaje.",
        "Your campaign goes in through the API and the infrastructure sets the pace: per-number and per-workspace limits, queue, retries and a status per message.",
      ),
      tipo: "api",
    },
    {
      k: t("Protección y control de envíos", "Send protection & control"),
      corto: t("Control", "Control"),
      d: t(
        "Envíos sobre infraestructura controlada y dentro de las políticas y límites de WhatsApp. No dispares todo desde tu servidor: deja que la infraestructura gestione el flujo.",
        "Sends on controlled infrastructure, within WhatsApp's policies and limits. Don't fire everything from your server: let the infrastructure manage the flow.",
      ),
      tipo: "nativo",
    },
    {
      k: t("Agentes de IA", "AI agents"),
      corto: t("Agentes IA", "AI agents"),
      d: t(
        "Construye agentes sobre WhatsApp: DuLabs te entrega cada mensaje por webhook, tu agente decide con su contexto y sus herramientas, y responde por la API.",
        "Build agents on WhatsApp: DuLabs delivers every message by webhook, your agent decides with its context and tools, and replies through the API.",
      ),
      tipo: "api",
    },
    {
      k: t("Recordatorios", "Reminders"),
      corto: t("Recordatorios", "Reminders"),
      d: t(
        "Comunicaciones programadas a partir de tus eventos: tu scheduler decide cuándo y la API envía, con estado y confirmación de entrega.",
        "Scheduled communications from your events: your scheduler decides when and the API sends, with status and delivery confirmation.",
      ),
      tipo: "api",
    },
    {
      k: t("Automatizaciones", "Automations"),
      corto: t("Automatizaciones", "Automations"),
      d: t(
        "Conecta eventos, reglas y acciones: entra un lead, tu regla lo califica y la API actúa. Tus reglas, nuestra entrega.",
        "Connect events, rules and actions: a lead comes in, your rule qualifies it and the API acts. Your rules, our delivery.",
      ),
      tipo: "api",
    },
    {
      k: t("Webhooks e integraciones", "Webhooks & integrations"),
      corto: "Webhooks",
      d: t(
        "DuLabs no es una caja cerrada: eventos firmados hacia tu backend y una API para responder desde él. Una capa de infraestructura, no un silo.",
        "DuLabs isn't a closed box: signed events to your backend and an API to reply from it. An infrastructure layer, not a silo.",
      ),
      tipo: "nativo",
    },
  ];
  const actual = capacidades[i]!;
  const { Visual, duracion } = VISUALES[i]!;
  // Autoplay solo en escritorio: en móvil cambiar de capacidad sola movería la página mientras se lee (se elige con las pestañas).
  const autoplay = activo && !fijado && !menos && escritorio;

  // Autoplay: avanza cuando la capacidad termina de explicarse (+ un respiro), solo en pantalla y sin interacción.
  useEffect(() => {
    if (!autoplay) return;
    const id = window.setTimeout(() => setI((x) => (x + 1) % VISUALES.length), duracion + 900);
    return () => window.clearTimeout(id);
  }, [autoplay, duracion, i]);

  // Mobile: la pestaña activa se desplaza a la vista DENTRO de su fila (nunca mueve la página).
  useEffect(() => {
    const fila = pestanas.current;
    const boton = fila?.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (!fila || !boton || fila.scrollWidth <= fila.clientWidth) return;
    fila.scrollTo({ left: boton.offsetLeft - 24, behavior: menos ? "auto" : "smooth" });
  }, [i, menos]);

  const elegir = (n: number) => {
    setI(n);
    setFijado(true);
  };
  const etiquetaTipo = (tipo: Tipo) => (tipo === "nativo" ? t("nativo", "native") : t("con la API", "with the API"));

  return (
    <section ref={ref} {...atributos} id={SECTION_IDS.capacidades} className="scroll-mt-14 border-t border-dp-border py-14 md:py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado
          indice="01"
          etiqueta={t("Qué puedes construir", "What you can build")}
          titulo={t("Construye más que un canal de WhatsApp.", "Build more than a WhatsApp channel.")}
          apoyo={t(
            "La infraestructura es el cómo. Esto es el qué: capacidades nativas de DuLabs y productos que construyes encima con la API y los webhooks.",
            "Infrastructure is the how. This is the what: native DuLabs capabilities and products you build on top with the API and webhooks.",
          )}
        />

        <div className="mt-12 grid gap-8 md:mt-14 lg:grid-cols-12 lg:gap-12">
          {/* Desktop: lista editorial. */}
          <div role="tablist" aria-label={t("Capacidades", "Capabilities")} aria-orientation="vertical" className="hidden border-t border-dp-border lg:col-span-5 lg:block">
            {capacidades.map((c, n) => {
              const sel = n === i;
              return (
                <button
                  key={c.k}
                  type="button"
                  role="tab"
                  id={`dp-cap-tab-${n}`}
                  aria-selected={sel}
                  aria-controls="dp-cap-panel"
                  tabIndex={sel ? 0 : -1}
                  onPointerEnter={(e) => e.pointerType === "mouse" && elegir(n)}
                  onFocus={() => elegir(n)}
                  onClick={() => elegir(n)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const sig = (n + (e.key === "ArrowDown" ? 1 : -1) + capacidades.length) % capacidades.length;
                      document.getElementById(`dp-cap-tab-${sig}`)?.focus();
                    }
                  }}
                  className={`dp-link relative block w-full border-b border-dp-border py-3.5 pl-1 pr-2 text-left ${sel ? "" : "hover:bg-white/[0.015]"}`}
                >
                  <span className="flex items-baseline gap-4">
                    <span className={`w-6 flex-none font-mono text-[11px] ${sel ? "text-dp-signal" : "text-dp-muted"}`}>{String(n + 1).padStart(2, "0")}</span>
                    <span className={`flex-1 text-[15.5px] font-medium tracking-[-0.01em] ${sel ? "text-dp-text" : "text-dp-text-2"}`}>{c.k}</span>
                    <span className={`flex-none font-mono text-[9.5px] uppercase tracking-[0.16em] ${c.tipo === "nativo" ? "text-dp-text-2" : "text-dp-muted"}`}>{etiquetaTipo(c.tipo)}</span>
                  </span>
                  <span className="dp-cap-detalle ml-10 block pr-6" data-abierto={sel ? "" : undefined}>
                    <span className="block overflow-hidden">
                      <span className="block pt-2 text-[13.5px] leading-relaxed text-dp-text-2">{c.d}</span>
                    </span>
                  </span>
                  {sel && autoplay ? (
                    <span key={`p${i}`} aria-hidden className="dp-anim dp-cap-progreso absolute -bottom-px left-0 h-px w-full bg-dp-text-2" style={{ animationDuration: `${duracion + 900}ms` }} />
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Mobile / tablet: pestañas con scroll interno. */}
          <div ref={pestanas} role="tablist" aria-label={t("Capacidades", "Capabilities")} className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] lg:hidden">
            {capacidades.map((c, n) => (
              <button
                key={c.k}
                type="button"
                role="tab"
                data-i={n}
                aria-selected={n === i}
                aria-controls="dp-cap-panel"
                onClick={() => elegir(n)}
                className={`dp-link flex-none rounded-dp border px-3 py-2 font-mono text-[11.5px] ${n === i ? "border-dp-border-strong bg-white/[0.06] text-dp-text" : "border-dp-border text-dp-muted"}`}
              >
                <span className={n === i ? "text-dp-signal" : ""}>{String(n + 1).padStart(2, "0")}</span> {c.corto}
              </button>
            ))}
          </div>

          {/* Escenario: la capacidad activa, explicada por su animación. */}
          <div id="dp-cap-panel" role="tabpanel" aria-labelledby={`dp-cap-tab-${i}`} className="dp-panel dp-revela min-w-0 rounded-dp-lg border border-dp-border bg-dp-surface p-5 md:p-6 lg:col-span-7">
            <div className="flex items-baseline justify-between gap-4 border-b border-dp-border pb-4">
              <p className="min-w-0 font-mono text-[11px] uppercase tracking-[0.16em] text-dp-text">
                <span className="text-dp-signal">{String(i + 1).padStart(2, "0")}</span> — {actual.k}
              </p>
              <p className={`flex-none font-mono text-[10px] uppercase tracking-[0.16em] ${actual.tipo === "nativo" ? "text-dp-ok" : "text-dp-muted"}`}>
                <span className="sm:hidden">{actual.tipo === "nativo" ? t("● nativo", "● native") : t("○ con la API", "○ with API")}</span>
                <span className="hidden sm:inline">{actual.tipo === "nativo" ? t("● nativo en DuLabs", "● native to DuLabs") : t("○ lo construyes con la API", "○ you build it with the API")}</span>
              </p>
            </div>
            <p className="mt-4 text-[13.5px] leading-relaxed text-dp-text-2 lg:hidden">{actual.d}</p>
            <div key={i} className="dp-cruce mt-5 sm:min-h-[340px]">
              <Visual activo={activo} bucle={!autoplay} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
