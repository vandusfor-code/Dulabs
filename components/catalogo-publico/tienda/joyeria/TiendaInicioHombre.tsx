/**
 * INICIO del lado de HOMBRE de la tienda (Delacour · Vértice): la tienda de hombre dentro de la tienda, con su propia portada, sus categorías, sus destacados y, cuando la administradora los sube, sus
 * videos (portada, colección y marca). Reutiliza las mismas piezas del inicio de mujer (carrusel de categorías, tarjetas, video de la colección, bloque de marca, botones flotantes) con los datos y la
 * paleta de hombre (el CSS de «Lado de hombre» las pinta de grafito y plata cuando la dirección dice `?genero=hombre`). Server Component: todo llega en el HTML.
 *
 * Nada inventado: un bloque sin datos NO se dibuja (sin categorías con piezas de hombre, sin destacados, sin video de colección o de marca). Los precios y la disponibilidad los calcula el backend.
 */
import { ArrowRight } from "lucide-react";
import { Revelar } from "@/components/catalogo-publico/tienda/Revelar";
import { ColeccionVideo, MarcaVideo } from "@/components/catalogo-publico/tienda/joyeria/BloquesJoyeria";
import { CarruselCategorias } from "@/components/catalogo-publico/tienda/joyeria/CarruselCategorias";
import { FlotantesJoyeria } from "@/components/catalogo-publico/tienda/joyeria/FlotantesJoyeria";
import { HeroVertice } from "@/components/catalogo-publico/tienda/joyeria/HeroVertice";
import { TarjetaJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TarjetaJoyeria";
import { ENLACE_TEXTO, EncabezadoSeccion, EnlaceJoyeria, indice } from "@/components/catalogo-publico/tienda/joyeria/piezas";
import type { GeneroJoyeria } from "@/lib/catalogo/genero";
import type { PublicHome } from "@/lib/catalogo/service";
import type { ColeccionJoyeria, MarcaJoyeria, VideoAmbiente } from "@/lib/catalogo/vitrina";

const BANDA = "joy-ancla py-16 md:py-24";
const CONTENEDOR = "mx-auto max-w-7xl px-4 sm:px-6 lg:px-8";

export function TiendaInicioHombre({
  home,
  genero,
  basePath,
  listPath,
  whatsapp,
  video,
  coleccion,
  marca,
}: {
  /** El inicio de hombre (`getHome(slug, { lado: "hombre" })`): destacados y categorías son solo de piezas de hombre. */
  home: PublicHome;
  genero: GeneroJoyeria;
  basePath: string;
  /** El listado completo de hombre (`?genero=hombre&todo=1`). */
  listPath: string;
  whatsapp: string | null;
  /** Video de la portada de hombre (si la administradora lo subió): va detrás del texto de la portada. */
  video?: VideoAmbiente;
  /** Video a pantalla completa de la colección de hombre (opcional). */
  coleccion?: ColeccionJoyeria;
  /** Texto y tarjeta de video de la marca de hombre (opcional). */
  marca?: MarcaJoyeria;
}) {
  const cfg = genero.hombre;
  const destacadosDelCms = home.featuredPolicy === "cms";
  return (
    <div className="joy-inicio-hombre">
      <HeroVertice config={cfg} href={listPath} video={video} />

      {home.categories.length > 0 && (
        <Revelar>
          <section id="categorias" aria-labelledby="joy-categorias" className="joy-ancla bg-ink pt-16 md:pt-24">
            <div className={`${CONTENEDOR} mb-8 flex items-end justify-between gap-4 md:mb-10`}>
              <h2 id="joy-categorias" className="font-serif-tienda text-[28px] font-medium uppercase leading-tight tracking-[0.04em] text-fg md:text-[34px]">
                Categorías
              </h2>
              <EnlaceJoyeria href={listPath} className="joy-enlace-subrayado inline-flex shrink-0 items-center gap-1.5 pb-1 text-sm text-fg">
                Ver todo
                <ArrowRight className="size-4" strokeWidth={1.7} aria-hidden />
              </EnlaceJoyeria>
            </div>
            <div className="pb-16 md:pb-24">
              <CarruselCategorias categorias={home.categories} basePath={basePath} genero="hombre" />
            </div>
          </section>
        </Revelar>
      )}

      {home.featured.length > 0 && (
        <Revelar>
          <section id="destacados" aria-labelledby="joy-destacados" className={`${BANDA} ${home.categories.length > 0 ? "bg-ink-2" : "bg-ink"}`}>
            <div className={CONTENEDOR}>
              <EncabezadoSeccion etiqueta={cfg.marca} titulo={destacadosDelCms ? "Piezas destacadas" : "Lo más nuevo"} id="joy-destacados" />
              <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
                {home.featured.map((p, i) => (
                  <li key={p.reference} className="joy-item" style={indice(i)}>
                    {/* Sin `posicion`: la portada ocupa toda la primera pantalla, las fotos de aquí abajo se cargan al acercarse. */}
                    <TarjetaJoyeria product={p} basePath={basePath} />
                  </li>
                ))}
              </ul>
              <div className="mt-12 text-center">
                <EnlaceJoyeria href={listPath} className={ENLACE_TEXTO}>
                  Ver toda la colección
                  <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.7} aria-hidden />
                </EnlaceJoyeria>
              </div>
            </div>
          </section>
        </Revelar>
      )}

      {coleccion && <ColeccionVideo coleccion={coleccion} href={listPath} />}

      {marca && (
        <Revelar>
          <MarcaVideo marca={marca} href={listPath} fondo="bg-ink" />
        </Revelar>
      )}

      <FlotantesJoyeria whatsapp={whatsapp} />
    </div>
  );
}
