"use client";

import { Megaphone, MessageSquare, Phone, Search, Sparkles, Users, Zap } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * Hero product surface — a stylized mockup of the real Du Labs dashboard
 * (Resumen: KPI cards, actividad chart, tabla de números). Not a fictional
 * product, just the actual dashboard dressed in the marketing site's glass UI.
 */
export function CommandCenter() {
  const { t } = useI18n();
  return (
    <div className="relative mx-auto w-full max-w-[1180px]">
      <div className="pointer-events-none absolute -inset-16 -z-10">
        <div className="absolute inset-x-10 top-0 h-56 rounded-full bg-site-primary/15 blur-[120px]" />
        <div className="absolute inset-x-40 top-20 h-56 rounded-full bg-site-primary-glow/10 blur-[120px]" />
      </div>

      <div className="site-glass-strong relative overflow-hidden rounded-2xl">
        {/* Chrome */}
        <div className="flex items-center justify-between border-b border-site-border bg-gradient-to-b from-white/[0.02] to-transparent px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-white/10 ring-1 ring-white/5" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/10 ring-1 ring-white/5" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/10 ring-1 ring-white/5" />
            </div>
            <div className="hidden items-center gap-1 rounded-md bg-white/[0.03] px-2 py-1 font-mono text-[10.5px] text-site-muted-fg ring-1 ring-white/5 md:flex">
              <Search className="h-3 w-3" />
              app.dulabs.co
              <span className="ml-1 text-white/30">/</span>
              <span>dashboard</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot />
            <span className="font-mono text-[10.5px] uppercase tracking-widest text-site-muted-fg">
              {t("WhatsApp Cloud API · en vivo", "WhatsApp Cloud API · live")}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-12">
          {/* Sidebar */}
          <aside className="col-span-3 hidden border-r border-site-border bg-black/20 p-3 lg:block">
            <SidebarGroup label={t("Panel", "Panel")} />
            <SideItem icon={Zap} label={t("Resumen", "Overview")} active />
            <SideItem icon={Phone} label={t("Números", "Numbers")} count={1} />
            <SideItem icon={Megaphone} label={t("Plantillas y campañas", "Templates & campaigns")} />
            <SideItem icon={MessageSquare} label={t("Mensajes", "Messages")} count={38} />
            <SideItem icon={Users} label={t("Cuenta", "Account")} />
          </aside>

          {/* Main */}
          <main className="col-span-12 lg:col-span-9">
            <div className="flex items-center justify-between border-b border-site-border px-5 py-3">
              <div>
                <div className="font-mono text-[10.5px] uppercase tracking-widest text-site-muted-fg">{t("Resumen", "Overview")}</div>
                <div className="mt-0.5 font-display text-[15px] font-medium tracking-tight text-site-fg">
                  {t("Tu WhatsApp Business, en un panel", "Your WhatsApp Business, in one panel")}
                </div>
              </div>
              <div className="hidden items-center gap-2 md:flex">
                <Chip primary>
                  <Sparkles className="h-3 w-3" /> {t("IA entrenada", "AI trained")}
                </Chip>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-px border-b border-site-border bg-white/5 md:grid-cols-4">
              <Kpi label={t("Números activos", "Active numbers")} value="1" icon={Phone} />
              <Kpi label={t("Mensajes procesados", "Messages processed")} value="1,284" icon={MessageSquare} />
              <Kpi label={t("Mensajes restantes", "Messages remaining")} value="3,716" icon={Zap} />
              <Kpi label={t("Plan actual", "Current plan")} value="Pro" accent />
            </div>

            <div className="grid grid-cols-12 gap-3 p-3.5 md:p-4">
              {/* Activity chart */}
              <div className="site-panel col-span-12 p-4 md:col-span-7">
                <PanelHead title={t("Mensajes procesados · 7 días", "Messages processed · 7 days")} meta={<span className="font-mono text-[10px] text-site-muted-fg">{t("esta semana", "this week")}</span>} />
                <Bars />
                <div className="mt-2 flex items-center justify-between text-[10px] text-site-muted-fg">
                  <span>{t("lun", "Mon")}</span><span>{t("mar", "Tue")}</span><span>{t("mié", "Wed")}</span><span>{t("jue", "Thu")}</span><span>{t("vie", "Fri")}</span><span>{t("sáb", "Sat")}</span><span>{t("dom", "Sun")}</span>
                </div>
              </div>

              {/* Live chat */}
              <div className="site-panel col-span-12 p-4 md:col-span-5">
                <PanelHead
                  title={t("Conversación", "Conversation")}
                  meta={
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-widest text-site-muted-fg ring-1 ring-white/5">
                      <span className="h-1.5 w-1.5 rounded-full bg-site-primary shadow-[0_0_6px_var(--color-site-primary)]" />
                      {t("WhatsApp · IA activa", "WhatsApp · AI active")}
                    </span>
                  }
                />
                <div className="mt-3 space-y-2">
                  <Bubble side="in">{t("¿Tienen disponibilidad mañana en la tarde?", "Do you have availability tomorrow afternoon?")}</Bubble>
                  <Bubble side="out" ai>{t("¡Hola! Sí, tenemos espacio a las 3:00 p.m. y 4:30 p.m. ¿Cuál prefieres?", "Hi! Yes, we have 3:00 pm and 4:30 pm open. Which do you prefer?")}</Bubble>
                  <Bubble side="in">{t("A las 3 está perfecto", "3 works perfectly")}</Bubble>
                  <Bubble side="out" ai typing>{t("Agendado ✓ Te llega la confirmación…", "Booked ✓ Confirmation on its way…")}</Bubble>
                </div>
              </div>

              {/* Números table */}
              <div className="site-panel col-span-12 p-4">
                <PanelHead title={t("Tus números", "Your numbers")} meta={<Chip>{t("Activo", "Active")}</Chip>} />
                <div className="mt-3 flex items-center justify-between rounded-lg border border-site-border bg-white/[0.02] px-3 py-2.5 text-[12px]">
                  <span className="text-site-fg">{t("Peluquería Estilo", "Estilo Hair Salon")}</span>
                  <span className="font-mono text-site-muted-fg">+57 300 ••• ••56</span>
                  <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-site-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-site-primary shadow-[0_0_6px_var(--color-site-primary)]" />
                    {t("Activo", "Active")}
                  </span>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Reflection */}
      <div
        aria-hidden
        className="pointer-events-none mx-auto -mt-4 h-40 w-[92%] scale-y-[-1] rounded-b-2xl bg-gradient-to-b from-white/[0.03] to-transparent blur-md reflect-below opacity-40"
      />
    </div>
  );
}

function StatusDot() {
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full animate-site-ping-soft rounded-full bg-site-primary/50" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-site-primary shadow-[0_0_8px_var(--color-site-primary)]" />
    </span>
  );
}

function SidebarGroup({ label }: { label: string }) {
  return (
    <div className="px-2 pb-1.5 pt-2 font-mono text-[9.5px] font-medium uppercase tracking-widest text-site-muted-fg/70">
      {label}
    </div>
  );
}
function SideItem({
  icon: Icon,
  label,
  active,
  count,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  count?: number;
}) {
  return (
    <div
      className={`mb-0.5 flex items-center justify-between rounded-md px-2 py-1.5 text-[12px] ${
        active ? "bg-white/[0.05] text-site-fg ring-1 ring-white/10" : "text-site-muted-fg hover:bg-white/[0.02]"
      }`}
    >
      <span className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${active ? "text-site-primary" : ""}`} />
        {label}
      </span>
      {count !== undefined && <span className="font-mono text-[9.5px] text-site-muted-fg">{count.toLocaleString()}</span>}
    </div>
  );
}

function Chip({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ring-1 ${
        primary ? "bg-site-primary/10 text-site-primary ring-site-primary/25" : "bg-white/[0.03] text-site-muted-fg ring-white/10"
      }`}
    >
      {children}
    </span>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon?: React.ElementType;
  accent?: boolean;
}) {
  return (
    <div className="bg-site-bg p-4">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">
        <span>{label}</span>
        {Icon && <Icon className="h-3 w-3 text-site-primary" />}
      </div>
      <div className={`mt-2 font-display text-[22px] font-medium tracking-tight ${accent ? "site-text-gradient-primary" : "text-site-fg"}`}>
        {value}
      </div>
    </div>
  );
}

function PanelHead({ title, meta }: { title: string; meta?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-display text-[13px] font-medium text-site-fg">{title}</span>
      {meta}
    </div>
  );
}

function Bars() {
  const values = [40, 62, 48, 70, 55, 30, 44];
  return (
    <div className="mt-4 flex h-32 items-end gap-2">
      {values.map((v, i) => (
        <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-site-primary/25 to-site-primary/80" style={{ height: `${v}%` }} />
      ))}
    </div>
  );
}

function Bubble({ side, ai, typing, children }: { side: "in" | "out"; ai?: boolean; typing?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
        side === "out"
          ? "ml-auto rounded-tr-sm bg-site-primary/15 text-site-fg ring-1 ring-site-primary/25"
          : "rounded-tl-sm bg-white/[0.05] text-site-fg/90 ring-1 ring-white/6"
      } ${typing ? "opacity-70" : ""}`}
    >
      {children}
      {ai && !typing && null}
    </div>
  );
}
