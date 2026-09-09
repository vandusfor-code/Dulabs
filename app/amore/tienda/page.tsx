"use client";

import { useEffect, useState } from "react";
import { Loader2, ShoppingBag, MessageCircle } from "lucide-react";
import { playfairDisplay } from "@/lib/fonts-portal-amore";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { construirLinkComprarWhatsApp } from "@/lib/amore-tienda";

// Tienda pública de AMORE (/amore/tienda, autorizado) -- SIN login, mobile
// first. Consume /api/amore/tienda (tenant fijo en el servidor). Mismo
// patrón de fetch que app/reservar/amore/page.tsx (fetch en useEffect, sin
// server component) para mantener consistencia con el resto del portal
// público de AMORE.
type ProductoTienda = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  categoria: string | null;
  fotoUrl: string | null;
  agotado: boolean;
};

type DatosTienda = {
  negocio: string;
  telefonoNegocio: string | null;
  productos: ProductoTienda[];
};

export default function TiendaAmorePage() {
  const [datos, setDatos] = useState<DatosTienda | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/amore/tienda")
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setDatos(body)))
      .catch(() => setError("No se pudo cargar la tienda. Intenta de nuevo."));
  }, []);

  return (
    <div className={`amore-scope min-h-screen bg-ink ${playfairDisplay.variable}`}>
      <header className="sticky top-0 z-10 flex flex-col items-center gap-2 border-b border-edge bg-card/95 px-6 py-6 backdrop-blur">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo de marca, no aplica optimización */}
        <img src="/amore/logo.png" alt="AMORE Salón de Belleza" width={1187} height={1326} className="h-[52px] w-auto object-contain" />
        <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-mist">Productos</p>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6">
        {error && (
          <div className="mx-auto mt-16 max-w-sm rounded-2xl border border-edge bg-card p-6 text-center">
            <p className="text-sm text-danger-text">{error}</p>
          </div>
        )}

        {!datos && !error && (
          <div className="flex justify-center py-24">
            <Loader2 className="size-6 animate-spin text-mist" />
          </div>
        )}

        {datos && datos.productos.length === 0 && (
          <div className="mx-auto mt-16 flex max-w-sm flex-col items-center gap-2 text-center">
            <ShoppingBag className="size-7 text-mist" />
            <p className="text-sm text-mist">Todavía no hay productos disponibles. Vuelve pronto 💗</p>
          </div>
        )}

        {datos && datos.productos.length > 0 && (
          <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
            {datos.productos.map((producto) => (
              <TarjetaProducto key={producto.id} producto={producto} telefonoNegocio={datos.telefonoNegocio} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function TarjetaProducto({ producto, telefonoNegocio }: { producto: ProductoTienda; telefonoNegocio: string | null }) {
  const linkComprar = telefonoNegocio ? construirLinkComprarWhatsApp(telefonoNegocio, producto.nombre) : null;

  return (
    <article className="flex flex-col overflow-hidden rounded-[22px] border border-edge bg-card shadow-sm">
      <div className="relative aspect-square w-full overflow-hidden bg-lime-soft">
        {producto.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- catálogo de productos con URLs dinámicas de Storage
          <img src={producto.fotoUrl} alt={producto.nombre} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <ShoppingBag className="size-10 text-lime-text/50" strokeWidth={1.25} />
          </div>
        )}
        {producto.agotado && (
          <span className="absolute right-3 top-3 rounded-full bg-ink-2/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-mist">
            Agotado
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {producto.categoria && <p className="text-[11px] font-medium uppercase tracking-wide text-lime-text">{producto.categoria}</p>}
        <h3 className={`${playfairDisplay.className} text-[17px] font-semibold leading-snug text-fg`}>{producto.nombre}</h3>
        {producto.descripcion && <p className="line-clamp-2 text-[13px] leading-relaxed text-mist">{producto.descripcion}</p>}

        <div className="mt-auto flex items-center justify-between pt-3">
          <span className="text-[17px] font-semibold text-fg">{formatearPrecioCop(producto.precio)}</span>

          {producto.agotado || !linkComprar ? (
            <button type="button" disabled className="rounded-full bg-ink-2 px-4 py-2 text-xs font-semibold text-mist" title={!linkComprar ? "WhatsApp no disponible" : undefined}>
              Agotado
            </button>
          ) : (
            <a
              href={linkComprar}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-full bg-lime px-4 py-2 text-xs font-semibold text-lime-fg transition-colors hover:bg-lime-hover"
            >
              <MessageCircle className="size-3.5" /> Comprar
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
