import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { MarcadorLlegada } from "@/components/catalogo-publico/tienda/BotonVolver";
import { HojaCarrito } from "@/components/catalogo-publico/tienda/HojaCarrito";
import { NavInferior } from "@/components/catalogo-publico/tienda/NavInferior";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { TiendaHeader } from "@/components/catalogo-publico/tienda/TiendaHeader";
import { cargarTiendaMayor } from "@/lib/catalogo/public-loader";
import { wholesalePath } from "@/lib/catalogo/publicacion";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";
import { serifCatalogo } from "@/lib/fonts-catalogo";

// Tienda MAYORISTA: /catalogo/{slug}/mayor/{token}. El MISMO motor que el
// detal (carrito, validación en el servidor, solicitud por WhatsApp), con el
// canal fijado por el token de la ruta: precios solo al por mayor, carrito
// separado del detal y ningún link que cruce de canal. Sin el token exacto: 404.

export const viewport: Viewport = { themeColor: "#f7f3ee", viewportFit: "cover" };

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  // La URL lleva el token: ni las peticiones a nuestro propio dominio la envían como Referer.
  referrer: "no-referrer",
};

export default async function TiendaMayorLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const tienda = await cargarTiendaMayor(slug, token);
  if (!tienda) notFound();

  const basePath = wholesalePath(tienda.slug, token);
  const config = storefrontConfigFor(tienda.slug);
  const marca = { name: config.brand?.name ?? tienda.publicName, descriptor: "Mayoristas" };

  return (
    <div className={`catalogo-tienda ${serifCatalogo.variable} min-h-screen w-full flex-1 bg-ink font-sans text-fg`}>
      <TiendaProvider slug={tienda.slug} context="wholesale" basePath={basePath} whatsapp={tienda.whatsapp}>
        <MarcadorLlegada />
        <Suspense fallback={<div className="h-16" aria-hidden />}>
          <TiendaHeader marca={marca} basePath={basePath} listPath={basePath} categorias={tienda.categories} />
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
          <NavInferior basePath={basePath} categoriasHref={basePath} />
        </Suspense>
        <HojaCarrito />
      </TiendaProvider>
    </div>
  );
}
