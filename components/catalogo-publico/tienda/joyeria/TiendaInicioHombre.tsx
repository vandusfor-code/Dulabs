/**
 * INICIO del lado de HOMBRE de la tienda (Delacour · Vértice): la tienda de hombre dentro de la tienda, con la MISMA composición que el inicio de mujer pero con su diseño y su contenido: portada con
 * video, el video de la colección, las categorías, la marca con su tarjeta de video, los productos destacados y, al final, la invitación a compradores mayoristas. Es el orden del inicio de mujer
 * (portada → colección → categorías → marca → destacados → mayoristas); las líneas, «Para él» y los acabados son cosas del lado de mujer y aquí no van.
 *
 * Un solo lienzo grafito, sin franjas ni cortes planos al desplazarse: todos los bloques comparten el fondo de la página; la portada se funde hacia abajo con ella y los videos de la colección y de
 * los mayoristas entran y salen con un degradado (ver «INICIO DEL LADO DE HOMBRE» en globals.css). Reutiliza las piezas del inicio de mujer (tarjetas, video de la colección, bloque de marca, mayoristas,
 * botones flotantes) con los datos y la paleta de hombre (el CSS del «lado de hombre» las pinta de grafito y plata cuando la dirección dice `?genero=hombre`). Server Component: todo llega en el HTML.
 *
 * Nada inventado: un bloque sin datos NO se dibuja (sin categorías con piezas de hombre, sin destacados, sin video de colección o de marca, sin WhatsApp para los mayoristas). Los precios y la
 * disponibilidad los calcula el backend.
 */
import { ArrowRight } from "lucide-react";
import { Revelar } from "@/components/catalogo-publico/tienda/Revelar";
import { ColeccionVideo, MarcaVideo } from "@/components/catalogo-publico/tienda/joyeria/BloquesJoyeria";
import { CategoriasHombre } from "@/components/catalogo-publico/tienda/joyeria/CategoriasHombre";
import { FlotantesJoyeria } from "@/components/catalogo-publico/tienda/joyeria/FlotantesJoyeria";
import { HeroVertice } from "@/components/catalogo-publico/tienda/joyeria/HeroVertice";
import { TarjetaJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TarjetaJoyeria";
import { Mayoristas } from "@/components/catalogo-publico/tienda/joyeria/TiendaInicioJoyeria";
import { ENLACE_TEXTO, EncabezadoSeccion, EnlaceJoyeria, indice } from "@/components/catalogo-publico/tienda/joyeria/piezas";
import type { GeneroJoyeria } from "@/lib/catalogo/genero";
import type { MayoristasVisible } from "@/lib/catalogo/joyeria";
import type { PublicHome } from "@/lib/catalogo/service";
import type { ColeccionJoyeria, MarcaJoyeria, VideoAmbiente } from "@/lib/catalogo/vitrina";

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
  mayoristas,
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
  /** La invitación a compradores mayoristas: es de TODA la tienda (la misma del inicio de mujer, con su video); sin ella o sin WhatsApp no se dibuja. */
  mayoristas?: MayoristasVisible | null;
}) {
  const cfg = genero.hombre;
  const destacadosDelCms = home.featuredPolicy === "cms";
  return (
    <div className="joy-inicio-hombre">
      <HeroVertice config={cfg} href={listPath} video={video} />

      {coleccion && <ColeccionVideo coleccion={coleccion} href={listPath} suave />}

      {home.categories.length > 0 && (
        <Revelar>
          <CategoriasHombre categorias={home.categories} basePath={basePath} listPath={listPath} />
        </Revelar>
      )}

      {marca && (
        <Revelar>
          <MarcaVideo marca={marca} href={listPath} fondo="" />
        </Revelar>
      )}

      {home.featured.length > 0 && (
        <Revelar>
          <section id="destacados" aria-labelledby="joy-destacados" className="joy-ancla joy-hm-seccion">
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

      {mayoristas && (
        <Revelar>
          <Mayoristas m={mayoristas} suave />
        </Revelar>
      )}

      <FlotantesJoyeria whatsapp={whatsapp} />
    </div>
  );
}
