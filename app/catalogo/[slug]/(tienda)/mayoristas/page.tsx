import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaginaMayoristasJoyeria } from "@/components/catalogo-publico/tienda/joyeria/PaginaMayoristasJoyeria";
import { mayoristasVisible } from "@/lib/catalogo/joyeria";
import { cargarPaginaMayoristas, cargarTienda } from "@/lib/catalogo/public-loader";
import { joyeriaOf, storefrontConfigFor } from "@/lib/catalogo/vitrina";

// Página de mayoristas de la tienda al detal: /catalogo/{slug}/mayoristas (el acceso «Mayorista» de la cabecera, el menú y el pie). Es del tema "joyeria" y solo existe si la tienda la configura
// (`mayoristas.pagina`) y tiene un WhatsApp al que escribir: para cualquier otra tienda es un 404, nunca una página vacía (y su título tampoco delata una página que no tiene). Lo que muestra es lo
// PUBLICADO en el CMS (tema «Mayoristas»), con las mismas reglas que ARIA; sin CMS o ante cualquier problema se dibuja con el texto de la tienda y su botón de WhatsApp. El catálogo mayorista
// (/mayor/{token}) sigue siendo privado y aparte.
type Props = { params: Promise<{ slug: string }> };

/** La tienda y lo que su configuración dice de esta página; null si la tienda no existe o no tiene la página (la ruta es entonces un 404). `cargarTienda` es una sola lectura por petición. */
async function resolver(slug: string) {
  const tienda = await cargarTienda(slug);
  if (!tienda) return null;
  const joyeria = joyeriaOf(storefrontConfigFor(tienda.slug));
  const mayoristas = joyeria ? mayoristasVisible(joyeria, tienda.whatsapp) : null;
  return mayoristas?.pagina ? { tienda, mayoristas, opciones: mayoristas.pagina } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const hallada = await resolver(slug);
  if (!hallada) return { title: "Página no encontrada" };
  const titulo = `${hallada.tienda.publicName} · Mayoristas`;
  return {
    title: titulo,
    description: `Cómo comprar al por mayor en ${hallada.tienda.publicName}.`,
    openGraph: { title: titulo, description: "Compra al por mayor." },
  };
}

export default async function MayoristasPage({ params }: Props) {
  const { slug } = await params;
  const hallada = await resolver(slug);
  if (!hallada) notFound();
  const pagina = await cargarPaginaMayoristas(hallada.tienda.slug, hallada.opciones);
  return <PaginaMayoristasJoyeria m={hallada.mayoristas} pagina={pagina} />;
}
