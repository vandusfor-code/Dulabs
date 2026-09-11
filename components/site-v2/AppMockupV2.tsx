import {
  MessageSquare,
  Users,
  Zap,
  Megaphone,
  BarChart3,
  Puzzle,
  Phone,
  MoreVertical,
  Search,
  Paperclip,
  Send,
  CheckCheck,
  Globe,
} from "lucide-react";

/**
 * Mockup del producto DuLabs (inbox / CRM conversacional) — reconstrucción
 * fiel de la referencia: sidebar + lista de conversaciones + chat.
 * Los datos son ILUSTRATIVOS (demo de producto, no claims reales), igual que
 * cualquier captura de UI. Ancho base fijo (860px) — el contenedor lo escala.
 */

type Channel = "whatsapp" | "instagram" | "web";

const NAV = [
  { icon: MessageSquare, label: "Conversaciones", active: true },
  { icon: Users, label: "Contactos" },
  { icon: Zap, label: "Automatizaciones" },
  { icon: Megaphone, label: "Campañas" },
  { icon: BarChart3, label: "Analítica" },
  { icon: Puzzle, label: "Integraciones" },
];

const CONVERSATIONS: {
  name: string;
  preview: string;
  time: string;
  channel: Channel;
  initials: string;
  active?: boolean;
}[] = [
  { name: "Clínica Vida", preview: "Hola, ¿tienen disponibilidad…", time: "11:24", channel: "whatsapp", initials: "CV", active: true },
  { name: "Carlos Méndez", preview: "Quisiera más información…", time: "10:17", channel: "instagram", initials: "CM" },
  { name: "Inmobiliaria Torres", preview: "Perfecto, muchas gracias.", time: "Ayer", channel: "whatsapp", initials: "IT" },
  { name: "Laura Martínez", preview: "¿Pueden agendar una demo?", time: "Ayer", channel: "web", initials: "LM" },
  { name: "TechSolutions", preview: "Gracias por la información.", time: "Lun", channel: "whatsapp", initials: "TS" },
];

function ChannelBadge({ channel }: { channel: Channel }) {
  if (channel === "whatsapp") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#25D366]">
        <MessageSquare className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
      </span>
    );
  }
  if (channel === "instagram") {
    return (
      <span className="h-4 w-4 rounded-full bg-[linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)]" />
    );
  }
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sitev2-fg">
      <Globe className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
    </span>
  );
}

export function AppMockupV2() {
  return (
    <div className="v2-shadow-product flex h-[540px] w-[860px] overflow-hidden rounded-[16px] border border-sitev2-border bg-sitev2-bg text-left">
      {/* ---------------- Sidebar ---------------- */}
      <aside className="flex w-[176px] shrink-0 flex-col border-r border-sitev2-border bg-sitev2-surface/60 px-3 py-4">
        <div className="mb-6 flex items-center px-2">
          <span className="inline-flex items-baseline font-display text-[15px] font-semibold tracking-[-0.02em] text-sitev2-fg">
            duLabs
            <span className="ml-[2px] inline-block h-[4px] w-[4px] rounded-full bg-sitev2-primary" />
          </span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] ${
                item.active
                  ? "bg-sitev2-primary-soft font-medium text-sitev2-primary"
                  : "text-sitev2-muted-fg"
              }`}
            >
              <item.icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.9} />
              <span className="truncate">{item.label}</span>
            </div>
          ))}
        </nav>
      </aside>

      {/* ---------------- Lista de conversaciones ---------------- */}
      <section className="flex w-[288px] shrink-0 flex-col border-r border-sitev2-border">
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <h3 className="font-display text-[15px] font-semibold text-sitev2-fg">Conversaciones</h3>
        </div>
        <div className="flex items-center gap-4 border-b border-sitev2-border px-4 pb-2 text-[11.5px]">
          {["Todos", "WhatsApp", "Instagram", "Web"].map((t, i) => (
            <span
              key={t}
              className={`relative pb-1 ${
                i === 0 ? "font-medium text-sitev2-fg" : "text-sitev2-subtle-fg"
              }`}
            >
              {t}
              {i === 0 && <span className="absolute inset-x-0 -bottom-[9px] h-[2px] rounded-full bg-sitev2-primary" />}
            </span>
          ))}
        </div>
        <div className="flex-1 overflow-hidden">
          {CONVERSATIONS.map((c) => (
            <div
              key={c.name}
              className={`flex items-center gap-3 border-b border-sitev2-border px-4 py-3 ${
                c.active ? "bg-sitev2-surface" : ""
              }`}
            >
              <div className="relative shrink-0">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sitev2-surface-2 text-[11px] font-semibold text-sitev2-muted-fg">
                  {c.initials}
                </span>
                <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-sitev2-bg">
                  <ChannelBadge channel={c.channel} />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-medium text-sitev2-fg">{c.name}</span>
                  <span className="shrink-0 text-[10.5px] text-sitev2-subtle-fg">{c.time}</span>
                </div>
                <p className="truncate text-[11.5px] text-sitev2-muted-fg">{c.preview}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Chat ---------------- */}
      <section className="flex min-w-0 flex-1 flex-col bg-sitev2-surface/40">
        {/* Header del chat */}
        <div className="flex items-center justify-between border-b border-sitev2-border bg-sitev2-bg px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sitev2-surface-2 text-[10px] font-semibold text-sitev2-muted-fg">
              CV
            </span>
            <div className="leading-tight">
              <div className="text-[12.5px] font-medium text-sitev2-fg">Clínica Vida</div>
              <div className="flex items-center gap-1 text-[10.5px] text-sitev2-muted-fg">
                <span className="h-1.5 w-1.5 rounded-full bg-[#25D366]" /> En línea
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-sitev2-subtle-fg">
            <Phone className="h-[15px] w-[15px]" strokeWidth={1.9} />
            <MoreVertical className="h-[15px] w-[15px]" strokeWidth={1.9} />
          </div>
        </div>

        {/* Búsqueda */}
        <div className="border-b border-sitev2-border bg-sitev2-bg px-4 py-2">
          <div className="flex items-center gap-2 rounded-lg bg-sitev2-surface-2 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-sitev2-subtle-fg" strokeWidth={2} />
            <span className="text-[11px] text-sitev2-subtle-fg">Buscar…</span>
          </div>
        </div>

        {/* Mensajes */}
        <div className="flex flex-1 flex-col justify-end gap-3 px-5 py-4">
          <div className="max-w-[72%] self-start rounded-2xl rounded-tl-md bg-sitev2-bg px-3.5 py-2.5 text-[12px] leading-snug text-sitev2-fg shadow-[0_1px_2px_rgba(17,17,17,0.05)]">
            Hola, ¿tienen disponibilidad para agendar una cita?
          </div>
          <div className="max-w-[76%] self-end rounded-2xl rounded-tr-md bg-sitev2-fg px-3.5 py-2.5 text-[12px] leading-snug text-white">
            ¡Hola! Claro, con gusto te ayudo. ¿En qué horario te gustaría agendar tu cita?
            <div className="mt-1 flex items-center justify-end gap-1 text-[9.5px] text-white/60">
              11:25 <CheckCheck className="h-3 w-3" strokeWidth={2} />
            </div>
          </div>
          {/* Indicador de escribiendo */}
          <div className="flex items-center gap-1 self-start rounded-full bg-sitev2-bg px-3 py-2 shadow-[0_1px_2px_rgba(17,17,17,0.05)]">
            <span className="h-1.5 w-1.5 animate-site-pulse-glow rounded-full bg-sitev2-subtle-fg" />
            <span className="h-1.5 w-1.5 animate-site-pulse-glow rounded-full bg-sitev2-subtle-fg [animation-delay:0.2s]" />
            <span className="h-1.5 w-1.5 animate-site-pulse-glow rounded-full bg-sitev2-subtle-fg [animation-delay:0.4s]" />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-sitev2-border bg-sitev2-bg px-4 py-3">
          <div className="flex items-center gap-2 rounded-full border border-sitev2-border bg-sitev2-surface px-3 py-1.5">
            <Paperclip className="h-4 w-4 shrink-0 text-sitev2-subtle-fg" strokeWidth={1.9} />
            <span className="flex-1 text-[11.5px] text-sitev2-subtle-fg">Escribe un mensaje…</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sitev2-fg">
              <Send className="h-3.5 w-3.5 text-white" strokeWidth={2} />
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
