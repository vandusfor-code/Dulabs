import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FichaProducto } from "@/components/catalogo-publico/tienda/FichaProducto";
import { cargarProductoMayor, cargarTiendaMayor } from "@/lib/catalogo/public-loader";
import { wholesalePath } from "@/lib/catalogo/publicacion";

// Ficha MAYORISTA: /catalogo/{slug}/mayor/{token}/productos/{referencia}.
// Misma ficha que el detal, con la proyección del canal mayorista.
type Props = { params: Promise<{ slug: string; token: string; referencia: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, token, referencia } = await params;
  const [tienda, producto] = await Promise.all([cargarTiendaMayor(slug, token), cargarProductoMayor(slug, token, referencia)]);
  if (!tienda || !producto) return { title: "Producto" };
  return { title: `${producto.name} · ${tienda.publicName} (mayoristas)` };
}

export default async function ProductoMayorPage({ params }: Props) {
  const { slug, token, referencia } = await params;
  const [tienda, producto] = await Promise.all([cargarTiendaMayor(slug, token), cargarProductoMayor(slug, token, referencia)]);
  if (!tienda || !producto) notFound();
  const basePath = wholesalePath(tienda.slug, token);
  return <FichaProducto producto={producto} categorias={tienda.categories} basePath={basePath} listPath={basePath} />;
}
