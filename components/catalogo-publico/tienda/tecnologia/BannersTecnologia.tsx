/**
 * Banners inferiores del tema "tecnologia": navy tecnológico, texto blanco, acento azul y el dibujo a la derecha. En el celular se deslizan en
 * horizontal; desde tablet van lado a lado. Cada banner lleva a una BÚSQUEDA REAL del catálogo (`consulta`), nunca a algo que no exista.
 * Server Component.
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ArteDeBanner } from "@/components/catalogo-publico/tienda/tecnologia/ArteDispositivos";
import { enlaceDeConsulta, type BannerVitrina } from "@/lib/catalogo/vitrina";

export function BannersTecnologia({ banners, basePath }: { banners: readonly BannerVitrina[]; basePath: string }) {
  if (banners.length === 0) return null;
  return (
    <section aria-label="Más para descubrir">
      <ul className="tienda-scroll -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0">
        {banners.map((b) => (
          <li key={b.consulta} className="w-[82%] shrink-0 snap-start sm:w-[58%] md:w-auto">
            <div className="tech-banner tech-oscuro relative isolate flex h-full min-h-[148px] overflow-hidden rounded-[20px] border border-white/10">
              <div className="relative z-10 flex max-w-[58%] flex-col justify-center gap-1 p-4">
                <p className="text-[19px] font-extrabold leading-none tracking-[-0.01em] text-white">{b.etiqueta}</p>
                <p className="mb-2 whitespace-pre-line text-[12.5px] leading-snug text-white/70">{b.titulo}</p>
                <Link
                  href={enlaceDeConsulta(basePath, b.consulta)}
                  className="inline-flex h-9 w-fit items-center gap-1.5 whitespace-nowrap rounded-xl bg-white pl-3.5 pr-3 text-[12.5px] font-bold text-[var(--tech-navy)] transition-transform duration-150 active:scale-95"
                >
                  {b.cta}
                  <ArrowRight className="size-3.5" strokeWidth={2.2} aria-hidden />
                </Link>
              </div>
              <ArteDeBanner arte={b.arte} className="pointer-events-none absolute -right-3 bottom-0 top-2 z-0 h-[92%] w-[56%] object-contain" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
