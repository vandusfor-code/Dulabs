import type { Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { MarcadorLlegada } from "@/components/catalogo-publico/tienda/BotonVolver";
import { HojaCarrito } from "@/components/catalogo-publico/tienda/HojaCarrito";
import { NavInferior } from "@/components/catalogo-publico/tienda/NavInferior";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { TiendaHeader } from "@/components/catalogo-publico/tienda/TiendaHeader";
import { HeaderTecnologia, HeaderTecnologiaEsqueleto } from "@/components/catalogo-publico/tienda/tecnologia/HeaderTecnologia";
import { NavInferiorTecnologia } from "@/components/catalogo-publico/tienda/tecnologia/NavInferiorTecnologia";
import { cargarTienda } from "@/lib/catalogo/public-loader";
import { retailPath } from "@/lib/catalogo/publicacion";
import { storefrontConfigFor, tecnologiaOf, temaDe } from "@/lib/catalogo/vitrina";
import { serifCatalogo } from "@/lib/fonts-catalogo";

// Tienda pública (detal) de /catalogo/{slug}: marco COMPARTIDO por el inicio,
// el listado/búsqueda y la ficha de producto. Un solo TiendaProvider = un solo
// motor de carrito; header, navegación y "Tu selección" persisten al navegar.
// El mayorista (/mayor/{token}) queda fuera de este grupo, con su propio tema.
//
// TEMA. Cada negocio elige su aspecto en lib/catalogo/vitrina.ts: "clasico" (por
// defecto) o "tecnologia". Con "tecnologia" el INICIO móvil lleva su propio header
// navy y su navegación inferior (HeaderTecnologia / NavInferiorTecnologia, que solo
// se dibujan allí); en el resto de pantallas siguen el header y la navegación de
// siempre, ya con la paleta del tema. Los demás negocios no cambian.

// viewport-fit=cover: habilita env(safe-area-inset-*) en iPhone. themeColor: barra del navegador del mismo tono que el header de la vitrina.
export async function generateViewport({ params }: { params: Promise<{ slug: string }> }): Promise<Viewport> {
  const { slug } = await params;
  return { themeColor: temaDe(storefrontConfigFor(slug)) === "tecnologia" ? "#061a35" : "#f7f3ee", viewportFit: "cover" };
}

export default async function TiendaLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tienda = await cargarTienda(slug);
  if (!tienda) notFound();

  const basePath = retailPath(tienda.slug);
  const listPath = `${basePath}?todo=1`;
  const config = storefrontConfigFor(tienda.slug);
  const tecnologia = tecnologiaOf(config);
  const marca = config.brand ?? { name: tienda.publicName };
  const categoriasHref = tienda.categories.length > 0 ? `${basePath}#categorias` : listPath;

  return (
    <div className={`catalogo-tienda ${tecnologia ? "tienda-tecnologia " : ""}${serifCatalogo.variable} min-h-screen w-full flex-1 bg-ink font-sans text-fg`}>
      <TiendaProvider slug={tienda.slug} context="retail" basePath={basePath} whatsapp={tienda.whatsapp} marcaReferencia={tienda.referenceMark}>
        <MarcadorLlegada />
        <Suspense fallback={tecnologia ? <HeaderTecnologiaEsqueleto /> : <div className="h-16" aria-hidden />}>
          <TiendaHeader marca={marca} basePath={basePath} listPath={listPath} categorias={tienda.categories} ocultoEnInicio={Boolean(tecnologia)} />
          {tecnologia && <HeaderTecnologia marca={marca} basePath={basePath} listPath={listPath} categoriasHref={categoriasHref} categorias={tienda.categories} placeholder={tecnologia.buscador} />}
        </Suspense>
        <main className="mx-auto w-full max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-16 lg:px-8">
          {children}
          <footer className="mt-12 border-t border-edge pt-6 text-center text-xs text-mist">
            Catálogo creado con{" "}
            <a href="https://www.dulabs.co" className="text-fg underline-offset-4 hover:underline">
              DuLabs
            </a>
          </footer>
        </main>
        <Suspense fallback={null}>
          <NavInferior basePath={basePath} categoriasHref={categoriasHref} ocultoEnInicio={Boolean(tecnologia)} />
          {tecnologia && <NavInferiorTecnologia basePath={basePath} categoriasHref={categoriasHref} />}
        </Suspense>
        <HojaCarrito />
      </TiendaProvider>
    </div>
  );
}
