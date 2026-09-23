/**
 * Pantalla de INICIO del catálogo público (móvil primero): hero editorial,
 * categorías, destacados y banner. Server Component: todo el contenido llega
 * en el HTML; solo el "+" del carrito es interactivo. Los datos comerciales
 * vienen del catálogo (BD) y lo editorial de la vitrina del negocio.
 */
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ImageOff } from "lucide-react";
import { formatCop } from "@/lib/business-agent-quote";
import type { Inicio } from "@/lib/catalogo/inicio";
import type { PublicCatalogProduct } from "@/lib/catalogo/publicacion";
import type { VitrinaConfig } from "@/lib/catalogo/vitrina";
import { AgregarAlCarrito } from "@/components/catalogo-publico/tienda/AgregarAlCarrito";
import { Revelar } from "@/components/catalogo-publico/tienda/Revelar";

function Hero({ hero, listPath }: { hero: NonNullable<VitrinaConfig["hero"]>; listPath: string }) {
  return (
    <section className="tienda-hero-entrada relative isolate aspect-[4/3] overflow-hidden rounded-[26px] bg-ink-2 sm:aspect-[16/9] lg:aspect-[21/9]">
      <Image
        src={hero.imagen.src}
        alt={hero.imagen.alt}
        fill
        preload
        sizes="(min-width: 1152px) 1120px, calc(100vw - 32px)"
        className="-z-10 object-cover"
        style={{ objectPosition: hero.enfoque ?? "center" }}
      />
      {/* Velo cálido solo del lado del texto: la fotografía no se altera. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#2a1c12]/80 via-[#2a1c12]/40 via-45% to-transparent to-75%" aria-hidden />
      <div className="flex h-full max-w-[64%] flex-col justify-center gap-2.5 px-5 sm:max-w-[48%] sm:gap-4 sm:px-10 lg:px-14">
        {hero.eyebrow && <p className="text-[10px] font-medium uppercase tracking-[0.34em] text-white/80 sm:text-xs">{hero.eyebrow}</p>}
        <h1 className="font-serif-tienda text-[31px] font-medium leading-[1.02] text-white sm:text-5xl lg:text-6xl">{hero.titulo}</h1>
        {hero.texto && <p className="max-w-[17rem] text-[13px] leading-snug text-white/85 sm:text-base">{hero.texto}</p>}
        <Link
          href={listPath}
          className="mt-1.5 inline-flex h-11 w-fit items-center gap-2 rounded-full bg-[var(--tienda-oro)] pl-5 pr-4 text-sm font-medium text-white shadow-lg shadow-black/15 transition-[background-color,transform] duration-150 hover:bg-[var(--tienda-oro-hover)] active:scale-95 sm:h-12 sm:text-[15px]"
        >
          {hero.cta}
          <ArrowRight className="size-4" strokeWidth={1.8} />
        </Link>
      </div>
    </section>
  );
}

function Categorias({ inicio, basePath }: { inicio: Inicio; basePath: string }) {
  if (inicio.categorias.length === 0) return null;
  return (
    <section id="categorias" aria-label="Categorías" className="scroll-mt-24">
      <div className="tienda-scroll -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:gap-4 sm:px-0">
        {inicio.categorias.map((c) => (
          <Link
            key={c.id}
            href={`${basePath}?categoria=${encodeURIComponent(c.id)}`}
            className="group flex w-[84px] shrink-0 snap-start flex-col items-center gap-2 rounded-2xl py-1 transition-transform duration-150 active:scale-95 sm:w-24"
          >
            <span className="flex size-[72px] items-center justify-center overflow-hidden rounded-full bg-[var(--tienda-oro-suave)] ring-1 ring-edge transition-shadow group-hover:ring-[var(--tienda-oro)] sm:size-20">
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- miniatura pública ya optimizada (WebP) del catálogo
                <img src={c.imageUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
              ) : (
                <span className="font-serif-tienda text-2xl font-medium text-[var(--tienda-oro)]" aria-hidden>
                  {c.name.trim().charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            <span className="line-clamp-1 max-w-full px-1 text-center text-[13px] text-fg">{c.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Tarjeta({ product }: { product: PublicCatalogProduct }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[20px] border border-edge/80 bg-card shadow-[0_1px_2px_rgba(60,40,20,0.04)] transition-transform duration-150 active:scale-[0.985]">
      {product.imageUrl && product.thumbUrl ? (
        <a href={product.imageUrl} target="_blank" rel="noopener noreferrer" className="block aspect-square overflow-hidden bg-ink-2" aria-label={`Ver foto de ${product.name}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen pública ya optimizada (WebP) en la carga */}
          <img src={product.thumbUrl} alt={product.name} loading="lazy" decoding="async" className="size-full object-cover transition-transform duration-500 hover:scale-[1.03]" />
        </a>
      ) : (
        <div className="flex aspect-square items-center justify-center bg-ink-2 text-mist/50">
          <ImageOff className="size-7" strokeWidth={1.5} />
        </div>
      )}
      <div className="flex flex-1 flex-col px-3.5 pb-3.5 pt-3">
        <h3 className="line-clamp-2 text-[14.5px] font-medium leading-snug text-fg">{product.name}</h3>
        <p className="mt-0.5 font-mono text-[11px] tracking-tight text-mist">{product.reference}</p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          {product.price === null ? (
            <span className="text-[13px] text-mist">Precio a consultar</span>
          ) : (
            <span className="text-base font-semibold tabular-nums text-fg">{formatCop(product.price)}</span>
          )}
          <AgregarAlCarrito product={product} />
        </div>
      </div>
    </article>
  );
}

function Destacados({ inicio, listPath }: { inicio: Inicio; listPath: string }) {
  return (
    <section aria-labelledby="tienda-destacados">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="tienda-destacados" className="font-serif-tienda text-[28px] font-medium leading-none text-fg sm:text-4xl">
          Productos destacados
        </h2>
        {inicio.destacados.length > 0 && (
          <Link href={listPath} className="-mr-2 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-[var(--tienda-oro)] transition-colors hover:text-[var(--tienda-oro-hover)]">
            Ver todo
            <ArrowRight className="size-4" strokeWidth={1.8} />
          </Link>
        )}
      </div>
      {inicio.destacados.length === 0 ? (
        <div className="rounded-[20px] border border-edge/80 bg-card px-6 py-12 text-center">
          <p className="font-serif-tienda text-xl text-fg">Muy pronto, nuevas piezas</p>
          <p className="mt-1 text-sm text-mist">Estamos preparando el catálogo. Vuelve en unos días.</p>
        </div>
      ) : (
        <ul className="tienda-scroll -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:gap-5 md:overflow-visible md:px-0">
          {inicio.destacados.map((p) => (
            <li key={p.reference} className="w-[46%] shrink-0 snap-start sm:w-[36%] md:w-auto">
              <Tarjeta product={p} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Banner({ banner }: { banner: NonNullable<VitrinaConfig["banner"]> }) {
  // La imagen ya trae todo su diseño (y márgenes transparentes): se muestra limpia, sin nada encima.
  return (
    <section>
      <Image
        src={banner.imagen.src}
        alt={banner.imagen.alt}
        width={banner.imagen.width}
        height={banner.imagen.height}
        sizes="(min-width: 1152px) 1120px, 100vw"
        className="-mx-1 h-auto w-[calc(100%+0.5rem)] max-w-none sm:mx-0 sm:w-full sm:max-w-full"
      />
    </section>
  );
}

export function TiendaInicio({
  inicio,
  vitrina,
  basePath,
  listPath,
}: {
  inicio: Inicio;
  vitrina: VitrinaConfig;
  basePath: string;
  listPath: string;
}) {
  return (
    <div className="flex flex-col gap-7 pt-3 sm:gap-10 sm:pt-6">
      {vitrina.hero && <Hero hero={vitrina.hero} listPath={listPath} />}
      {inicio.categorias.length > 0 && (
        <Revelar>
          <Categorias inicio={inicio} basePath={basePath} />
        </Revelar>
      )}
      <Revelar>
        <Destacados inicio={inicio} listPath={listPath} />
      </Revelar>
      {vitrina.banner && (
        <Revelar>
          <Banner banner={vitrina.banner} />
        </Revelar>
      )}
    </div>
  );
}
