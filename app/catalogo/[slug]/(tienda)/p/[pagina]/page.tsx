import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaginaNoDisponible, PaginaTienda } from "@/components/catalogo-publico/tienda/joyeria/PaginaTienda";
import { cargarPaginaTienda, cargarTienda } from "@/lib/catalogo/public-loader";
import { joyeriaOf, storefrontConfigFor } from "@/lib/catalogo/vitrina";

// Página propia de la tienda: /catalogo/{slug}/p/{código} (la política de privacidad, los términos y condiciones… que la administradora escribió en el panel y publicó). Es del tema "joyeria": para
// cualquier otra tienda, un código que no existe o una página que hoy no está publicada es un 404, nunca una página vacía. Lo que se muestra es SOLO lo publicado (los borradores y las páginas
// pausadas no existen para el cliente). Si la lectura falla o tarda demasiado se dice con claridad, sin fingir que la página no existe.
type Props = { params: Promise<{ slug: string; pagina: string }> };

/** La tienda y la página publicada; null si la tienda no existe o no es del tema que dibuja páginas propias. `cargarTienda` y `cargarPaginaTienda` son una sola lectura por petición. */
async function resolver(slug: string, clave: string) {
  const tienda = await cargarTienda(slug);
  if (!tienda || !joyeriaOf(storefrontConfigFor(tienda.slug))) return null;
  return { tienda, resultado: await cargarPaginaTienda(tienda.slug, clave) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, pagina } = await params;
  const hallada = await resolver(slug, pagina);
  if (!hallada || hallada.resultado.estado !== "ok") return { title: "Página no disponible" };
  const titulo = `${hallada.resultado.pagina.titulo} · ${hallada.tienda.publicName}`;
  return { title: titulo, openGraph: { title: titulo } };
}

export default async function PaginaPropiaPage({ params }: Props) {
  const { slug, pagina } = await params;
  const hallada = await resolver(slug, pagina);
  if (!hallada || hallada.resultado.estado === "no_existe") notFound();
  const { tienda, resultado } = hallada;
  if (resultado.estado === "error") return <PaginaNoDisponible />;
  return <PaginaTienda pagina={resultado.pagina} marca={storefrontConfigFor(tienda.slug).brand?.name ?? tienda.publicName} />;
}
