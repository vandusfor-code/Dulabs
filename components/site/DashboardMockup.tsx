"use client";

import { LayoutGrid, MessagesSquare, Bot, Send, ClipboardList, Phone, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * Laptop con el dashboard real de Du Labs -- misma navegación que
 * components/dashboard/shell/nav.ts (recortada a lo más reconocible), no una
 * lista inventada. Los números de las tarjetas son ilustrativos (como
 * cualquier screenshot de producto en una landing), nunca se presentan como
 * datos de un cliente real.
 */

const NAV = [
  { icon: LayoutGrid, es: "Resumen", en: "Overview", activo: true },
  { icon: MessagesSquare, es: "Mensajes", en: "Messages" },
  { icon: Bot, es: "Agentes de IA", en: "AI agents" },
  { icon: Send, es: "Campañas", en: "Campaigns" },
  { icon: ClipboardList, es: "Encuestas", en: "Surveys" },
  { icon: Phone, es: "Números", en: "Numbers" },
  { icon: Users, es: "Equipo", en: "Team" },
];

const VALORES_GRAFICA = [32, 58, 42, 74, 52, 24, 44];

export function DashboardMockup() {
  const { t } = useI18n();
  const dias = [t("Lun", "Mon"), t("Mar", "Tue"), t("Mié", "Wed"), t("Jue", "Thu"), t("Vie", "Fri"), t("Sáb", "Sat"), t("Dom", "Sun")];

  return (
    <div className="w-[560px] max-w-full select-none">
      <div className="rounded-t-xl border border-white/10 bg-[#0a0a0a] p-[6px] shadow-[0_30px_70px_-20px_rgba(0,0,0,0.65)]">
        {/* Barra superior */}
        <div className="flex items-center justify-between rounded-t-[6px] bg-[#0d0d0d] px-4 py-2.5">
          <div className="flex items-center gap-1.5 font-display text-[12px] font-medium text-white">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-site-primary/15 text-[9px] font-bold text-site-primary">D</span>
            Du Labs
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9.5px] text-site-muted-fg">{t("Mi negocio", "My business")}</span>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-site-primary/20 text-[9px] font-semibold text-site-primary">PE</span>
          </div>
        </div>

        <div className="flex overflow-hidden rounded-b-[6px] bg-[#0d0d0d]">
          {/* Sidebar */}
          <aside className="hidden w-[126px] shrink-0 flex-col gap-0.5 border-r border-white/5 p-2 sm:flex">
            {NAV.map((item) => (
              <div
                key={item.es}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[10px] ${
                  item.activo ? "bg-site-primary/15 font-medium text-site-primary" : "text-site-muted-fg"
                }`}
              >
                <item.icon className="h-3 w-3 shrink-0" />
                <span className="truncate">{t(item.es, item.en)}</span>
              </div>
            ))}
          </aside>

          {/* Contenido principal */}
          <div className="min-w-0 flex-1 p-3">
            <div className="mb-2.5 font-display text-[13px] font-medium text-white">{t("Resumen", "Overview")}</div>

            <div className="grid grid-cols-3 gap-2">
              <Kpi label={t("Conversaciones", "Conversations")} value="1,248" />
              <Kpi label={t("Contactos", "Contacts")} value="892" />
              <Kpi label={t("Mensajes enviados", "Messages sent")} value="5,160" />
            </div>

            <div className="mt-2.5 rounded-lg border border-white/5 bg-black/30 p-2.5">
              <span className="font-display text-[10.5px] font-medium text-white">{t("Actividad de conversaciones", "Conversation activity")}</span>
              <Grafica valores={VALORES_GRAFICA} />
              <div className="mt-1 flex justify-between font-mono text-[7.5px] text-site-muted-fg">
                {dias.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/5 bg-black/30 p-2">
                <div className="font-mono text-[7.5px] uppercase tracking-wider text-site-muted-fg">{t("Estado del asistente", "Assistant status")}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-site-primary shadow-[0_0_6px_var(--color-site-primary)]" />
                  {t("Activo", "Active")}
                </div>
              </div>
              <div className="rounded-lg border border-white/5 bg-black/30 p-2">
                <div className="font-mono text-[7.5px] uppercase tracking-wider text-site-muted-fg">{t("Modelo IA", "AI model")}</div>
                <div className="mt-1 truncate text-[10px] text-white">Claude (Anthropic)</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Base del laptop */}
      <div className="mx-auto h-2.5 w-[94%] rounded-b-xl bg-gradient-to-b from-[#232323] to-[#0a0a0a]" />
      <div className="mx-auto h-[3px] w-[36%] rounded-b-full bg-[#050505]" />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/30 p-2">
      <div className="truncate font-mono text-[7px] uppercase tracking-wider text-site-muted-fg">{label}</div>
      <div className="mt-1 font-display text-[14px] font-medium text-white">{value}</div>
    </div>
  );
}

function Grafica({ valores }: { valores: number[] }) {
  const w = 100;
  const h = 34;
  const pts = valores.map((v, i) => `${(i / (valores.length - 1)) * w},${h - (v / 100) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 h-9 w-full overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke="var(--color-site-primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
