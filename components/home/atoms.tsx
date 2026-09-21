import type { ReactNode } from "react";
import { InView } from "./InView";

// Piezas de maquetación propias de la home (servidor). Los encabezados de components/site/Sections son cliente + bilingües + estilo
// lima del sitio anterior; aquí se usan los tokens de .dev-scope/.home-scope y no se envía JS por un título.

export function HomeSection({ id, titleId, children, className = "" }: { id: string; titleId: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={titleId} className={`relative scroll-mt-16 border-t border-site-border ${className}`}>
      <InView className="mx-auto max-w-[1240px] px-5 py-20 sm:px-6 md:py-28">{children}</InView>
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  titleId,
  title,
  children,
  className = "",
}: {
  eyebrow: string;
  titleId: string;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={className}>
      <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-site-muted-fg">
        <span aria-hidden className="h-px w-5 bg-home-accent" />
        {eyebrow}
      </p>
      <h2 id={titleId} className="mt-5 text-balance text-[32px] font-medium leading-[1.06] tracking-[-0.03em] text-site-fg sm:text-[40px] lg:text-[46px]">
        {title}
      </h2>
      {children ? <div className="mt-5 max-w-[36rem] text-[16px] leading-[1.65] text-site-muted-fg md:text-[17px]">{children}</div> : null}
    </header>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-xl border border-site-border bg-site-card ${className}`}>{children}</div>;
}

export function PanelBar({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-site-border px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-site-muted-fg">{left}</div>
      {right ? <div className="shrink-0 font-mono text-[10.5px] text-site-muted-fg">{right}</div> : null}
    </div>
  );
}

export function Dots() {
  return (
    <span aria-hidden className="flex gap-1.5">
      <span className="size-2.5 rounded-full bg-site-border" />
      <span className="size-2.5 rounded-full bg-site-border" />
      <span className="size-2.5 rounded-full bg-site-border" />
    </span>
  );
}

const TONOS = {
  muted: "border-site-border text-site-muted-fg",
  light: "border-white/25 text-site-fg",
  accent: "border-home-accent-line bg-home-accent-soft text-home-accent",
} as const;

export function Tag({ tono = "muted", children }: { tono?: keyof typeof TONOS; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none tracking-[0.12em] ${TONOS[tono]}`}>{children}</span>;
}

export function Caption({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`mt-3 font-mono text-[11px] leading-relaxed text-site-muted-fg ${className}`}>{children}</p>;
}
