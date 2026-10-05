/**
 * Hero del tema "tecnologia": navy a azul eléctrico, título en dos líneas (la segunda en cian), CTA y dispositivos a la derecha.
 * Los dispositivos son el render real del negocio (`hero.imagen`, PNG/WebP transparente) o, si aún no lo subió, el dibujo decorativo.
 * Los puntos de abajo son decorativos: el contenedor ya está pensado como carrusel (cada slide es un bloque), pero hoy hay un solo slide.
 * El texto es HTML real (nunca va dentro de la imagen). Server Component.
 */
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ArteHero } from "@/components/catalogo-publico/tienda/tecnologia/ArteDispositivos";
import type { HeroTecnologia as Hero } from "@/lib/catalogo/vitrina";

export function HeroTecnologia({ hero, listPath }: { hero: Hero; listPath: string }) {
  return (
    <section aria-label="Promoción principal" className="tienda-hero-entrada relative z-10 -mt-[104px]">
      {/* aspect mínimo (no fijo): si el texto es más grande (fuentes grandes, 320 px) la tarjeta crece en vez de recortarlo. */}
      <div className="tech-hero tech-oscuro relative isolate flex min-h-[236px] overflow-hidden rounded-[22px] border border-white/10 shadow-[0_18px_40px_-18px_rgba(6,26,53,0.55)]">
        <div className="relative z-10 flex max-w-[66%] flex-col justify-center gap-2 px-5 pb-9 pt-5 min-[390px]:max-w-[62%]">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.3em] text-white/60">{hero.etiqueta}</p>
          <h1 className="text-[clamp(26px,7.8vw,36px)] font-extrabold leading-[1.02] tracking-[-0.02em] text-white">
            <span className="block">{hero.lineas[0]}</span>
            <span className="block text-[var(--tech-cyan)]">{hero.lineas[1]}</span>
          </h1>
          <p className="max-w-[15.5rem] text-[13px] leading-snug text-white/75">{hero.descripcion}</p>
          <Link
            href={listPath}
            className="mt-1 inline-flex h-11 w-fit items-center gap-2 whitespace-nowrap rounded-[14px] bg-[var(--tech-blue)] pl-5 pr-4 text-[15px] font-bold text-white shadow-[0_10px_22px_-8px_rgba(8,124,255,0.75)] transition-[background-color,transform] duration-150 hover:bg-[var(--tech-blue-bright)] active:scale-[0.97]"
          >
            {hero.cta}
            <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
          </Link>
        </div>

        <div className="pointer-events-none absolute -right-4 bottom-4 top-2 z-0 w-[64%] min-[390px]:-right-3 min-[390px]:w-[60%]">
          {hero.imagen ? (
            <Image
              src={hero.imagen.src}
              alt={hero.imagen.alt}
              width={hero.imagen.width}
              height={hero.imagen.height}
              preload
              sizes="(min-width: 768px) 420px, 62vw"
              className="size-full object-contain object-right-bottom"
            />
          ) : (
            <ArteHero className="size-full" />
          )}
        </div>

        <div className="absolute inset-x-0 bottom-3 z-10 flex items-center justify-center gap-1.5" aria-hidden>
          <span className="size-1.5 rounded-full bg-white/35" />
          <span className="h-1.5 w-5 rounded-full bg-white" />
          <span className="size-1.5 rounded-full bg-white/35" />
        </div>
      </div>
    </section>
  );
}
