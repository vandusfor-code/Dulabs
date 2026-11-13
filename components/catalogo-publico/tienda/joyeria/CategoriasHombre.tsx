/**
 * Categorías del INICIO de hombre (Delacour · Vértice). La tienda de hombre puede tener una sola categoría (hoy «Dijes») o varias, y el bloque tiene que verse bien con cualquier cantidad: una tarjeta
 * gigante y vacía con una sola categoría, o una tira recortada con dos, se ven mal. Por eso se adapta:
 *  - UNA categoría: una tarjeta destacada dentro del ancho de la página (la foto grande a un lado, con su nombre y el botón al otro; la foto se funde hacia el texto, sin borde duro);
 *  - DE DOS A CUATRO: mosaicos cuadrados que llenan el ancho de la página;
 *  - MÁS: el mismo carrusel de siempre (las flechas solo existen si hay hacia dónde desplazarse).
 * Todas llevan al listado de HOMBRE de esa categoría (`?genero=hombre&categoria=`), nunca al de mujer. Las que tienen foto van primero. Sin categorías no se dibuja nada (lo decide quien lo usa).
 * Server Component salvo el carrusel (el de siempre): todo el texto llega en el HTML.
 */
import { ArrowRight } from "lucide-react";
import { EnlaceIntencion } from "@/components/catalogo-publico/tienda/EnlaceIntencion";
import { CarruselCategorias } from "@/components/catalogo-publico/tienda/joyeria/CarruselCategorias";
import { EnlaceJoyeria, indice } from "@/components/catalogo-publico/tienda/joyeria/piezas";
import { SIN_FILTROS, urlFiltros } from "@/lib/catalogo/filtros";
import type { PublicHome } from "@/lib/catalogo/service";

type Categoria = PublicHome["categories"][number];

const CONTENEDOR = "mx-auto max-w-7xl px-4 sm:px-6 lg:px-8";
/** Hasta cuántas categorías se dibujan como mosaicos; con más se desliza. */
export const MOSAICOS_MAX = 4;

/** La foto GRANDE (900×1200) de la misma pieza de la miniatura (400×400): en una tarjeta grande la miniatura se vería borrosa. Sin foto, null. */
export function fotoGrande(miniatura: string | null): string | null {
  return miniatura ? miniatura.replace("thumb.webp", "detail.webp") : null;
}

function Inicial({ nombre }: { nombre: string }) {
  return (
    <span className="joy-hm-inicial font-serif-tienda" aria-hidden>
      {nombre.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Una sola categoría: tarjeta destacada. */
function CategoriaDestacada({ c, href }: { c: Categoria; href: string }) {
  const foto = fotoGrande(c.coverUrl);
  return (
    <EnlaceIntencion href={href} className="joy-hm-destacada group">
      <span className="joy-hm-destacada-foto">
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element -- foto pública ya optimizada (WebP) de la pieza; la tarjeta es de tamaño fijo y la foto se carga al acercarse
          <img src={foto} alt="" loading="lazy" decoding="async" width={900} height={1200} className="joy-cat-foto size-full object-cover" />
        ) : (
          <Inicial nombre={c.name} />
        )}
      </span>
      <span className="joy-hm-destacada-texto">
        <span className="joy-hm-eyebrow">Categoría</span>
        <h2 id="joy-categorias" className="joy-hm-destacada-titulo font-serif-tienda">
          {c.name}
        </h2>
        <span className="joy-hm-trazo" aria-hidden />
        <span className="joy-hm-destacada-boton">
          Ver la categoría
          <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.7} aria-hidden />
        </span>
      </span>
    </EnlaceIntencion>
  );
}

/** De dos a cuatro categorías: mosaicos cuadrados. */
function Mosaicos({ categorias, basePath }: { categorias: readonly Categoria[]; basePath: string }) {
  return (
    <ul className="joy-hm-mosaico" data-n={categorias.length}>
      {categorias.map((c, i) => {
        // Con dos, cada mosaico es muy ancho: la foto grande evita que se vea borrosa.
        const foto = categorias.length === 2 ? fotoGrande(c.coverUrl) : c.coverUrl;
        return (
          <li key={c.id} className="joy-item" style={indice(i)}>
            <EnlaceIntencion href={enlaceDeCategoria(basePath, c)} className="joy-hm-mosaico-item group">
              {foto ? (
                // eslint-disable-next-line @next/next/no-img-element -- miniatura pública ya optimizada (WebP) del catálogo
                <img src={foto} alt="" loading="lazy" decoding="async" width={categorias.length === 2 ? 900 : 400} height={categorias.length === 2 ? 1200 : 400} className="joy-cat-foto size-full object-cover" />
              ) : (
                <Inicial nombre={c.name} />
              )}
              <span className="joy-hm-mosaico-velo" aria-hidden />
              <span className="joy-hm-mosaico-rotulo">
                <span className="text-xs tracking-[0.04em] text-white/80">Categoría</span>
                <span className="line-clamp-2 text-[19px] font-medium uppercase leading-tight tracking-[0.04em] text-white">{c.name}</span>
              </span>
            </EnlaceIntencion>
          </li>
        );
      })}
    </ul>
  );
}

/** Dirección del listado de HOMBRE de una categoría. */
export function enlaceDeCategoria(basePath: string, c: Pick<Categoria, "id">): string {
  return urlFiltros(basePath, { ...SIN_FILTROS, genero: "hombre", categorias: [c.id] });
}

export function CategoriasHombre({ categorias: todas, basePath, listPath }: { categorias: PublicHome["categories"]; basePath: string; listPath: string }) {
  if (todas.length === 0) return null;
  // Las que tienen foto primero, cada grupo en su orden de siempre.
  const categorias = [...todas].sort((a, b) => Number(Boolean(b.coverUrl)) - Number(Boolean(a.coverUrl)));

  if (categorias.length === 1) {
    return (
      <section id="categorias" aria-labelledby="joy-categorias" className="joy-ancla joy-hm-seccion">
        <div className={CONTENEDOR}>
          <CategoriaDestacada c={categorias[0]} href={enlaceDeCategoria(basePath, categorias[0])} />
        </div>
      </section>
    );
  }

  return (
    <section id="categorias" aria-labelledby="joy-categorias" className="joy-ancla joy-hm-seccion">
      <div className={`${CONTENEDOR} joy-hm-encabezado`}>
        <h2 id="joy-categorias" className="font-serif-tienda text-[28px] font-medium uppercase leading-tight tracking-[0.04em] text-fg md:text-[34px]">
          Categorías
        </h2>
        <EnlaceJoyeria href={listPath} className="joy-enlace-subrayado inline-flex shrink-0 items-center gap-1.5 pb-1 text-sm text-fg">
          Ver todo
          <ArrowRight className="size-4" strokeWidth={1.7} aria-hidden />
        </EnlaceJoyeria>
      </div>
      {categorias.length <= MOSAICOS_MAX ? (
        <div className={CONTENEDOR}>
          <Mosaicos categorias={categorias} basePath={basePath} />
        </div>
      ) : (
        <CarruselCategorias categorias={categorias} basePath={basePath} genero="hombre" />
      )}
    </section>
  );
}
