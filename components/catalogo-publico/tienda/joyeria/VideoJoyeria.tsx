"use client";

/**
 * Video ambiental del tema "joyeria" (portada, colección, marca y mayoristas): recorridos lentos por las fotos de las propias piezas de la tienda, sin sonido y en bucle.
 *
 * Reglas, todas para que el video sea un adorno y nunca un problema:
 *  - Nada se descarga antes de tiempo. Lo primero que se ve es la imagen fija (WebP pequeño, el primer fotograma); el archivo del video se pide cuando la página ya terminó de cargar y,
 *    salvo en la portada, el bloque está cerca de la pantalla. Un solo archivo por pantalla: el vertical si es más alta que ancha, el horizontal en las demás.
 *  - Corre únicamente mientras se ve: se pausa al salir de la pantalla y al cambiar de pestaña (y la portada, mientras la cubre el contenido que sube sobre ella).
 *  - Con «movimiento reducido» o «ahorro de datos» NO arranca solo (se queda la imagen fija); quien quiera lo inicia con el botón.
 *  - Siempre hay un botón de pausa/reproducción: el movimiento automático de más de cinco segundos debe poder detenerse (WCAG 2.2.2).
 *  - Si el navegador no deja arrancarlo (por ejemplo, el modo de bajo consumo de un iPhone), el botón queda en «Reproducir» y lo inicia quien lo toque.
 */
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Pause, Play } from "lucide-react";
import { useMedia, useMovimientoReducido } from "@/components/catalogo-publico/tienda/joyeria/medios";
import type { VideoAmbiente } from "@/lib/catalogo/vitrina";

type ConexionRed = { saveData?: boolean; effectiveType?: string; addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void };
const conexion = (): ConexionRed | undefined => (navigator as Navigator & { connection?: ConexionRed }).connection;

/** El navegador pidió ahorrar datos, o la conexión es muy lenta: el video no arranca solo. */
function useAhorroDatos(): boolean {
  return useSyncExternalStore(
    (aviso) => {
      const c = conexion();
      c?.addEventListener?.("change", aviso);
      return () => c?.removeEventListener?.("change", aviso);
    },
    () => {
      const c = conexion();
      return Boolean(c?.saveData) || c?.effectiveType === "slow-2g" || c?.effectiveType === "2g";
    },
    () => false,
  );
}

/** ¿Puede el video arrancar solo? No con «movimiento reducido» ni con ahorro de datos. */
export function useMovimientoAutomatico(): boolean {
  const reducido = useMovimientoReducido();
  const ahorro = useAhorroDatos();
  return !reducido && !ahorro;
}

/** ¿La pestaña está a la vista? */
function usePestanaVisible(): boolean {
  return useSyncExternalStore(
    (aviso) => {
      document.addEventListener("visibilitychange", aviso);
      return () => document.removeEventListener("visibilitychange", aviso);
    },
    () => !document.hidden,
    () => true,
  );
}

/** ¿La página terminó de cargar (evento load)? */
function usePaginaCargada(): boolean {
  return useSyncExternalStore(
    (aviso) => {
      window.addEventListener("load", aviso);
      return () => window.removeEventListener("load", aviso);
    },
    () => document.readyState === "complete",
    () => false,
  );
}

/** ¿El elemento está dentro de la pantalla (con un margen y un umbral de lo visible)? */
function useEnPantalla(ref: RefObject<HTMLElement | null>, margen: string, umbral: number): boolean {
  const [dentro, setDentro] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setDentro(e.isIntersecting), { rootMargin: margen, threshold: umbral });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margen, umbral]);
  return dentro;
}

/**
 * La imagen fija y, encima, el video. `reproducir` es la intención (la decide quien lo usa: el botón, la diapositiva activa, el permiso de movimiento); el video corre además solo si se
 * ve y la pestaña está a la vista. `carga`: "pronto" = al terminar de cargar la página (la portada); "cerca" = al acercarse a la pantalla. `alFallar`: el navegador no dejó arrancarlo.
 */
export function VideoAmbienteJoyeria({
  video,
  reproducir,
  carga,
  alFallar,
  className = "",
}: {
  video: VideoAmbiente;
  reproducir: boolean;
  carga: "pronto" | "cerca";
  alFallar?: () => void;
  className?: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const medio = useRef<HTMLVideoElement>(null);
  const alta = useMedia("(max-aspect-ratio: 1/1)");
  const archivo = alta && video.vertical ? video.vertical : video.horizontal;
  const cerca = useEnPantalla(caja, "300px 0px", 0);
  const visible = useEnPantalla(caja, "0px", 0.2);
  const cargada = usePaginaCargada();
  const pestana = usePestanaVisible();
  const [armado, setArmado] = useState(false);
  const [yaSono, setYaSono] = useState(false);

  // El archivo del video se pide la primera vez que hace falta y nunca mientras la página sigue cargando (estado derivado: se ajusta en el propio render, sin efecto).
  if (!armado && reproducir && cargada && (carga === "pronto" || cerca)) setArmado(true);

  const correr = armado && reproducir && visible && pestana;
  const fallo = useEffectEvent(() => alFallar?.());
  useEffect(() => {
    const v = medio.current;
    if (!v) return;
    if (!correr) {
      v.pause();
      return;
    }
    v.muted = true;
    v.play().catch(() => fallo());
  }, [correr, archivo.src]);

  return (
    <div ref={caja} className={`joy-video ${className}`} data-listo={yaSono ? "true" : "false"} aria-hidden>
      <picture>
        {video.vertical && <source media="(max-aspect-ratio: 1/1)" srcSet={video.vertical.poster} />}
        {/* Imagen fija ya optimizada (WebP del tamaño exacto del video) que cambia con la orientación de la pantalla: por eso un <img> dentro de <picture>, no next/image. */}
        <img
          src={video.horizontal.poster}
          alt=""
          width={video.horizontal.width}
          height={video.horizontal.height}
          decoding="async"
          loading={carga === "pronto" ? "eager" : "lazy"}
          fetchPriority={carga === "pronto" ? "high" : "auto"}
          className="joy-video-poster"
          style={video.foco ? { objectPosition: video.foco } : undefined}
        />
      </picture>
      {armado && (
        <video
          key={archivo.src}
          ref={medio}
          src={archivo.src}
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
          className="joy-video-medio"
          style={video.foco ? { objectPosition: video.foco } : undefined}
          onPlaying={() => setYaSono(true)}
        />
      )}
    </div>
  );
}

/** Botón de pausa/reproducción del video (su nombre dice qué video es). */
export function BotonReproduccion({ reproduciendo, etiqueta, alAlternar, className = "" }: { reproduciendo: boolean; etiqueta: string; alAlternar: () => void; className?: string }) {
  const nombre = etiqueta.charAt(0).toLowerCase() + etiqueta.slice(1);
  return (
    <button type="button" onClick={alAlternar} className={`joy-video-boton ${className}`} aria-label={`${reproduciendo ? "Pausar" : "Reproducir"} ${nombre}`}>
      {reproduciendo ? <Pause className="size-[18px]" strokeWidth={1.8} fill="currentColor" aria-hidden /> : <Play className="size-[18px]" strokeWidth={1.8} fill="currentColor" aria-hidden />}
    </button>
  );
}

/**
 * Un video con su botón, para un bloque de la página (colección, marca y mayoristas): el video llena el contenedor donde se pone (`className` lo posiciona) y el botón queda en una esquina
 * del bloque (el bloque debe ser `relative`). `control`: "pildora" (bloque de pantalla completa) o "icono" (tarjetas y fondos).
 */
export function VideoSeccion({
  video,
  control,
  className = "",
  children,
}: {
  video: VideoAmbiente;
  control: "pildora" | "icono";
  className?: string;
  children?: ReactNode;
}) {
  const permitido = useMovimientoAutomatico();
  // null = el visitante no ha tocado el botón: manda el permiso (movimiento reducido o ahorro de datos = quieto).
  const [eleccion, setEleccion] = useState<boolean | null>(null);
  const reproducir = eleccion ?? permitido;
  return (
    <>
      <VideoAmbienteJoyeria video={video} reproducir={reproducir} carga="cerca" alFallar={() => setEleccion(false)} className={className} />
      {children}
      <div className="joy-video-control" data-control={control}>
        <BotonReproduccion reproduciendo={reproducir} etiqueta={video.etiqueta} alAlternar={() => setEleccion(!reproducir)} />
      </div>
    </>
  );
}
