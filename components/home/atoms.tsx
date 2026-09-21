import type { ReactNode } from "react";

// Piezas de maquetación propias de la home (servidor, sin JS). Los encabezados de components/site/Sections son cliente + bilingües + estilo
// lima del sitio anterior; aquí se usan los tokens de .dev-scope/.home-scope.
//
// ANCHOS: la home usa un contenedor FLUIDO (clases .hx* de globals.css) en lugar de un max-width fijo pequeño: ocupa ~92 % del viewport con
// márgenes cómodos y solo se detiene en un tope alto. Cada tipo de contenido tiene el suyo:
//   "hero" -> hero y navbar (el más amplio, 1600 px)   "grid" -> rejillas y mockups (1500 px)   "read" -> lectura (FAQ, 1120 px)

export type Ancho = "hero" | "grid" | "read";

export function Contenedor({ ancho = "grid", className = "", children }: { ancho?: Ancho; className?: string; children: ReactNode }) {
  return <div className={`hx hx-${ancho} ${className}`}>{children}</div>;
}

export function HomeSection({
  id,
  titleId,
  children,
  className = "",
  ancho = "grid",
}: {
  id: string;
  titleId: string;
  children: ReactNode;
  className?: string;
  ancho?: Ancho;
}) {
  return (
    <section id={id} aria-labelledby={titleId} className={`relative scroll-mt-16 border-t border-site-border ${className}`}>
      <Contenedor ancho={ancho} className="py-16 md:py-20 2xl:py-24">
        {children}
      </Contenedor>
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
        <span aria-hidden className="h-px w-5 bg-white/30" />
        {eyebrow}
      </p>
      <h2 id={titleId} className="mt-5 text-balance text-[30px] font-medium leading-[1.08] tracking-[-0.03em] text-site-fg sm:text-[38px] lg:text-[44px] 2xl:text-[50px]">
        {title}
      </h2>
      {children ? <div className="mt-5 max-w-[40rem] text-[16px] leading-[1.65] text-site-muted-fg md:text-[17px]">{children}</div> : null}
    </header>
  );
}

const TONOS = {
  muted: "border-site-border text-site-muted-fg",
  light: "border-white/25 text-site-fg",
} as const;

export function Tag({ tono = "muted", children }: { tono?: keyof typeof TONOS; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none tracking-[0.12em] ${TONOS[tono]}`}>{children}</span>;
}

export function Caption({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`mt-4 font-mono text-[11px] leading-relaxed text-site-muted-fg ${className}`}>{children}</p>;
}

/** Enlace de texto con flecha (los destinos van en <TrackedLink>; este es solo el aspecto). */
export const ENLACE_FLECHA = "group/enlace inline-flex min-h-11 items-center gap-1.5 text-[14px] text-site-fg underline-offset-4 hover:underline";
export const BOTON_PRIMARIO =
  "inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-dev-accent px-6 text-[14.5px] font-medium text-dev-accent-fg transition-colors hover:bg-dev-accent-hover";
export const BOTON_SECUNDARIO =
  "inline-flex h-12 items-center justify-center rounded-lg border border-site-border bg-site-card px-6 text-[14.5px] font-medium text-site-fg transition-colors hover:border-white/25";
