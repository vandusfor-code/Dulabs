"use client";

import { useI18n } from "@/lib/i18n";
import { SECTION_IDS } from "./constants";
import { useBloque, useSecuencia } from "./motion";
import { Encabezado, MarcaEstado, NotaEjemplo, type Estado } from "./ui";
import { ProductionControls } from "./ProductionControls";

// DuLabs Developer -- vista del dashboard (/developer). DEMO DATA, rotulada. La única animación: de vez en cuando entra un evento
// (message.received) y el contador de mensajes sube en uno (12,480 -> 12,481) a la vez; luego todo vuelve a estar estable. Nada cambia
// constantemente. Los porcentajes se calculan de las mismas cifras que se muestran (nunca a mano).

const PASOS = [6200, 2200] as const; // estable · evento nuevo
const LIMITE_PLAN = 20000;
// Evento k (por vuelta): los que entran alternan message.received y message.status.
const EVENTOS: { detalle: string; tipo: string; estado: Estado }[] = [
  { detalle: "read", tipo: "message.status", estado: "read" },
  { detalle: "text", tipo: "message.received", estado: "received" },
  { detalle: "delivered", tipo: "message.status", estado: "delivered" },
  { detalle: "text", tipo: "message.received", estado: "received" },
];

function hora(n: number) {
  const s = 12 * 3600 + 4 * 60 + 17 + n * 7;
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function DashboardPreview({ activo }: { activo: boolean }) {
  const { t } = useI18n();
  const { paso, vuelta } = useSecuencia(PASOS, { activo, pasoEstatico: 0 });
  const nuevos = vuelta + (paso === 1 ? 1 : 0);
  const mensajes = 12480 + nuevos;
  const pct = Math.round((mensajes / LIMITE_PLAN) * 100);
  const filas = Array.from({ length: 4 }, (_, j) => nuevos - j);
  const nav = ["Overview", "API keys", "WhatsApp", "Webhooks", "Events", "Usage", "Members", "Plan"];

  const metricas = [
    { k: t("Mensajes este mes", "Messages this month"), v: mensajes.toLocaleString("en-US"), sub: `/ ${LIMITE_PLAN.toLocaleString("en-US")}`, cambia: true },
    { k: t("Números", "Numbers"), v: "2", sub: "/ 2" },
    { k: "API keys", v: "3", sub: t("activas", "active") },
    { k: "DLQ", v: "1", sub: t("por reenviar", "to replay") },
  ];

  return (
    <div className="dp-panel dp-revela overflow-hidden rounded-dp-lg border border-dp-border bg-dp-surface">
      <div className="flex items-center gap-3 border-b border-dp-border px-4 py-2.5">
        <span aria-hidden className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-white/10" />
          <span className="h-2 w-2 rounded-full bg-white/10" />
          <span className="h-2 w-2 rounded-full bg-white/10" />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dp-muted">dulabs.co/developer</span>
        <span className="flex-none rounded-[4px] border border-dp-border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-dp-muted">
          {t("Datos de ejemplo", "Demo data")}
        </span>
      </div>
      <div className="grid md:grid-cols-[188px_1fr]">
        <nav aria-hidden className="hidden border-r border-dp-border p-3 md:block">
          <p className="px-2.5 pb-3 pt-1 text-[12.5px] font-medium text-dp-text">
            acme-prod <span className="font-mono text-[10px] text-dp-muted">workspace</span>
          </p>
          {nav.map((n, i) => (
            <p key={n} className={`rounded-md px-2.5 py-1.5 text-[12.5px] ${i === 0 ? "bg-white/[0.06] text-dp-text" : "text-dp-muted"}`}>
              {n}
            </p>
          ))}
        </nav>
        <div className="min-w-0 p-4 md:p-6">
          <div className="grid grid-cols-2 border-l border-t border-dp-border lg:grid-cols-4">
            {metricas.map((m) => (
              <div key={m.k} className="min-w-0 border-b border-r border-dp-border p-3.5 md:p-4">
                <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-dp-muted">{m.k}</p>
                <p className="mt-2 font-mono text-[19px] tabular-nums text-dp-text md:text-[22px]">
                  <span key={m.cambia ? m.v : undefined} className={m.cambia && nuevos > 0 ? "dp-cambio" : undefined}>
                    {m.v}
                  </span>{" "}
                  <span className="text-[11px] text-dp-muted">{m.sub}</span>
                </p>
                {m.cambia ? (
                  <div className="mt-2.5">
                    <div aria-hidden className="h-px bg-dp-border">
                      <div className="h-px origin-left bg-dp-text-2" style={{ transform: `scaleX(${mensajes / LIMITE_PLAN})` }} />
                    </div>
                    <p className="mt-1.5 font-mono text-[10.5px] text-dp-muted">{t(`${pct} % del plan`, `${pct}% of plan`)}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-5">
            <div className="flex items-baseline justify-between gap-3 pb-2">
              <p className="text-[12.5px] font-medium text-dp-text">{t("Eventos recientes", "Recent events")}</p>
              <p className="hidden font-mono text-[10.5px] text-dp-muted sm:block">message.received · message.status</p>
            </div>
            <div className="overflow-hidden border-t border-dp-border">
              <ol key={nuevos} className={nuevos > 0 ? "dp-empuja" : undefined} style={{ ["--fila" as string]: "33px" }}>
                {filas.map((k, j) => {
                  const e = EVENTOS[((k % EVENTOS.length) + EVENTOS.length) % EVENTOS.length]!;
                  return (
                    <li key={k} className={`flex h-[33px] items-center gap-3 border-b border-dp-border font-mono text-[11.5px] ${j === 0 && nuevos > 0 ? "dp-fila-nueva" : ""}`}>
                      <MarcaEstado estado={e.estado} />
                      <span className="w-[72px] flex-none text-dp-text">{e.detalle}</span>
                      <span className="min-w-0 flex-1 truncate text-dp-muted">{e.tipo}</span>
                      <span className="hidden flex-none text-dp-muted sm:inline">200</span>
                      <span className="flex-none tabular-nums text-dp-muted">{hora(k)}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DevControl() {
  const { t } = useI18n();
  const { ref, activo, atributos } = useBloque<HTMLElement>({ umbral: 0.25 });
  return (
    <section ref={ref} {...atributos} id={SECTION_IDS.control} className="scroll-mt-14 border-t border-dp-border py-14 md:py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <Encabezado
          indice="06"
          etiqueta={t("Control y seguridad", "Control & security")}
          titulo={t("Opera tu integración desde un solo lugar.", "Run your integration from one place.")}
          apoyo={t(
            "Workspaces, números conectados, API keys, webhooks, uso del plan y el stream de eventos con reenvío desde la DLQ. Debajo, los controles que la plataforma aplica siempre.",
            "Workspaces, connected numbers, API keys, webhooks, plan usage and the event stream with DLQ replay. Below, the controls the platform always enforces.",
          )}
        />
        <figure className="mt-12 md:mt-14">
          <DashboardPreview activo={activo} />
          <figcaption className="mt-4">
            <NotaEjemplo>{t("Vista ilustrativa del dashboard · datos de ejemplo, no métricas reales", "Illustrative dashboard view · demo data, not real metrics")}</NotaEjemplo>
          </figcaption>
        </figure>
        <div id={SECTION_IDS.produccion} className="mt-12 scroll-mt-20 md:mt-14">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dp-muted">{t("Controles aplicados por la plataforma", "Controls enforced by the platform")}</p>
            <p className="text-[12.5px] text-dp-muted">{t("Sin claims de certificaciones que aún no tenemos.", "No claims of certifications we don't hold yet.")}</p>
          </div>
          <ProductionControls />
        </div>
      </div>
    </section>
  );
}
