import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicCatalog } from "@/components/catalogo-publico/PublicCatalog";
import { TarjetaProducto } from "@/components/catalogo-publico/tienda/TarjetaProducto";
import { cargarCatalogoPublico, paginaDe, param } from "@/lib/catalogo/public-loader";
import { wholesalePath } from "@/lib/catalogo/publicacion";

// Listado MAYORISTA: /catalogo/{slug}/mayor/{token} (búsqueda, categorías y
// páginas en la URL). Mismas tarjetas y carrito que el detal; precio mayor.
type Props = {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function cargar({ params, searchParams }: Props) {
  const [{ slug, token }, sp] = await Promise.all([params, searchParams]);
  const q = param(sp.q);
  const categoria = param(sp.categoria);
  const data = await cargarCatalogoPublico(slug, "wholesale", token, q, categoria, paginaDe(sp.pagina));
  return { slug, token, q, categoria, data };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { data } = await cargar(props);
  return { title: data ? `${data.business.name} · Catálogo mayorista` : "Catálogo" };
}

export default async function CatalogoMayorPage(props: Props) {
  const { slug, token, q, categoria, data } = await cargar(props);
  if (!data) notFound();
  const basePath = wholesalePath(slug, token);
  const categoriaActual = categoria ? data.categories.find((c) => c.id === categoria)?.name : undefined;
  const titulo = q ? `Resultados para «${q}»` : (categoriaActual ?? "Catálogo mayorista");

  return (
    <>
      <div className="pt-6 sm:pt-10">
        <p className="inline-flex items-center gap-2 rounded-full bg-[var(--tienda-oro-suave)] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--tienda-oro)]">
          <span className="size-1.5 rounded-full bg-[var(--tienda-oro)]" aria-hidden />
          Precios al por mayor
        </p>
        <h1 className="font-serif-tienda mt-3 text-[30px] font-medium leading-tight text-fg sm:text-4xl">{titulo}</h1>
      </div>
      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <PublicCatalog data={data} basePath={basePath} q={q} categoria={categoria} compact tile={(p, i) => <TarjetaProducto product={p} basePath={basePath} posicion={i} />} />
      </div>
    </>
  );
}
