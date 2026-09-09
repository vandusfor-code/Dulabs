"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Menu,
  Search,
  ShoppingBag,
  Heart,
  Home,
  Grid2x2,
  Loader2,
  ChevronRight,
  Droplet,
  Scissors,
  Palette,
  Flower2,
  Gift,
  X,
  MessageCircle,
} from "lucide-react";
import { poppinsTienda } from "@/lib/fonts-tienda-amore";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { construirLinkComprarWhatsApp } from "@/lib/amore-tienda";

// Tienda pública de AMORE (autorizado, rediseño mobile-first) -- SIN login.
// Consume /api/amore/tienda tal cual (mismo endpoint, mismos datos reales:
// nunca se muestran productos de ejemplo/inventados en esta página, solo lo
// que el negocio haya cargado de verdad desde /admin/amore/inventario).
//
// Paleta y tipografía EXCLUSIVAS de esta página (a pedido explícito del
// negocio, distinta del resto del panel de AMORE) -- nunca se tocó
// .amore-scope ni la tipografía global del resto del sitio.
const ROSA = "#FF4D8D";
const ROSA_CLARO = "#FFEFF4";
const FONDO = "#FFF8FA";
const TEXTO = "#333333";
const TEXTO_SEC = "#666666";
const BORDE = "#FADDE6";

// Sin carrito real (a pedido explícito, sección 24 del pedido de Inventario:
// "NO implementar todavía carrito/checkout") -- el botón de compra sigue
// abriendo WhatsApp directo, igual que ya funcionaba. El ícono de carrito del
// header es informativo: explica ese flujo real en vez de simular uno falso.
const CLAVE_FAVORITOS = "amore_tienda_favoritos";

type ProductoTienda = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  categoria: string | null;
  fotoUrl: string | null;
  agotado: boolean;
};

type DatosTienda = { negocio: string; telefonoNegocio: string | null; productos: ProductoTienda[] };

const CATEGORIAS = [
  { nombre: "Cuidado Facial", Icono: Droplet },
  { nombre: "Cuidado Capilar", Icono: Scissors },
  { nombre: "Maquillaje", Icono: Palette },
  { nombre: "Cuidado Corporal", Icono: Flower2 },
  { nombre: "Kits y Regalos", Icono: Gift },
];

export default function TiendaAmorePage() {
  const [datos, setDatos] = useState<DatosTienda | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null);
  const [favoritos, setFavoritos] = useState<string[]>(() => {
    try {
      const guardados = localStorage.getItem(CLAVE_FAVORITOS);
      return guardados ? JSON.parse(guardados) : [];
    } catch {
      // SSR (sin localStorage) o navegación privada -- nunca rompe la tienda.
      return [];
    }
  });
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [avisoCarrito, setAvisoCarrito] = useState(false);
  const [navActivo, setNavActivo] = useState<"inicio" | "productos">("inicio");
  const refProductos = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/amore/tienda")
      .then((r) => r.json())
      .then((body) => (body.error ? setError(body.error) : setDatos(body)))
      .catch(() => setError("No se pudo cargar la tienda. Intenta de nuevo."));
  }, []);

  useEffect(() => {
    if (!avisoCarrito) return;
    const t = setTimeout(() => setAvisoCarrito(false), 4000);
    return () => clearTimeout(t);
  }, [avisoCarrito]);

  const alternarFavorito = (id: string) => {
    setFavoritos((actual) => {
      const nuevo = actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id];
      try {
        localStorage.setItem(CLAVE_FAVORITOS, JSON.stringify(nuevo));
      } catch {
        // idem -- solo local, nunca crítico.
      }
      return nuevo;
    });
  };

  const productos = useMemo(() => datos?.productos ?? [], [datos]);

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      const coincideTexto = !q || p.nombre.toLowerCase().includes(q) || (p.categoria ?? "").toLowerCase().includes(q);
      const coincideCategoria = !categoriaActiva || (p.categoria ?? "").toLowerCase().includes(categoriaActiva.toLowerCase());
      return coincideTexto && coincideCategoria;
    });
  }, [productos, busqueda, categoriaActiva]);

  const destacados = useMemo(() => productos.filter((p) => !p.agotado).slice(0, 6), [productos]);

  const irAInicio = () => {
    setNavActivo("inicio");
    setMenuAbierto(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const irAProductos = () => {
    setNavActivo("productos");
    setMenuAbierto(false);
    refProductos.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      className={`${poppinsTienda.variable} min-h-screen w-full overflow-x-hidden`}
      style={{ background: FONDO, color: TEXTO, fontFamily: "var(--font-poppins-tienda), sans-serif" }}
    >
      {/* HEADER */}
      <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b px-4" style={{ background: "#FFFFFF", borderColor: BORDE }}>
        <div className="relative">
          <button type="button" aria-label="Menú" onClick={() => setMenuAbierto((v) => !v)} className="flex size-9 items-center justify-center" style={{ color: TEXTO }}>
            <Menu className="size-6" strokeWidth={1.8} />
          </button>
          {menuAbierto && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenuAbierto(false)} />
              <div className="absolute left-0 top-11 z-30 w-44 rounded-xl border bg-white py-1.5 shadow-lg" style={{ borderColor: BORDE }}>
                <button type="button" onClick={irAInicio} className="block w-full px-4 py-2.5 text-left text-sm" style={{ color: TEXTO }}>
                  Inicio
                </button>
                <button type="button" onClick={irAProductos} className="block w-full px-4 py-2.5 text-left text-sm" style={{ color: TEXTO }}>
                  Productos
                </button>
              </div>
            </>
          )}
        </div>

        <p className="select-none text-[26px] font-normal uppercase" style={{ letterSpacing: "5px", color: TEXTO }}>
          Amore
        </p>

        <div className="flex items-center gap-4">
          <button type="button" aria-label="Buscar" onClick={() => document.getElementById("tienda-buscador")?.focus()} className="flex size-9 items-center justify-center" style={{ color: TEXTO }}>
            <Search className="size-5" strokeWidth={1.8} />
          </button>
          <button type="button" aria-label="Carrito" onClick={() => setAvisoCarrito(true)} className="relative flex size-9 items-center justify-center" style={{ color: TEXTO }}>
            <ShoppingBag className="size-5" strokeWidth={1.8} />
            <span
              className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold text-white"
              style={{ background: ROSA }}
            >
              0
            </span>
          </button>
        </div>
      </header>

      {/* AVISO CARRITO (informativo -- no hay carrito real, la compra es por WhatsApp) */}
      {avisoCarrito && (
        <div className="fixed inset-x-4 top-[80px] z-40 flex items-start gap-2 rounded-2xl border bg-white p-3.5 shadow-lg" style={{ borderColor: BORDE }}>
          <MessageCircle className="mt-0.5 size-4 shrink-0" style={{ color: ROSA }} />
          <p className="flex-1 text-[13px] leading-snug" style={{ color: TEXTO }}>
            Aquí compras directo por WhatsApp 💗 Toca <strong>&quot;Comprar&quot;</strong> en el producto que te interese.
          </p>
          <button type="button" aria-label="Cerrar" onClick={() => setAvisoCarrito(false)} style={{ color: TEXTO_SEC }}>
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* BUSCADOR */}
      <div className="px-4 pt-3">
        <div className="flex h-[46px] items-center gap-2.5 rounded-full px-4" style={{ background: ROSA_CLARO }}>
          <Search className="size-4 shrink-0" style={{ color: TEXTO_SEC }} strokeWidth={1.8} />
          <input
            id="tienda-buscador"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar productos..."
            className="w-full bg-transparent text-sm outline-none placeholder:opacity-70"
            style={{ color: TEXTO }}
          />
          {busqueda && (
            <button type="button" aria-label="Limpiar búsqueda" onClick={() => setBusqueda("")} style={{ color: TEXTO_SEC }}>
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* BANNER (imagen real del proyecto, WETIENDA.png, nunca recreada) */}
      <div className="mt-3.5 px-4">
        <div className="w-full overflow-hidden rounded-xl" style={{ aspectRatio: "3 / 1" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- banner de marca, imagen fija del proyecto */}
          <img src="/WETIENDA.png" alt="Belleza que inspira - AMORE" className="block size-full object-cover object-center" />
        </div>
      </div>

      {/* CATEGORÍAS */}
      <div className="mt-5 flex gap-4 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CATEGORIAS.map(({ nombre, Icono }) => {
          const activa = categoriaActiva === nombre;
          return (
            <button
              key={nombre}
              type="button"
              onClick={() => {
                setCategoriaActiva(activa ? null : nombre);
                irAProductos();
              }}
              className="flex shrink-0 flex-col items-center gap-1.5"
            >
              <span
                className="flex size-14 items-center justify-center rounded-full border transition-colors"
                style={{ background: activa ? ROSA : ROSA_CLARO, borderColor: activa ? ROSA : "transparent" }}
              >
                <Icono className="size-5" strokeWidth={1.8} style={{ color: activa ? "#FFFFFF" : ROSA }} />
              </span>
              <span className="max-w-[72px] truncate text-center text-[11px] font-medium" style={{ color: TEXTO }}>
                {nombre}
              </span>
            </button>
          );
        })}
      </div>

      {/* PRODUCTOS DESTACADOS */}
      {destacados.length > 0 && (
        <section className="mt-6">
          <div className="flex items-center justify-between px-4">
            <h2 className="text-[17px] font-semibold" style={{ color: TEXTO }}>
              Productos destacados
            </h2>
            <button type="button" onClick={irAProductos} className="flex items-center gap-0.5 text-[13px] font-medium" style={{ color: ROSA }}>
              Ver todos <ChevronRight className="size-3.5" />
            </button>
          </div>
          <div className="mt-3 flex gap-3 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {destacados.map((p) => (
              <TarjetaProducto key={p.id} producto={p} telefonoNegocio={datos?.telefonoNegocio ?? null} favorito={favoritos.includes(p.id)} onFavorito={() => alternarFavorito(p.id)} ancho="shrink-0 w-[176px]" />
            ))}
          </div>
        </section>
      )}

      {/* PRODUCTOS (catálogo completo, con búsqueda/categoría) */}
      <section ref={refProductos} className="mt-7 px-4">
        <h2 className="text-[17px] font-semibold" style={{ color: TEXTO }}>
          {categoriaActiva ?? "Productos"}
        </h2>

        {error && (
          <div className="mt-6 rounded-2xl border bg-white p-5 text-center" style={{ borderColor: BORDE }}>
            <p className="text-sm" style={{ color: ROSA }}>
              {error}
            </p>
          </div>
        )}

        {!datos && !error && (
          <div className="flex justify-center py-16">
            <Loader2 className="size-6 animate-spin" style={{ color: TEXTO_SEC }} />
          </div>
        )}

        {datos && productos.length === 0 && (
          <div className="mt-6 flex flex-col items-center gap-2 py-10 text-center">
            <ShoppingBag className="size-7" style={{ color: TEXTO_SEC }} />
            <p className="text-sm" style={{ color: TEXTO_SEC }}>
              Todavía no hay productos disponibles. Vuelve pronto 💗
            </p>
          </div>
        )}

        {datos && productos.length > 0 && productosFiltrados.length === 0 && (
          <div className="mt-6 flex flex-col items-center gap-2 py-10 text-center">
            <Search className="size-7" style={{ color: TEXTO_SEC }} />
            <p className="text-sm" style={{ color: TEXTO_SEC }}>
              No encontramos productos con ese criterio.
            </p>
          </div>
        )}

        {productosFiltrados.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {productosFiltrados.map((p) => (
              <TarjetaProducto key={p.id} producto={p} telefonoNegocio={datos?.telefonoNegocio ?? null} favorito={favoritos.includes(p.id)} onFavorito={() => alternarFavorito(p.id)} ancho="w-full" />
            ))}
          </div>
        )}
      </section>

      {/* espacio para que la barra inferior nunca tape el último producto */}
      <div style={{ height: "calc(88px + env(safe-area-inset-bottom))" }} />

      {/* BOTTOM NAVIGATION (solo Inicio/Productos -- Promociones y Mi cuenta no existen todavía) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 border-t bg-white"
        style={{ height: "72px", borderColor: BORDE, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button type="button" onClick={irAInicio} className="flex flex-col items-center justify-center gap-1">
          <Home className="size-5" strokeWidth={1.8} style={{ color: navActivo === "inicio" ? ROSA : TEXTO_SEC }} />
          <span className="text-[11px] font-medium" style={{ color: navActivo === "inicio" ? ROSA : TEXTO_SEC }}>
            Inicio
          </span>
        </button>
        <button type="button" onClick={irAProductos} className="flex flex-col items-center justify-center gap-1">
          <Grid2x2 className="size-5" strokeWidth={1.8} style={{ color: navActivo === "productos" ? ROSA : TEXTO_SEC }} />
          <span className="text-[11px] font-medium" style={{ color: navActivo === "productos" ? ROSA : TEXTO_SEC }}>
            Productos
          </span>
        </button>
      </nav>
    </div>
  );
}

function TarjetaProducto({
  producto,
  telefonoNegocio,
  favorito,
  onFavorito,
  ancho,
}: {
  producto: ProductoTienda;
  telefonoNegocio: string | null;
  favorito: boolean;
  onFavorito: () => void;
  ancho: string;
}) {
  const linkComprar = telefonoNegocio ? construirLinkComprarWhatsApp(telefonoNegocio, producto.nombre) : null;

  return (
    <article className={`flex flex-col overflow-hidden rounded-xl bg-white ${ancho}`}>
      <div className="relative aspect-square w-full overflow-hidden" style={{ background: ROSA_CLARO }}>
        {producto.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- catálogo de productos con URLs dinámicas de Storage
          <img src={producto.fotoUrl} alt={producto.nombre} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <ShoppingBag className="size-8" style={{ color: ROSA, opacity: 0.4 }} strokeWidth={1.25} />
          </div>
        )}

        <button
          type="button"
          aria-label={favorito ? "Quitar de favoritos" : "Agregar a favoritos"}
          onClick={onFavorito}
          className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-white/90 shadow-sm"
        >
          <Heart className="size-3.5" strokeWidth={2} fill={favorito ? ROSA : "none"} style={{ color: ROSA }} />
        </button>

        {producto.agotado && (
          <span className="absolute bottom-2 left-2 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase text-white" style={{ background: TEXTO_SEC }}>
            Agotado
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="line-clamp-1 text-[13px] font-medium" style={{ color: TEXTO }}>
          {producto.nombre}
        </h3>
        <p className="text-[14px] font-semibold" style={{ color: TEXTO }}>
          {formatearPrecioCop(producto.precio)}
        </p>

        {producto.agotado || !linkComprar ? (
          <button type="button" disabled className="mt-1 flex min-h-[38px] items-center justify-center gap-1.5 rounded-full text-[12px] font-semibold text-white opacity-60" style={{ background: TEXTO_SEC }}>
            Agotado
          </button>
        ) : (
          <a
            href={linkComprar}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 flex min-h-[38px] items-center justify-center gap-1.5 rounded-full text-[12px] font-semibold text-white"
            style={{ background: ROSA }}
          >
            <MessageCircle className="size-3.5" /> Comprar
          </a>
        )}
      </div>
    </article>
  );
}
