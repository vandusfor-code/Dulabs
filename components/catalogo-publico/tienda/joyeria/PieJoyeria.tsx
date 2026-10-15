/**
 * Pie del tema "joyeria": nombre de la marca, su frase, los enlaces de la tienda (inicio, catálogo, categorías, mayoristas) y el contacto por WhatsApp. SOLO información que la tienda ya
 * tiene: no hay redes, dirección, políticas ni correos inventados. Server Component.
 */
import Link from "next/link";
import type { CatalogCategory } from "@/lib/catalogo/domain";
import { enlaceWhatsapp } from "@/lib/catalogo/joyeria";

const TITULO = "text-xs font-medium uppercase tracking-[0.2em] text-[var(--tienda-oro)]";
const ENLACE = "joy-enlace-pie rounded-sm text-sm text-fg transition-colors hover:text-[var(--tienda-oro)]";
/** Categorías que se listan en el pie (el resto, en «Ver todas»). */
const CATEGORIAS_EN_PIE = 6;

export function PieJoyeria({
  marca,
  basePath,
  listPath,
  categorias,
  whatsapp,
  descripcion,
  mayorista,
  mayoristaHref,
}: {
  marca: { name: string; descriptor?: string };
  basePath: string;
  listPath: string;
  categorias: CatalogCategory[];
  whatsapp: string | null;
  descripcion?: string;
  /** Hay mayoristas que mostrar (el enlace «Mayoristas» aparece). */
  mayorista: boolean;
  /** A dónde lleva el enlace: la página propia o, sin ella, el bloque del inicio (`#mayoristas`, como siempre). */
  mayoristaHref?: string;
}) {
  const wa = enlaceWhatsapp(whatsapp);
  return (
    <footer className="joy-pie bg-ink-2 text-mist" aria-label="Pie de página">
      <div className="joy-filete" aria-hidden />
      <div className="mx-auto max-w-7xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-12 sm:px-6 md:pb-12 lg:px-8 lg:pt-14">
        <div className="flex flex-col items-center text-center">
          <span className="font-serif-tienda text-3xl font-semibold uppercase tracking-[0.16em] text-fg sm:text-4xl">{marca.name}</span>
          {marca.descriptor && <span className="mt-2 text-[10px] font-medium uppercase tracking-[0.4em] text-[var(--tienda-oro)] sm:text-xs">{marca.descriptor}</span>}
          {descripcion && <p className="mt-4 max-w-md text-sm leading-relaxed text-mist">{descripcion}</p>}
        </div>

        <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-edge pt-8 sm:grid-cols-3">
          <div className="space-y-3">
            <h2 className={TITULO}>Navegar</h2>
            <ul className="space-y-2" role="list">
              <li>
                <Link href={basePath} className={ENLACE}>
                  Inicio
                </Link>
              </li>
              <li>
                <Link href={listPath} className={ENLACE}>
                  Todo el catálogo
                </Link>
              </li>
              {mayorista && (
                <li>
                  <Link href={mayoristaHref ?? `${basePath}#mayoristas`} className={ENLACE}>
                    Mayoristas
                  </Link>
                </li>
              )}
            </ul>
          </div>

          {categorias.length > 0 && (
            <div className="space-y-3">
              <h2 className={TITULO}>Categorías</h2>
              <ul className="space-y-2" role="list">
                {categorias.slice(0, CATEGORIAS_EN_PIE).map((c) => (
                  <li key={c.id}>
                    <Link href={`${basePath}?categoria=${encodeURIComponent(c.id)}`} className={ENLACE}>
                      {c.name}
                    </Link>
                  </li>
                ))}
                {categorias.length > CATEGORIAS_EN_PIE && (
                  <li>
                    <Link href={`${basePath}#categorias`} className={ENLACE}>
                      Ver todas
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          )}

          {wa && (
            <div className="col-span-2 space-y-3 sm:col-span-1">
              <h2 className={TITULO}>Contacto</h2>
              <ul className="space-y-2" role="list">
                <li>
                  <a href={wa} target="_blank" rel="noopener noreferrer" className={ENLACE}>
                    Escríbenos por WhatsApp
                  </a>
                </li>
              </ul>
            </div>
          )}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-edge pt-6 text-xs text-mist sm:flex-row">
          <p>
            © {new Date().getFullYear()} {marca.name}. Todos los derechos reservados.
          </p>
          <p>
            Catálogo creado con{" "}
            <a href="https://www.dulabs.co" className="text-fg underline underline-offset-4 hover:text-[var(--tienda-oro)]">
              DuLabs
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
