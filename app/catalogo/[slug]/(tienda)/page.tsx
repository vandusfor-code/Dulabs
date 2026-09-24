import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicCatalog } from "@/components/catalogo-publico/PublicCatalog";
import { TarjetaProducto } from "@/components/catalogo-publico/tienda/TarjetaProducto";
import { TiendaInicio } from "@/components/catalogo-publico/tienda/TiendaInicio";
import { esListado } from "@/lib/catalogo/inicio";
import { cargarCatalogoPublico, cargarInicio, cargarTienda, paginaDe, param } from "@/lib/catalogo/public-loader";
import { retailPath } from "@/lib/catalogo/publicacion";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";

// Catálogo público con precios al DETAL: /catalogo/{slug}. Sin parámetros
// muestra el INICIO de la tienda; con búsqueda, categoría, página o ?todo=1,
// el LISTADO (paginado en el servidor: nunca se carga el catálogo completo).
type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tienda = await cargarTienda(slug);
  if (!tienda) return { title: "Catálogo" };
  return {
    title: `${tienda.publicName} · Catálogo`,
    description: `Catálogo de ${tienda.publicName}: fotos, referencias y precios.`,
    openGraph: { title: `${tienda.publicName} · Catálogo`, description: "Fotos, referencias y precios." },
  };
}

export default async function CatalogoDetalPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const q = param(sp.q);
  const categoria = param(sp.categoria);
  const listado = esListado({ q, categoria, pagina: param(sp.pagina), todo: param(sp.todo) });

  const tienda = await cargarTienda(slug);
  if (!tienda) notFound();
  const basePath = retailPath(tienda.slug);
  const listPath = `${basePath}?todo=1`;

  if (!listado) {
    const home = await cargarInicio(slug);
    if (!home) notFound();
    return <TiendaInicio home={home} config={storefrontConfigFor(tienda.slug)} basePath={basePath} listPath={listPath} businessName={tienda.publicName} />;
  }

  const data = await cargarCatalogoPublico(slug, "retail", undefined, q, categoria, paginaDe(sp.pagina));
  if (!data) notFound();
  const categoriaActual = categoria ? data.categories.find((c) => c.id === categoria)?.name : undefined;
  const titulo = q ? `Resultados para «${q}»` : (categoriaActual ?? "Todo el catálogo");

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
