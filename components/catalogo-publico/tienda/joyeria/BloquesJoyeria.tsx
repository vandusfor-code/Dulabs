/**
 * Bloques nuevos del inicio del tema "joyeria" (inicio «como la referencia»): el video de la colección a pantalla completa, la franja de acabados y la marca con su tarjeta de video.
 * Server Components: el texto llega en el HTML; solo el video (y su botón) es de cliente. Cada bloque se dibuja SOLO si tiene lo que necesita: la franja sin acabados reales no existe.
 */
import { ArrowRight } from "lucide-react";
import { VideoSeccion } from "@/components/catalogo-publico/tienda/joyeria/VideoJoyeria";
import { ENLACE_TEXTO, EnlaceJoyeria } from "@/components/catalogo-publico/tienda/joyeria/piezas";
import type { AcabadoVisible, LineaVisible } from "@/lib/catalogo/joyeria";
import type { ColeccionJoyeria, MarcaJoyeria } from "@/lib/catalogo/vitrina";

/**
 * Colección: video a pantalla completa que sube sobre la portada («cortina»). El texto va a la izquierda sobre un velo que lo hace legible (AA medido por píxel sobre los fotogramas del
 * video), el botón lleva al catálogo y el botón del video queda abajo a la izquierda.
 */
export function ColeccionVideo({ coleccion, href }: { coleccion: ColeccionJoyeria; href: string }) {
  return (
    <section id="coleccion" aria-labelledby="joy-coleccion" className="joy-coleccion joy-ancla relative isolate flex h-[100svh] min-h-[34rem] items-center overflow-hidden bg-[var(--joy-espresso)]">
      <VideoSeccion video={coleccion.video} control="pildora" className="-z-20" />
      <div className="joy-coleccion-velo pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <div className="relative mx-auto w-full max-w-7xl px-6 sm:px-8 lg:px-10">
        <p className="text-[11px] font-medium uppercase tracking-[0.34em] text-white sm:text-xs">{coleccion.etiqueta}</p>
        <h2 id="joy-coleccion" className="font-serif-tienda mt-3 max-w-[15ch] text-[clamp(2.5rem,6.4vw,4.75rem)] font-medium leading-[1.04] tracking-tight text-[#faf8f5] md:max-w-[17ch]">
          {coleccion.titulo}
        </h2>
        <div className="mt-8">
          <EnlaceJoyeria href={href} className="joy-contorno-claro group inline-flex h-12 items-center justify-center gap-2 rounded-full px-7 text-[13px] font-medium uppercase tracking-[0.12em]">
            {coleccion.boton}
            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.7} aria-hidden />
          </EnlaceJoyeria>
        </div>
      </div>
    </section>
  );
}

/** Franja «Conoce nuestros acabados»: un título y una fila de opciones que llevan al listado filtrado por ese color. En el celular la fila se desliza. */
export function AcabadosJoyeria({ titulo, acabados }: { titulo: string; acabados: readonly AcabadoVisible[] }) {
  return (
    <section id="acabados" aria-labelledby="joy-acabados" className="joy-acabados joy-ancla">
      <h2 id="joy-acabados" className="joy-acabados-titulo">
        {titulo}
      </h2>
      <ul className="joy-acabados-lista tienda-scroll">
        {acabados.map((a) => (
          <li key={a.clave}>
            <EnlaceJoyeria href={a.href} className="joy-acabado">
              {a.etiqueta}
            </EnlaceJoyeria>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Franja «Nuestras líneas»: el primer nivel de la tienda (Plata, Rodio, Acero, Cover Gold…). Cada línea lleva a su listado, donde están las mismas categorías de siempre. Se dibuja con TODAS las líneas
 * de la configuración aunque alguna aún no tenga piezas: la estructura no depende de cuántas haya. Con dos columnas en el celular y cuatro desde la tableta, sin deslizar.
 */
export function FranjaLineas({ titulo, lineas }: { titulo: string; lineas: readonly LineaVisible[] }) {
  return (
    <section id="lineas" aria-labelledby="joy-lineas" className="joy-acabados joy-franja-lineas joy-ancla">
      <h2 id="joy-lineas" className="joy-acabados-titulo">
        {titulo}
      </h2>
      <ul className="joy-franja-lineas-lista">
        {lineas.map((l) => (
          <li key={l.clave}>
            <EnlaceJoyeria href={l.href} className="joy-franja-linea font-serif-tienda">
              {l.etiqueta}
            </EnlaceJoyeria>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** La marca: título, texto y enlace a un lado y, al otro, una tarjeta vertical con el video. */
export function MarcaVideo({ marca, href, fondo }: { marca: MarcaJoyeria; href: string; fondo: string }) {
  return (
    <section id="marca" aria-labelledby="joy-marca" className={`joy-ancla py-16 md:py-28 ${fondo}`}>
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 md:grid-cols-2 md:gap-16">
        <div className="md:order-1">
          <h2 id="joy-marca" className="font-serif-tienda text-[clamp(2.1rem,4.6vw,3.6rem)] font-medium leading-[1.08] text-fg">
            {marca.titulo}
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-mist md:text-[17px]">{marca.texto}</p>
          <EnlaceJoyeria href={href} className={`${ENLACE_TEXTO} mt-7`}>
            {marca.boton}
            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.7} aria-hidden />
          </EnlaceJoyeria>
        </div>
        <div className="joy-marca-tarjeta relative isolate mx-auto aspect-[4/5] w-full max-w-md overflow-hidden rounded-xl bg-[var(--joy-espresso)] md:order-2 md:max-w-none">
          <VideoSeccion video={marca.video} control="icono" />
        </div>
      </div>
    </section>
  );
}
