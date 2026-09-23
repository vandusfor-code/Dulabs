import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { PublicCatalog } from "@/components/catalogo-publico/PublicCatalog";
import { HojaCarrito } from "@/components/catalogo-publico/tienda/HojaCarrito";
import { NavInferior } from "@/components/catalogo-publico/tienda/NavInferior";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { TiendaHeader } from "@/components/catalogo-publico/tienda/TiendaHeader";
import { TiendaInicio } from "@/components/catalogo-publico/tienda/TiendaInicio";
import { armarInicio, esListado } from "@/lib/catalogo/inicio";
import { cargarCatalogoPublico, paginaDe, param } from "@/lib/catalogo/public-loader";
import { retailPath } from "@/lib/catalogo/publicacion";
import { vitrinaDe } from "@/lib/catalogo/vitrina";
import { serifCatalogo } from "@/lib/fonts-catalogo";

// Catálogo público con precios al DETAL: /catalogo/{slug}. Vitrina de tienda
// (móvil primero): sin parámetros muestra el INICIO; con búsqueda, categoría,
// página o ?todo=1 muestra el listado completo dentro del mismo marco.
type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// viewport-fit=cover: habilita env(safe-area-inset-*) para el header y la
// navegación inferior en iPhone. themeColor: barra del navegador del mismo tono.
export const viewport: Viewport = { themeColor: "#f7f3ee", viewportFit: "cover" };

async function cargar({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const q = param(sp.q);
  const categoria = param(sp.categoria);
  const pagina = param(sp.pagina);
  const todo = param(sp.todo);
  const data = await cargarCatalogoPublico(slug, "retail", undefined, q, categoria, paginaDe(sp.pagina));
  return { slug, q, categoria, listado: esListado({ q, categoria, pagina, todo }), data };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { data } = await cargar(props);
  if (!data) return { title: "Catálogo" };
  return {
    title: `${data.business.name} · Catálogo`,
    description: `Catálogo de ${data.business.name}: fotos, referencias y precios.`,
    openGraph: { title: `${data.business.name} · Catálogo`, description: "Fotos, referencias y precios." },
  };
}

export default async function CatalogoDetalPage(props: Props) {
  const { slug, q, categoria, listado, data } = await cargar(props);
  if (!data) notFound();

  const basePath = retailPath(slug);
  const listPath = `${basePath}?todo=1`;
  const vitrina = vitrinaDe(slug);
  const marca = vitrina.marca ?? { nombre: data.business.name };
  const inicio = armarInicio(data);
  const categoriasHref = inicio.categorias.length > 0 ? `${basePath}#categorias` : listPath;
  const categoriaActual = categoria ? data.categories.find((c) => c.id === categoria)?.name : undefined;
  const tituloListado = q ? `Resultados para «${q}»` : (categoriaActual ?? "Todo el catálogo");

  return (
    <div className={`catalogo-tienda ${serifCatalogo.variable} min-h-screen w-full flex-1 bg-ink font-sans text-fg`}>
      <TiendaProvider slug={slug} context="retail" whatsapp={data.business.whatsapp}>
        <TiendaHeader marca={marca} basePath={basePath} listPath={listPath} categorias={data.categories} q={q} />
        <main className="mx-auto w-full max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-16 lg:px-8">
          {listado ? (
            <>
              <h1 className="font-serif-tienda pt-6 text-[30px] font-medium leading-tight text-fg sm:pt-10 sm:text-4xl">{tituloListado}</h1>
              <div className="-mx-4 sm:-mx-6 lg:-mx-8">
                <PublicCatalog data={data} basePath={basePath} q={q} categoria={categoria} compact listPath={listPath} />
              </div>
            </>
          ) : (
            <>
              {!vitrina.hero && <h1 className="sr-only">{data.business.name}</h1>}
              <TiendaInicio inicio={inicio} vitrina={vitrina} basePath={basePath} listPath={listPath} />
            </>
          )}
          <footer className="mt-12 border-t border-edge pt-6 text-center text-xs text-mist">
            Catálogo creado con{" "}
            <a href="https://www.dulabs.co" className="text-fg underline-offset-4 hover:underline">
              DuLabs
            </a>
          </footer>
        </main>
        <NavInferior vista={listado ? "listado" : "inicio"} basePath={basePath} categoriasHref={categoriasHref} />
        <HojaCarrito />
      </TiendaProvider>
    </div>
  );
}
