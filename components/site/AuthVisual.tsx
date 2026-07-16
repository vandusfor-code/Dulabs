"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const conversaciones = [
  { name: "Peluquería Estilo", msg: "Turno confirmado · 5:30pm", time: "0.8s" },
  { name: "+57 300 ••• ••56", msg: "Precio del servicio enviado", time: "0.6s" },
  { name: "+57 310 ••• ••99", msg: "Plantilla de campaña entregada", time: "0.4s" },
  { name: "Peluquería Estilo", msg: "Handoff → dueño respondió", time: "0.3s" },
];

export function AuthVisual() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2200);
    return () => clearInterval(id);
  }, []);

  const visible = conversaciones.slice(0, 3).map((_, i) => conversaciones[(tick + i) % conversaciones.length]);

  return (
    <div className="relative hidden h-full w-full overflow-hidden bg-site-surface lg:block">
      <div className="pointer-events-none absolute inset-0 site-ambient-bg animate-site-ambient" />
      <div className="pointer-events-none absolute inset-0 site-grid-bg opacity-60" />
      <div className="pointer-events-none absolute -left-40 top-1/3 h-[520px] w-[520px] rounded-full bg-site-primary/10 blur-[120px]" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-[420px] w-[420px] rounded-full bg-site-primary-glow/10 blur-[120px]" />

      <div className="absolute left-10 top-8 z-10 flex items-center gap-2.5 font-display text-[14px] font-medium tracking-tight text-site-fg">
        <Image src="/logo.png" alt="Du Labs" width={24} height={24} className="rounded-full" />
        <span>Du Labs</span>
      </div>

      <div className="absolute left-10 bottom-10 z-10 max-w-md">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-site-muted-fg">
          IA para WhatsApp Business
        </p>
        <h2 className="mt-4 font-display text-[30px] leading-[1.08] tracking-tight site-text-gradient">
          Donde tu negocio ya <br /> responde de verdad.
        </h2>
        <div className="mt-6 flex items-center gap-4 text-[11px] text-site-muted-fg">
          <span className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 rounded-full bg-site-primary animate-site-ping-soft" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-site-primary" />
            </span>
            Todo funcionando con normalidad
          </span>
          <span className="h-3 w-px bg-white/10" />
          <span>API Oficial de Meta</span>
        </div>
      </div>

      <div className="absolute right-10 top-16 w-[300px] rounded-xl site-glass-strong p-4 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-site-primary animate-site-pulse-glow" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">Conversaciones en vivo</span>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {visible.map((c, i) => (
            <div key={`${tick}-${i}`} className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
              <div className="min-w-0">
                <div className="truncate text-[12px] text-site-fg">{c.msg}</div>
                <div className="mt-0.5 truncate font-mono text-[9.5px] uppercase tracking-wider text-site-muted-fg">{c.name}</div>
              </div>
              <span className="ml-3 rounded-full border border-site-primary/30 bg-site-primary/5 px-1.5 py-0.5 font-mono text-[9px] text-site-primary">{c.time}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute right-16 bottom-32 w-[220px] rounded-xl site-glass p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">Tiempo de respuesta</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-display text-[26px] font-medium tracking-tight text-site-fg">&lt;2s</span>
        </div>
        <div className="mt-3 flex h-10 items-end gap-1">
          {[40, 60, 45, 70, 55, 80, 65, 90, 72, 96, 82, 100].map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-sm bg-gradient-to-t from-site-primary/20 to-site-primary/70 animate-site-bar-rise"
              style={{ height: `${h}%`, animationDelay: `${i * 40}ms` }}
            />
          ))}
        </div>
      </div>

      <svg className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 opacity-30 animate-site-ring-spin" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="90" fill="none" stroke="var(--color-site-primary)" strokeOpacity="0.25" strokeDasharray="2 6" />
        <circle cx="100" cy="100" r="70" fill="none" stroke="white" strokeOpacity="0.06" />
        <circle cx="100" cy="100" r="50" fill="none" stroke="var(--color-site-primary)" strokeOpacity="0.18" strokeDasharray="1 4" />
      </svg>
    </div>
  );
}
