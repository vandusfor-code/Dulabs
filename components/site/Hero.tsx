import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CommandCenter } from "./CommandCenter";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-28 pb-16 md:pt-36 md:pb-24">
      <div className="pointer-events-none absolute inset-0 site-ambient-bg animate-site-ambient" />
      <div className="pointer-events-none absolute inset-0 site-mesh-bg opacity-40" />
      <div className="pointer-events-none absolute inset-0 site-grid-bg [mask-image:radial-gradient(ellipse_at_center_top,black_20%,transparent_75%)]" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-site-primary/10 blur-[140px]" />

      <div className="relative mx-auto max-w-[1280px] px-6">
        <div className="flex justify-center">
          <a
            href="#plataforma"
            className="group inline-flex items-center gap-2 rounded-full border border-site-border bg-white/[0.02] px-3 py-1 font-mono text-[10.5px] text-site-muted-fg backdrop-blur-md transition-all hover:border-site-primary/30 hover:text-site-fg"
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-site-primary/10 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-widest text-site-primary ring-1 ring-site-primary/25">
              API Oficial de Meta
            </span>
            <span className="uppercase tracking-widest">Modo coexistencia disponible</span>
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>

        <h1 className="mx-auto mt-8 max-w-5xl text-center font-display text-[42px] font-medium leading-[1.02] tracking-[-0.03em] text-site-fg md:text-[68px] lg:text-[76px]">
          <span className="site-text-gradient">La IA que atiende tu WhatsApp</span>
          <br />
          <span className="site-text-gradient-primary">sin arriesgar tu número.</span>
        </h1>

        <p className="mx-auto mt-7 max-w-2xl text-center text-[16px] leading-relaxed text-site-muted-fg md:text-[17px]">
          Du Labs conecta tu WhatsApp Business a la API Oficial de Meta. Tu asistente
          de IA responde 24/7 mientras tú sigues usando tu celular con normalidad —
          sin bloqueos, sin trucos, sin perder el control.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/business"
            className="group inline-flex h-11 items-center rounded-full bg-site-fg px-5 text-[13.5px] font-medium text-site-bg transition-all hover:bg-site-fg/90"
          >
            Activar mi API Oficial
            <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="#plataforma"
            className="group inline-flex h-11 items-center rounded-full border border-site-border bg-white/[0.02] px-5 text-[13.5px] font-medium text-site-fg backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/[0.04]"
          >
            <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-site-primary shadow-[0_0_8px_var(--color-site-primary)]" />
            Ver la plataforma
          </a>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em] text-site-muted-fg">
          <span>API Oficial de Meta</span>
          <span className="text-white/15">/</span>
          <span>0% riesgo de bloqueo</span>
          <span className="text-white/15">/</span>
          <span>Modo coexistencia</span>
          <span className="text-white/15">/</span>
          <span>Entrenado con Claude (Anthropic)</span>
        </div>

        <div id="plataforma" className="relative mt-16 md:mt-20 animate-site-fade-up">
          <CommandCenter />
        </div>
      </div>
    </section>
  );
}
