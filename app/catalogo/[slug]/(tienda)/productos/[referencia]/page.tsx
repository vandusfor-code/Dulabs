import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FichaProducto } from "@/components/catalogo-publico/tienda/FichaProducto";
import { cargarProducto, cargarTienda } from "@/lib/catalogo/public-loader";
import { retailPath } from "@/lib/catalogo/publicacion";

// Ficha pública de un producto (detal): /catalogo/{slug}/productos/{referencia}.
// La MISMA proyección pública del backend (referencia -> producto real), sin
// copias de datos; solo productos activos. La referencia es la identidad.
type Props = { params: Promise<{ slug: string; referencia: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, referencia } = await params;
  const [tienda, producto] = await Promise.all([cargarTienda(slug), cargarProducto(slug, referencia)]);
  if (!tienda || !producto) return { title: "Producto" };
  const titulo = `${producto.name} · ${tienda.publicName}`;
  const descripcion = [producto.reference, producto.material, producto.color].filter(Boolean).join(" · ");
  return {
    title: titulo,
    description: producto.description ?? descripcion,
    openGraph: { title: titulo, description: descripcion, images: producto.detailUrl ? [{ url: producto.detailUrl }] : undefined },
  };
}

export default async function ProductoPage({ params }: Props) {
  const { slug, referencia } = await params;
  const [tienda, producto] = await Promise.all([cargarTienda(slug), cargarProducto(slug, referencia)]);
  if (!tienda || !producto) notFound();
  const basePath = retailPath(tienda.slug);
  return <FichaProducto producto={producto} categorias={tienda.categories} basePath={basePath} listPath={`${basePath}?todo=1`} />;
}
