import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicCatalog } from "@/components/catalogo-publico/PublicCatalog";
import { TarjetaProducto } from "@/components/catalogo-publico/tienda/TarjetaProducto";
import { TiendaInicio } from "@/components/catalogo-publico/tienda/TiendaInicio";
import { ListadoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/ListadoJoyeria";
import { TarjetaJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TarjetaJoyeria";
import { TiendaInicioJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TiendaInicioJoyeria";
import { TiendaInicioTecnologia } from "@/components/catalogo-publico/tienda/tecnologia/TiendaInicioTecnologia";
import { SIN_FILTROS, hayFiltros, leerFiltros, textoDeFiltros } from "@/lib/catalogo/filtros";
import { esListado } from "@/lib/catalogo/inicio";
import { cargarAcabados, cargarCatalogoPublico, cargarInicio, cargarInicioElegido, cargarMultimediaTienda, cargarTienda, cargarVitrinaInicio, paginaDe, param } from "@/lib/catalogo/public-loader";
import { retailPath } from "@/lib/catalogo/publicacion";
import { lineasDeLaTienda, lineasVisibles } from "@/lib/catalogo/joyeria";
import { joyeriaOf, storefrontConfigFor, tecnologiaOf } from "@/lib/catalogo/vitrina";
import { aplicarCategorias, aplicarMultimedia } from "@/lib/cms-comercial/multimedia-tienda";

// Catálogo público con precios al DETAL: /catalogo/{slug}. Sin parámetros
// muestra el INICIO de la tienda; con búsqueda, categoría, página o ?todo=1,
// el LISTADO (paginado en el servidor: nunca se carga el catálogo completo).
type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const tienda = await cargarTienda(slug);
  if (!tienda) return { title: "Catálogo" };
  // La página de una línea (`?linea=plata`) se titula con la línea; una línea que el negocio no tiene no cambia nada.
  const claveLinea = param(sp.linea)?.toLowerCase();
  const nombreLinea = claveLinea ? lineasDeLaTienda(slug).find((l) => l.clave === claveLinea)?.etiqueta : undefined;
  return {
    title: nombreLinea ? `${nombreLinea} · ${tienda.publicName}` : `${tienda.publicName} · Catálogo`,
    description: `Catálogo de ${tienda.publicName}: fotos, referencias y precios.`,
    openGraph: { title: `${tienda.publicName} · Catálogo`, description: "Fotos, referencias y precios." },
  };
}

export default async function CatalogoDetalPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const q = param(sp.q);
  const categoria = param(sp.categoria);
  const listado = esListado({ q, categoria, pagina: param(sp.pagina), todo: param(sp.todo), linea: param(sp.linea), color: param(sp.color), material: param(sp.material), precio_min: param(sp.precio_min), precio_max: param(sp.precio_max) });

  const tienda = await cargarTienda(slug);
  if (!tienda) notFound();
  const basePath = retailPath(tienda.slug);
  const listPath = `${basePath}?todo=1`;

  if (!listado) {
    const registro = storefrontConfigFor(tienda.slug);
    // Vitrina con tema "tecnologia": su propio inicio (el header navy y la navegación inferior los pone el marco de la tienda).
    const tecnologia = tecnologiaOf(registro);
    if (tecnologia) {
      const home = await cargarInicio(slug);
      if (!home) notFound();
      return <TiendaInicioTecnologia home={home} contenido={tecnologia} basePath={basePath} listPath={listPath} />;
    }
    // Inicio clásico: lo publicado en el CMS comercial (portada, banner, secciones, destacados, campaña) o, sin nada publicado o ante
    // cualquier problema, la vitrina de siempre. Los productos siguen saliendo del catálogo real: el CMS solo elige cuáles y en qué orden.
    const vitrina = await cargarVitrinaInicio(registro, {
      slug: tienda.slug,
      basePath,
      listPath,
      whatsapp: tienda.whatsapp,
      categorias: new Set(tienda.categories.map((c) => c.id)),
    });
    // Vitrina con tema "joyeria" (Bloque 30): las MISMAS secciones y datos, con el diseño editorial. El contenido sigue siendo el del CMS.
    const joyeriaDeSiempre = joyeriaOf(registro);
    // La franja de acabados (solo del tema "joyeria") sale de los colores reales del catálogo; se lee a la vez que el inicio y, si falla o no hay, la franja no se dibuja.
    // Lo mismo las fotos y videos que la administradora publicó (los videos del inicio y la imagen de cada categoría): sin nada publicado o ante cualquier problema, los de siempre.
    const [home, acabados, multimedia] = await Promise.all([
      cargarInicioElegido(slug, vitrina.opciones),
      joyeriaDeSiempre?.acabados ? cargarAcabados(slug) : Promise.resolve(null),
      joyeriaDeSiempre ? cargarMultimediaTienda(tienda.slug) : Promise.resolve(null),
    ]);
    if (!home) notFound();
    if (joyeriaDeSiempre) {
      const joyeria = aplicarMultimedia(joyeriaDeSiempre, multimedia);
      const inicio = multimedia ? { ...home, categories: aplicarCategorias(home.categories, multimedia) } : home;
      return (
        <TiendaInicioJoyeria
          home={inicio}
          config={vitrina.config}
          joyeria={joyeria}
          basePath={basePath}
          listPath={listPath}
          businessName={tienda.publicName}
          whatsapp={tienda.whatsapp}
          acabados={acabados}
          lineas={lineasVisibles(joyeria.lineas, tienda.categories, basePath)}
        />
      );
    }
    return <TiendaInicio home={home} config={vitrina.config} basePath={basePath} listPath={listPath} businessName={tienda.publicName} />;
  }

  // Tema "joyeria": sin búsqueda por texto, el listado lleva el panel de filtros (categorías, color, material y precio) y el servidor aplica lo que trae la dirección.
  const esJoyeria = Boolean(joyeriaOf(storefrontConfigFor(tienda.slug)));
  const conFiltros = esJoyeria && !q;
  const filtros = conFiltros ? leerFiltros(sp) : SIN_FILTROS;
  const data = await cargarCatalogoPublico(slug, "retail", undefined, q, categoria, paginaDe(sp.pagina), hayFiltros(filtros) ? textoDeFiltros(filtros) : undefined, conFiltros);
  if (!data) notFound();
  // Con filtros hay varias categorías posibles: el título solo nombra una cuando es la única elegida.
  const idCategoria = conFiltros ? (filtros.categorias.length === 1 ? filtros.categorias[0] : undefined) : categoria;
  const categoriaActual = idCategoria ? data.categories.find((c) => c.id === idCategoria)?.name : undefined;
  // La página de una línea (una sola elegida) se titula con ella: «Plata» o «Plata · Anillos».
  const lineasDelNegocio = lineasDeLaTienda(tienda.slug);
  const lineaElegida = conFiltros && filtros.lineas?.length === 1 ? lineasDelNegocio.find((l) => l.clave === filtros.lineas?.[0]) : undefined;
  const titulo = q ? `Resultados para «${q}»` : lineaElegida ? (categoriaActual ? `${lineaElegida.etiqueta} · ${categoriaActual}` : lineaElegida.etiqueta) : (categoriaActual ?? "Todo el catálogo");

  if (esJoyeria) {
    return (
      <ListadoJoyeria
        data={data}
        basePath={basePath}
        q={q}
        categoria={categoria}
        listPath={listPath}
        titulo={titulo}
        filtros={filtros}
        facetas={data.facets}
        lineas={lineasDelNegocio}
        tile={(p, i) => <TarjetaJoyeria product={p} basePath={basePath} posicion={i} />}
      />
    );
  }

  return (
    <>
      <h1 className="font-serif-tienda pt-6 text-[30px] font-medium leading-tight text-fg sm:pt-10 sm:text-4xl">{titulo}</h1>
      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <PublicCatalog
          data={data}
          basePath={basePath}
          q={q}
          categoria={categoria}
          compact
          listPath={listPath}
          tile={(p, i) => <TarjetaProducto product={p} basePath={basePath} posicion={i} />}
        />
      </div>
    </>
  );
}
