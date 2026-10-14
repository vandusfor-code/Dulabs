/**
 * Piezas pequeñas y compartidas del tema "joyeria" (Server Components, sin estado): el enlace de la tienda, el encabezado de sección y los destellos decorativos.
 */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/** Enlace de la tienda: los internos con el router; los externos (WhatsApp) en pestaña nueva y sin enviar el origen. */
export function EnlaceJoyeria({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (href.startsWith("https://")) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/** Retardo de entrada (CSS) de un elemento de la portada: `--retardo` lo lee la clase `joy-ent`. */
export const retardo = (segundos: number) => ({ "--retardo": `${segundos}s` }) as CSSProperties;

/** Posición de una tarjeta en su fila (tope 7): la clase `joy-item` la usa para escalonar su aparición (70 ms por posición). */
export const indice = (i: number) => ({ "--i": Math.min(i, 7) }) as CSSProperties;

/** Etiqueta pequeña + título + filete dorado con rombo: el encabezado de cada sección del inicio. El título es siempre un h2 real. */
export function EncabezadoSeccion({ etiqueta, titulo, id, className = "" }: { etiqueta?: string; titulo: string; id?: string; className?: string }) {
  return (
    <div className={`mb-10 text-center md:mb-12 ${className}`}>
      {etiqueta && <p className="text-[11px] font-normal uppercase tracking-[0.3em] text-[var(--tienda-oro)]">{etiqueta}</p>}
      <h2 id={id} className="font-serif-tienda mt-2 text-[32px] font-medium leading-tight text-fg md:text-[42px]">
        {titulo}
      </h2>
      <div className="mx-auto mt-4 flex items-center justify-center gap-3" aria-hidden>
        <span className="h-px w-10 bg-[var(--joy-oro)]" />
        <span className="text-[10px] text-[var(--tienda-oro)]">◆</span>
        <span className="h-px w-10 bg-[var(--joy-oro)]" />
      </div>
    </div>
  );
}

/** Posiciones (arriba, izquierda, tamaño, retardo y duración) de los destellos: puntos dorados que flotan muy despacio. Los últimos cinco solo desde pantallas medianas. */
const DESTELLOS: ReadonlyArray<readonly [number, number, number, number, number, boolean]> = [
  [18, 12, 6, 0, 8, true],
  [28, 85, 5, 1.2, 7, true],
  [58, 8, 4, 2.4, 9, true],
  [68, 90, 7, 0.6, 6.5, true],
  [15, 45, 5, 3, 8.5, false],
  [40, 25, 4, 1.8, 7.5, false],
  [35, 72, 6, 0.3, 9.5, false],
  [75, 38, 5, 2.1, 6, false],
  [20, 62, 4, 4, 8, false],
  [62, 58, 6, 1.5, 7, false],
];

/** Destellos decorativos (solo con movimiento permitido: sin él no se dibujan). */
export function Destellos({ className = "" }: { className?: string }) {
  return (
    <div className={`joy-destellos pointer-events-none absolute inset-0 ${className}`} aria-hidden>
      {DESTELLOS.map(([arriba, izquierda, tam, retraso, duracion, siempre], i) => (
        <span
          key={i}
          className={`joy-destello absolute rounded-full ${siempre ? "" : "hidden sm:block"}`}
          style={{ top: `${arriba}%`, left: `${izquierda}%`, width: tam, height: tam, animationDelay: `${retraso}s`, animationDuration: `${duracion}s` }}
        />
      ))}
    </div>
  );
}
