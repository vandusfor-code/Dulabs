/**
 * "Productos destacados" del tema "tecnologia": título fuerte, "Ver todo →" y un carrusel horizontal (nunca cuatro tarjetas apretadas: en el celular
 * se ve casi 1,9 tarjeta, con la siguiente asomando para invitar a deslizar). Los productos son los destacados REALES del catálogo (getHome: los más
 * recientes con foto). Sin productos, un mensaje honesto. Server Component.
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TarjetaTecnologia } from "@/components/catalogo-publico/tienda/tecnologia/TarjetaTecnologia";
import type { PublicHome } from "@/lib/catalogo/service";

export function DestacadosTecnologia({ home, basePath, listPath }: { home: PublicHome; basePath: string; listPath: string }) {
  return (
    <section aria-labelledby="tech-destacados">
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h2 id="tech-destacados" className="text-[23px] font-extrabold leading-none tracking-[-0.02em] text-fg">
          Productos destacados
        </h2>
        {home.featured.length > 0 && (
          <Link href={listPath} className="-mr-2 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[14px] font-semibold text-[var(--tienda-oro)] transition-colors hover:text-[var(--tienda-oro-hover)]">
            Ver todo
            <ArrowRight className="size-4" strokeWidth={2} aria-hidden />
          </Link>
        )}
      </div>
      {home.featured.length === 0 ? (
        <div className="rounded-[20px] border border-edge bg-[var(--tech-surface)] px-6 py-12 text-center">
          <p className="text-lg font-bold text-fg">Muy pronto, nuevos productos</p>
          <p className="mt-1 text-sm text-mist">Estamos preparando el catálogo. Vuelve en unos días.</p>
        </div>
      ) : (
        <ul className="tienda-scroll -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-3 md:mx-0 md:grid md:grid-cols-4 md:gap-5 md:overflow-visible md:px-0">
          {home.featured.map((p, i) => (
            <li key={p.reference} className="w-[52%] shrink-0 snap-start sm:w-[36%] md:w-auto">
              <TarjetaTecnologia product={p} basePath={basePath} posicion={i} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
