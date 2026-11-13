/**
 * Portada del INICIO del lado de hombre (Delacour · Vértice): a pantalla completa, en grafito y acero, con el rótulo de la colección (casa, trazo, antetítulo, el nombre grande, el lema), su texto y el
 * botón al listado. Es la portada GRÁFICA de la colección (sin foto de modelo: no hay una, y el texto nunca va dentro de una imagen); si la administradora sube un video para este espacio
 * (`video`), se dibuja detrás del texto con el mismo velo que lo hace legible, igual que el video de la colección del lado de mujer. Server Component: el texto llega en el HTML.
 */
import { ArrowRight } from "lucide-react";
import { VideoSeccion } from "@/components/catalogo-publico/tienda/joyeria/VideoJoyeria";
import { EnlaceJoyeria } from "@/components/catalogo-publico/tienda/joyeria/piezas";
import type { GeneroJoyeria } from "@/lib/catalogo/genero";
import type { VideoAmbiente } from "@/lib/catalogo/vitrina";

export function HeroVertice({ config, href, video }: { config: GeneroJoyeria["hombre"]; href: string; video?: VideoAmbiente }) {
  const e = config.entrada;
  return (
    <section data-joy-hero-hombre="" aria-labelledby="joy-hv-titulo" className="joy-hv">
      {video && <VideoSeccion video={video} control="pildora" className="-z-20" />}
      <div className="joy-hv-velo" aria-hidden />
      <div className="joy-hv-interior">
        <p className="joy-vertice-casa">{config.casa}</p>
        <span className="joy-vertice-trazo" aria-hidden />
        <p className="joy-vertice-antetitulo">{config.antetitulo}</p>
        <h1 id="joy-hv-titulo" className="joy-vertice-titulo joy-hv-titulo">
          {config.marca}
        </h1>
        <p className="joy-vertice-lema">{config.lema}</p>
        <p className="joy-vertice-parrafo">{e.texto}</p>
        <EnlaceJoyeria href={href} className="joy-vertice-boton group">
          {e.boton}
          <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.7} aria-hidden />
        </EnlaceJoyeria>
      </div>
    </section>
  );
}
