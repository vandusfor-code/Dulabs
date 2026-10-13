/**
 * Portada del tema "joyeria": la fotografía del negocio a pantalla completa, con el texto como HTML real (nunca dentro de la imagen) y el botón de siempre (si el CMS lo quitó,
 * no se dibuja). Es el fondo del encabezado transparente: el atributo `data-joy-hero` le dice al CSS que ahí hay portada.
 *
 * Composición: en el celular el texto va ARRIBA (bajo la cabecera) y la joya queda más abajo, sin que se tapen; desde pantallas medianas, a la izquierda y centrado en vertical.
 *
 * Movimiento (todo dentro de `prefers-reduced-motion: no-preference`, ver globals.css): entrada escalonada de los textos (28 px → 0, 0,6 s, +0,2 s entre uno y otro), brillo dorado
 * UNA vez sobre el título, el filete dorado que crece de 0 a 4 rem y destellos que flotan. El velo que oscurece la foto al desplazarse lo pone VeloHero.
 */
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { EnlaceJoyeria, Destellos, retardo } from "@/components/catalogo-publico/tienda/joyeria/piezas";
import type { heroOf } from "@/lib/catalogo/vitrina";

export function HeroJoyeria({ hero, listPath, fijo }: { hero: NonNullable<ReturnType<typeof heroOf>>; listPath: string; /** Portada fija arriba (la de siempre). Si el CMS la puso más abajo, es un bloque normal. */ fijo: boolean }) {
  return (
    <section
      {...(fijo ? { "data-joy-hero": "" } : {})}
      aria-label="Presentación"
      className={`joy-hero relative isolate flex w-full overflow-hidden bg-[var(--joy-espresso)] ${fijo ? "h-full" : "min-h-[70svh]"}`}
    >
      <Image
        src={hero.image.src}
        alt={hero.image.alt}
        fill
        preload={fijo}
        sizes="100vw"
        className="object-cover"
        style={{ objectPosition: hero.image.focus ?? "center" }}
      />
      {/* Velo cálido solo donde va el texto: la fotografía no se altera del otro lado. */}
      <div className="joy-hero-velo pointer-events-none absolute inset-0" aria-hidden />
      <Destellos className="z-10" />
      <div
        className={`relative z-20 mx-auto flex w-full max-w-7xl px-6 sm:px-8 lg:px-10 ${
          fijo
            ? "items-start pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-[calc(var(--joy-alto-barra)+var(--joy-alto-cab)+env(safe-area-inset-top)+2.25rem)] md:items-center md:pb-16 md:pt-[calc(var(--joy-alto-barra)+var(--joy-alto-cab)+env(safe-area-inset-top)+1rem)]"
            : "items-center py-20"
        }`}
      >
        <div className="max-w-[34rem]">
          {hero.eyebrow && (
            <p className="joy-ent text-[11px] font-medium uppercase tracking-[0.34em] text-white/90 sm:text-xs" style={retardo(0)}>
              {hero.eyebrow}
            </p>
          )}
          <h1 className="font-serif-tienda joy-ent mt-3 text-[clamp(2.5rem,7.2vw,5.25rem)] font-medium leading-[1.02] tracking-tight text-[#faf8f5]" style={retardo(0.15)}>
            <span className="joy-titulo-brillo">{hero.title}</span>
          </h1>
          {hero.description && (
            <p className="joy-ent mt-4 max-w-md text-base leading-relaxed text-white/90 sm:text-lg" style={retardo(0.35)}>
              {hero.description}
            </p>
          )}
          <div className="joy-linea mt-7 h-px bg-[var(--joy-oro)]" aria-hidden />
          {/* Un botón vacío = la portada no tiene botón (el CMS lo permite). */}
          {hero.cta !== "" && (
            <div className="joy-ent mt-8" style={retardo(0.75)}>
              <EnlaceJoyeria href={hero.href ?? listPath} className="joy-cristal inline-flex h-12 items-center justify-center gap-2 rounded-lg px-8 text-base font-medium tracking-[0.1em] active:scale-[0.98]">
                {hero.cta}
                <ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
              </EnlaceJoyeria>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
