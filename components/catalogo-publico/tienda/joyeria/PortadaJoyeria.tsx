"use client";

/**
 * Portada del tema "joyeria" CON video: un carrusel de dos diapositivas a pantalla completa. La primera es el video, con el texto de siempre de la portada (el del CMS); la segunda, la
 * fotografía de la tienda con la firma de la marca. Cambia sola cada 5,1 s (lo medido en la referencia) con un fundido, y se detiene al pasar el mouse o enfocar un control, con el botón de
 * pausa, con «movimiento reducido» o «ahorro de datos» y mientras el contenido que sube sobre ella la tapa. Las flechas y los puntos cambian de diapositiva a mano.
 *
 * Mantiene lo de la portada sin video (HeroJoyeria): `data-joy-hero` (el cromo se vuelve transparente sobre ella), el velo que hace legible el texto, los destellos y la entrada escalonada del
 * texto (que se repite cada vez que una diapositiva se activa). El texto sigue siendo HTML real. Es solo la portada FIJA de arriba: más abajo la portada es la de siempre.
 *
 * Lectores de pantalla: el h1 de la página va FUERA de las diapositivas (en texto solo para lectores, con el título del CMS): una diapositiva oculta no se expone, y la página no puede quedarse sin su
 * título principal cada vez que cambia. Y cuando el contenido que sube sobre la portada la tapa por completo, sus controles quedan inertes (no se puede enfocar lo que no se ve).
 */
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TextoPortada, type DatosPortada } from "@/components/catalogo-publico/tienda/joyeria/HeroJoyeria";
import { BotonReproduccion, VideoAmbienteJoyeria, useMovimientoAutomatico } from "@/components/catalogo-publico/tienda/joyeria/VideoJoyeria";
import { Destellos } from "@/components/catalogo-publico/tienda/joyeria/piezas";
import type { VideoAmbiente } from "@/lib/catalogo/vitrina";

/** De una diapositiva a la siguiente pasan 5,1 s (medido en la referencia). */
export const INTERVALO_PORTADA_MS = 5100;
const TOTAL = 2;

export function PortadaJoyeria({ hero, listPath, video, marca }: { hero: DatosPortada; listPath: string; video: VideoAmbiente; marca: { name: string; descriptor?: string } }) {
  const permitido = useMovimientoAutomatico();
  const [activa, setActiva] = useState(0);
  // null = el visitante no ha tocado el botón de pausa: manda el permiso de movimiento (movimiento reducido o ahorro de datos = quieto).
  const [eleccion, setEleccion] = useState<boolean | null>(null);
  const [encima, setEncima] = useState(false);
  const [enfocada, setEnfocada] = useState(false);
  const [tapada, setTapada] = useState(false);
  const corriendo = eleccion ?? permitido;
  const rotando = corriendo && !encima && !enfocada && !tapada;
  const href = hero.href ?? listPath;

  // ¿El contenido que sube sobre la portada ya la tapó por completo? Entonces no hay por qué mover nada (ni el video ni las diapositivas). Se mide en un fotograma, nunca en cada evento.
  useEffect(() => {
    let cuadro = 0;
    const medir = () => {
      cuadro = 0;
      setTapada(window.scrollY > window.innerHeight * 0.95);
    };
    const alMover = () => {
      if (!cuadro) cuadro = window.requestAnimationFrame(medir);
    };
    alMover();
    window.addEventListener("scroll", alMover, { passive: true });
    window.addEventListener("resize", alMover);
    return () => {
      window.removeEventListener("scroll", alMover);
      window.removeEventListener("resize", alMover);
      if (cuadro) window.cancelAnimationFrame(cuadro);
    };
  }, []);

  // El temporizador se reinicia con cada cambio (también con los manuales): quien eligió una diapositiva la ve completa.
  useEffect(() => {
    if (!rotando) return;
    const id = window.setTimeout(() => setActiva((i) => (i + 1) % TOTAL), INTERVALO_PORTADA_MS);
    return () => window.clearTimeout(id);
  }, [rotando, activa]);

  const ir = useCallback((delta: number) => setActiva((i) => (i + delta + TOTAL) % TOTAL), []);
  const fallo = useCallback(() => setEleccion(false), []);

  return (
    <section
      data-joy-hero=""
      aria-roledescription="carrusel"
      aria-label="Presentación"
      className="joy-hero joy-portada relative isolate flex h-full w-full overflow-hidden bg-[var(--joy-espresso)]"
      onMouseEnter={() => setEncima(true)}
      onMouseLeave={() => setEncima(false)}
      onFocus={() => setEnfocada(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setEnfocada(false);
      }}
    >
      <h1 className="sr-only">{hero.title}</h1>
      {/* Todo lo que se mueve o se toca queda inerte mientras la «cortina» tapa la portada (el h1 de arriba, no). */}
      <div className="contents" inert={tapada}>
        <div className="contents" aria-live={rotando ? "off" : "polite"}>
          <div className="joy-slide" data-activa={activa === 0} role="group" aria-roledescription="diapositiva" aria-label={`1 de ${TOTAL}`} inert={activa !== 0}>
            <VideoAmbienteJoyeria video={video} reproducir={corriendo && activa === 0 && !tapada} carga="pronto" alFallar={fallo} className="z-0" />
            <div className="joy-hero-velo pointer-events-none absolute inset-0" aria-hidden />
            <Destellos className="z-10" />
            <TextoPortada eyebrow={hero.eyebrow} titulo={hero.title} descripcion={hero.description} cta={hero.cta} href={href} fijo nivel="p" tituloOculto />
          </div>
          <div className="joy-slide" data-activa={activa === 1} role="group" aria-roledescription="diapositiva" aria-label={`2 de ${TOTAL}`} inert={activa !== 1}>
            <Image
              src={hero.image.src}
              alt={hero.image.alt}
              fill
              sizes="100vw"
              className="joy-zoom object-cover"
              style={{ objectPosition: hero.image.focus ?? "center", transformOrigin: hero.image.focus ?? "center" }}
            />
            <div className="joy-hero-velo joy-hero-velo-foto pointer-events-none absolute inset-0" aria-hidden />
            <Destellos className="z-10" />
            <TextoPortada eyebrow={marca.descriptor} titulo={marca.name} cta={hero.cta} href={href} fijo nivel="p" marca />
          </div>
        </div>

        <button type="button" className="joy-portada-flecha joy-portada-flecha-izq" aria-label="Diapositiva anterior" onClick={() => ir(-1)}>
          <ChevronLeft className="size-5" strokeWidth={1.6} aria-hidden />
        </button>
        <button type="button" className="joy-portada-flecha joy-portada-flecha-der" aria-label="Diapositiva siguiente" onClick={() => ir(1)}>
          <ChevronRight className="size-5" strokeWidth={1.6} aria-hidden />
        </button>
        <div className="joy-portada-barra">
          <BotonReproduccion reproduciendo={corriendo} etiqueta="La presentación" alAlternar={() => setEleccion(!corriendo)} className="joy-portada-pausa" />
          <div className="joy-portada-puntos" role="group" aria-label="Elegir diapositiva">
            {Array.from({ length: TOTAL }, (_, i) => (
              <button key={i} type="button" className="joy-portada-punto" data-activo={activa === i} aria-label={`Ir a la diapositiva ${i + 1}`} aria-current={activa === i ? "true" : undefined} onClick={() => setActiva(i)} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
