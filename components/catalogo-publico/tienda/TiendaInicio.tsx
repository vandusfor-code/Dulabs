/**
 * Pantalla de INICIO del catálogo público (móvil primero): hero editorial,
 * categorías, destacados y banner. Server Component: todo el contenido llega
 * en el HTML. Datos comerciales = servicio público (BD); contenido editorial
 * = configuración de la vitrina del negocio. Nada específico de un negocio.
 */
import Image from "next/image";
import Link from "next/link";
import { EnlaceIntencion } from "@/components/catalogo-publico/tienda/EnlaceIntencion";
import { ArrowRight } from "lucide-react";
import type { PublicHome } from "@/lib/catalogo/service";
import { heroOf, type CatalogStorefrontConfig } from "@/lib/catalogo/vitrina";
import { Revelar } from "@/components/catalogo-publico/tienda/Revelar";
import { TarjetaProducto } from "@/components/catalogo-publico/tienda/TarjetaProducto";

function Hero({ hero, listPath }: { hero: NonNullable<ReturnType<typeof heroOf>>; listPath: string }) {
  return (
    // aspect-ratio como MÍNIMO: sin overflow-hidden en la sección, el hero crece
    // si el texto no cabe (pantallas de 320 px o fuentes grandes) en vez de recortarlo.
    <section className="tienda-hero-entrada relative isolate flex aspect-[4/3] rounded-[26px] sm:aspect-[16/9] lg:aspect-[21/9]">
      <div className="absolute inset-0 -z-10 overflow-hidden rounded-[26px] bg-ink-2">
        <Image
          src={hero.image.src}
          alt={hero.image.alt}
          fill
          preload
          sizes="(min-width: 1152px) 1120px, calc(100vw - 32px)"
          className="object-cover"
          style={{ objectPosition: hero.image.focus ?? "center" }}
        />
        {/* Velo cálido solo del lado del texto: la fotografía no se altera. */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#2a1c12]/80 via-[#2a1c12]/40 via-45% to-transparent to-75%" aria-hidden />
      </div>
      <div className="flex max-w-[66%] flex-col justify-center gap-2.5 px-5 py-6 sm:max-w-[48%] sm:gap-4 sm:px-10 lg:px-14">
        {hero.eyebrow && <p className="text-[10px] font-medium uppercase tracking-[0.34em] text-white/85 sm:text-xs">{hero.eyebrow}</p>}
        <h1 className="font-serif-tienda text-[27px] font-medium leading-[1.02] text-white min-[360px]:text-[31px] sm:text-5xl lg:text-6xl">{hero.title}</h1>
        {hero.description && <p className="max-w-[17rem] text-[13px] leading-snug text-white/90 sm:text-base">{hero.description}</p>}
        <Link
          href={listPath}
          className="mt-1.5 inline-flex h-11 w-fit shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[var(--tienda-oro)] pl-5 pr-4 text-sm font-medium text-white shadow-lg shadow-black/15 transition-[background-color,transform] duration-150 hover:bg-[var(--tienda-oro-hover)] active:scale-95 sm:h-12 sm:text-[15px]"
        >
          {hero.cta}
          <ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function Categorias({ home, basePath }: { home: PublicHome; basePath: string }) {
  return (
    <section id="categorias" aria-label="Categorías" className="scroll-mt-24">
      <ul className="tienda-scroll -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:gap-4 sm:px-0">
        {home.categories.map((c) => (
          <li key={c.id} className="shrink-0 snap-start">
            <EnlaceIntencion
              href={`${basePath}?categoria=${encodeURIComponent(c.id)}`}
              className="group flex w-[84px] flex-col items-center gap-2 rounded-2xl py-1 transition-transform duration-150 active:scale-95 sm:w-24"
            >
              <span className="flex size-[72px] items-center justify-center overflow-hidden rounded-full bg-[var(--tienda-oro-suave)] ring-1 ring-edge transition-shadow group-hover:ring-[var(--tienda-oro)] sm:size-20">
                {c.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- miniatura pública ya optimizada (WebP) del catálogo
                  <img src={c.coverUrl} alt="" loading="lazy" decoding="async" width={80} height={80} className="size-full object-cover" />
                ) : (
                  <span className="font-serif-tienda text-2xl font-medium text-[var(--tienda-oro)]" aria-hidden>
                    {c.name.trim().charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="line-clamp-1 max-w-full px-1 text-center text-[13px] text-fg">{c.name}</span>
            </EnlaceIntencion>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Destacados({ home, basePath, listPath }: { home: PublicHome; basePath: string; listPath: string }) {
  return (
    <section aria-labelledby="tienda-destacados">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="tienda-destacados" className="font-serif-tienda text-[28px] font-medium leading-none text-fg sm:text-4xl">
          Productos destacados
        </h2>
        {home.featured.length > 0 && (
          <Link href={listPath} className="-mr-2 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-[var(--tienda-oro)] transition-colors hover:text-[var(--tienda-oro-hover)]">
            Ver todo
            <ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
          </Link>
        )}
      </div>
      {home.featured.length === 0 ? (
        <div className="rounded-[20px] border border-edge/80 bg-card px-6 py-12 text-center">
          <p className="font-serif-tienda text-xl text-fg">Muy pronto, nuevas piezas</p>
          <p className="mt-1 text-sm text-mist">Estamos preparando el catálogo. Vuelve en unos días.</p>
        </div>
      ) : (
        <ul className="tienda-scroll -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:gap-5 md:overflow-visible md:px-0">
          {home.featured.map((p, i) => (
            <li key={p.reference} className="w-[46%] shrink-0 snap-start sm:w-[36%] md:w-auto">
              <TarjetaProducto product={p} basePath={basePath} posicion={i} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TiendaInicio({
  home,
  config,
  basePath,
  listPath,
  businessName,
}: {
  home: PublicHome;
  config: CatalogStorefrontConfig;
  basePath: string;
  listPath: string;
  businessName: string;
}) {
  const hero = heroOf(config);
  const banner = config.bannerImage;
  return (
    <div className="flex flex-col gap-7 pt-3 sm:gap-10 sm:pt-6">
      {hero ? <Hero hero={hero} listPath={listPath} /> : <h1 className="sr-only">{businessName}</h1>}
      {home.categories.length > 0 && (
        <Revelar>
          <Categorias home={home} basePath={basePath} />
        </Revelar>
      )}
      <Revelar>
        <Destacados home={home} basePath={basePath} listPath={listPath} />
      </Revelar>
      {banner && (
        <Revelar>
          {/* La imagen ya trae todo su diseño (y márgenes transparentes): se muestra limpia, sin nada encima. */}
          <Image
            src={banner.src}
            alt={banner.alt}
            width={banner.width}
            height={banner.height}
            sizes="(min-width: 1152px) 1120px, 100vw"
            className="-mx-1 h-auto w-[calc(100%+0.5rem)] max-w-none sm:mx-0 sm:w-full sm:max-w-full"
          />
        </Revelar>
      )}
    </div>
  );
}
