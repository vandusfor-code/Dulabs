import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicCatalog } from "@/components/catalogo-publico/PublicCatalog";
import { cargarCatalogoPublico, paginaDe, param } from "@/lib/catalogo/public-loader";
import { retailPath } from "@/lib/catalogo/publicacion";

// Catálogo público con precios al DETAL: /catalogo/{slug}.
type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function cargar({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const q = param(sp.q);
  const categoria = param(sp.categoria);
  const data = await cargarCatalogoPublico(slug, "retail", undefined, q, categoria, paginaDe(sp.pagina));
  return { slug, q, categoria, data };
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
  const { slug, q, categoria, data } = await cargar(props);
  if (!data) notFound();
  return <PublicCatalog data={data} basePath={retailPath(slug)} q={q} categoria={categoria} />;
}
