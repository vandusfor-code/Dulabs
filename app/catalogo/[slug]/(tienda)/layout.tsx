import type { Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { MarcadorLlegada } from "@/components/catalogo-publico/tienda/BotonVolver";
import { HojaCarrito } from "@/components/catalogo-publico/tienda/HojaCarrito";
import { NavInferior } from "@/components/catalogo-publico/tienda/NavInferior";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { TiendaHeader } from "@/components/catalogo-publico/tienda/TiendaHeader";
import { CromoJoyeria } from "@/components/catalogo-publico/tienda/joyeria/CromoJoyeria";
import { PieJoyeria } from "@/components/catalogo-publico/tienda/joyeria/PieJoyeria";
import { HeaderTecnologia, HeaderTecnologiaEsqueleto } from "@/components/catalogo-publico/tienda/tecnologia/HeaderTecnologia";
import { NavInferiorTecnologia } from "@/components/catalogo-publico/tienda/tecnologia/NavInferiorTecnologia";
import { anunciosVisibles, enlaceWhatsapp, hrefMayoristas, mayoristasVisible } from "@/lib/catalogo/joyeria";
import { cargarPieTienda, cargarTienda } from "@/lib/catalogo/public-loader";
import { retailPath } from "@/lib/catalogo/publicacion";
import { joyeriaOf, storefrontConfigFor, tecnologiaOf, temaDe } from "@/lib/catalogo/vitrina";
import { pieDesdeCms } from "@/lib/cms-comercial/pie";
import { serifCatalogo } from "@/lib/fonts-catalogo";

// Tienda pública (detal) de /catalogo/{slug}: marco COMPARTIDO por el inicio,
// el listado/búsqueda y la ficha de producto. Un solo TiendaProvider = un solo
// motor de carrito; header, navegación y "Tu selección" persisten al navegar.
// El mayorista (/mayor/{token}) queda fuera de este grupo, con su propio tema.
//
// TEMA. Cada negocio elige su aspecto en lib/catalogo/vitrina.ts: "clasico" (por
// defecto), "tecnologia" o "joyeria". Con "tecnologia" el INICIO móvil lleva su propio header
// navy y su navegación inferior (HeaderTecnologia / NavInferiorTecnologia, que solo
// se dibujan allí); en el resto de pantallas siguen el header y la navegación de
// siempre, ya con la paleta del tema. Con "joyeria" (Bloque 30) TODAS las pantallas llevan el
// cromo editorial (barra de anuncios + cabecera transparente sobre la portada) y su propio pie;
// el contenido es de ancho completo y cada página pone su propio contenedor. Los demás negocios no cambian.

// viewport-fit=cover: habilita env(safe-area-inset-*) en iPhone. themeColor: barra del navegador del mismo tono que el header de la vitrina.
export async function generateViewport({ params }: { params: Promise<{ slug: string }> }): Promise<Viewport> {
  const { slug } = await params;
  const tema = temaDe(storefrontConfigFor(slug));
  return { themeColor: tema === "tecnologia" ? "#061a35" : tema === "joyeria" ? "#faf7f2" : "#f7f3ee", viewportFit: "cover" };
}

export default async function TiendaLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // El pie que la administradora publicó (tema "joyeria") se pide a la vez que la tienda: no suma espera. Nunca lanza: sin pie publicado, o ante cualquier problema, es el de siempre.
  const piePrevio = joyeriaOf(storefrontConfigFor(slug)) ? cargarPieTienda(slug) : null;
  const tienda = await cargarTienda(slug);
  if (!tienda) notFound();

  const basePath = retailPath(tienda.slug);
  const listPath = `${basePath}?todo=1`;
  const config = storefrontConfigFor(tienda.slug);
  const tecnologia = tecnologiaOf(config);
  const marca = config.brand ?? { name: tienda.publicName };
  const categoriasHref = tienda.categories.length > 0 ? `${basePath}#categorias` : listPath;

  // Tema "joyeria": marco propio (cromo, contenido de ancho completo y pie). Las demás vitrinas siguen con el marco de siempre, más abajo.
  const joyeria = joyeriaOf(config);
  if (joyeria) {
    const anuncios = anunciosVisibles(joyeria, tienda.whatsapp);
    const mayoristas = mayoristasVisible(joyeria, tienda.whatsapp);
    const mayoristaHref = hrefMayoristas(basePath, mayoristas) ?? undefined;
    const datosPie = await (piePrevio ?? cargarPieTienda(tienda.slug));
    const vistaPie = pieDesdeCms(datosPie.pie, {
      basePath,
      listPath,
      categorias: tienda.categories,
      whatsappHref: enlaceWhatsapp(tienda.whatsapp),
      mayoristaHref: mayoristaHref ?? null,
      descripcion: joyeria.descripcion,
      paginas: datosPie.paginas,
    });
    return (
      <div className={`catalogo-tienda tienda-joyeria ${anuncios.length > 0 ? "joy-con-anuncio " : ""}${serifCatalogo.variable} min-h-screen w-full flex-1 bg-ink font-sans text-fg`}>
        <TiendaProvider slug={tienda.slug} context="retail" basePath={basePath} whatsapp={tienda.whatsapp} marcaReferencia={tienda.referenceMark}>
          <MarcadorLlegada />
          <Suspense fallback={null}>
            <CromoJoyeria marca={marca} basePath={basePath} listPath={listPath} categorias={tienda.categories} categoriasHref={categoriasHref} anuncios={anuncios} mayorista={Boolean(mayoristas)} mayoristaHref={mayoristaHref} />
          </Suspense>
          <main className="w-full">{children}</main>
          <PieJoyeria marca={marca} basePath={basePath} listPath={listPath} categorias={tienda.categories} whatsapp={tienda.whatsapp} descripcion={joyeria.descripcion} mayorista={Boolean(mayoristas)} mayoristaHref={mayoristaHref} vista={vistaPie} />
          <Suspense fallback={null}>
            <NavInferior basePath={basePath} categoriasHref={categoriasHref} rutasAparte={mayoristaHref ? [mayoristaHref] : undefined} />
          </Suspense>
          <HojaCarrito />
        </TiendaProvider>
      </div>
    );
  }

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
