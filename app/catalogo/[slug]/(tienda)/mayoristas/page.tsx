import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaginaMayoristasJoyeria } from "@/components/catalogo-publico/tienda/joyeria/PaginaMayoristasJoyeria";
import { cargarMultimediaTienda, cargarPaginaMayoristas, cargarTienda } from "@/lib/catalogo/public-loader";
import { armarPaginaMayoristas } from "@/lib/cms-comercial/tienda-mayoristas";

// Página de mayoristas de la tienda al detal: /catalogo/{slug}/mayoristas (el acceso «Mayorista» de la cabecera, el menú y el pie). Es del tema "joyeria" y solo existe si la tienda la configura
// (`mayoristas.pagina`) y tiene un WhatsApp al que escribir: para cualquier otra tienda es un 404, nunca una página vacía (y su título tampoco delata una página que no tiene). Lo que muestra es lo
// PUBLICADO en el CMS (tema «Mayoristas»), con las mismas reglas que ARIA, y el video y los textos de la banda que la administradora publicó en «Fotos y videos»; sin CMS o ante cualquier problema se
// dibuja con el texto de la tienda y su botón de WhatsApp. El catálogo mayorista (/mayor/{token}) sigue siendo privado y aparte. Cómo se arma todo (y en qué orden) está en armarPaginaMayoristas,
// que se prueba aparte: aquí solo se conectan las lecturas.
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  // El título solo necesita saber si la página existe y cómo se llama la tienda: no lee el CMS.
  const hallada = await armarPaginaMayoristas(slug, { tienda: cargarTienda, multimedia: async () => null, pagina: async () => null });
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
  const hallada = await armarPaginaMayoristas(slug, { tienda: cargarTienda, multimedia: cargarMultimediaTienda, pagina: cargarPaginaMayoristas });
  if (!hallada) notFound();
  return <PaginaMayoristasJoyeria m={hallada.mayoristas} pagina={hallada.pagina} />;
}
