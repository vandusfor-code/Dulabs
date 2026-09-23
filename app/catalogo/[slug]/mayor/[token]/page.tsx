import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicCatalog } from "@/components/catalogo-publico/PublicCatalog";
import { cargarCatalogoPublico, paginaDe, param } from "@/lib/catalogo/public-loader";
import { wholesalePath } from "@/lib/catalogo/publicacion";

// Catálogo público con precios al POR MAYOR: /catalogo/{slug}/mayor/{token}.
// El token es secreto (256 bits, rotable desde el dashboard): sin él, 404.
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
  if (!data) return { title: "Catálogo" };
  return {
    title: `${data.business.name} · Catálogo mayorista`,
    robots: { index: false, follow: false, nocache: true },
    // La URL lleva el token: ni siquiera las peticiones a nuestro propio
    // dominio (fotos, navegación) la envían como Referer.
    referrer: "no-referrer",
  };
}

export default async function CatalogoMayorPage(props: Props) {
  const { slug, token, q, categoria, data } = await cargar(props);
  if (!data) notFound();
  return (
    <div className="dash-scope min-h-screen w-full flex-1 bg-ink text-fg">
      <PublicCatalog data={data} basePath={wholesalePath(slug, token)} q={q} categoria={categoria} />
    </div>
  );
}
