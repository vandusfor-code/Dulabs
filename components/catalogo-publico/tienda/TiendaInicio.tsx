/**
 * Pantalla de INICIO del catálogo público (móvil primero): hero editorial,
 * categorías, destacados, banner y, si el negocio la tiene vigente, su campaña.
 * Server Component: todo el contenido llega en el HTML. Datos comerciales =
 * servicio público (BD); contenido editorial = configuración de la vitrina del
 * negocio (la de siempre o la publicada en el CMS comercial). Nada específico
 * de un negocio.
 *
 * Qué secciones se ven y en qué orden lo dice `config.secciones`; sin él, el
 * orden de siempre (portada, categorías, destacados y banner): con la
 * configuración de hoy el HTML es EXACTAMENTE el mismo (inicio-dorado.test.tsx).
 */
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { EnlaceIntencion } from "@/components/catalogo-publico/tienda/EnlaceIntencion";
import { ArrowRight, MessageCircle } from "lucide-react";
import { formatCop } from "@/lib/business-agent-quote";
import type { PublicHome } from "@/lib/catalogo/service";
import { heroOf, ORDEN_INICIO_CLASICO, type CampanaVitrina, type CatalogStorefrontConfig, type ComboVitrina, type OfertaVitrina } from "@/lib/catalogo/vitrina";
import { Revelar } from "@/components/catalogo-publico/tienda/Revelar";
import { TarjetaProducto } from "@/components/catalogo-publico/tienda/TarjetaProducto";

/** Enlace de la tienda: los internos con el router; los externos (WhatsApp) en pestaña nueva y sin enviar el origen. */
function Enlace({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (href.startsWith("https://")) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

const BOTON_ORO =
  "mt-1.5 inline-flex h-11 w-fit shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[var(--tienda-oro)] pl-5 pr-4 text-sm font-medium text-white shadow-lg shadow-black/15 transition-[background-color,transform] duration-150 hover:bg-[var(--tienda-oro-hover)] active:scale-95 sm:h-12 sm:text-[15px]";

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
        {/* Un botón vacío = la portada no tiene botón (el CMS lo permite). */}
        {hero.cta !== "" && (
          <Enlace href={hero.href ?? listPath} className={BOTON_ORO}>
            {hero.cta}
            <ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
          </Enlace>
        )}
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

/** Fila de tarjetas de producto (la misma en destacados y en la campaña): desliza en el celular y es una cuadrícula en pantallas grandes. */
function FilaProductos({ productos, basePath, posicionar, className }: { productos: PublicHome["featured"]; basePath: string; posicionar: boolean; className?: string }) {
  return (
    <ul
      className={
        "tienda-scroll -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:gap-5 md:overflow-visible md:px-0" + (className ? ` ${className}` : "")
      }
    >
      {productos.map((p, i) => (
        <li key={p.reference} className="w-[46%] shrink-0 snap-start sm:w-[36%] md:w-auto">
          <TarjetaProducto product={p} basePath={basePath} posicion={posicionar ? i : undefined} />
        </li>
      ))}
    </ul>
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
        <FilaProductos productos={home.featured} basePath={basePath} posicionar />
      )}
    </section>
  );
}

/**
 * Campaña vigente (CMS). Con portada propia: tarjeta con su imagen (el texto es HTML real, nunca va dentro de la imagen), título, subtítulo y botón;
 * sin ella, un encabezado sencillo con el nombre de la campaña. Debajo, sus productos ACTIVOS. Sin portada y sin productos no se dibuja nada.
 */
function CampanaInicio({ campana, productos, basePath }: { campana: CampanaVitrina; productos: PublicHome["featured"]; basePath: string }) {
  const portada = campana.portada;
  if (!portada && productos.length === 0) return null;
  return (
    <section id="campana" aria-labelledby="tienda-campana" className="scroll-mt-24">
      <div className={portada ? "overflow-hidden rounded-[26px] border border-edge/80 bg-card" : undefined}>
        {portada?.imagen && (
          <div className="relative aspect-[16/9] bg-ink-2 sm:aspect-[21/9]">
            <Image
              src={portada.imagen.src}
              alt={portada.imagen.alt}
              fill
              sizes="(min-width: 1152px) 1120px, calc(100vw - 32px)"
              className="object-cover"
              style={{ objectPosition: portada.imagen.focus ?? "center" }}
            />
          </div>
        )}
        <div className={portada ? "flex flex-col items-start gap-2 px-5 py-5 sm:gap-3 sm:px-8 sm:py-7" : "mb-4 flex flex-col gap-1.5"}>
          {portada?.etiqueta && <p className="text-[10px] font-medium uppercase tracking-[0.34em] text-[var(--tienda-oro)] sm:text-xs">{portada.etiqueta}</p>}
          <h2 id="tienda-campana" className="font-serif-tienda text-[28px] font-medium leading-none text-fg sm:text-4xl">
            {portada?.titulo ?? campana.nombre}
          </h2>
          {portada?.subtitulo && <p className="max-w-xl text-sm leading-snug text-mist sm:text-base">{portada.subtitulo}</p>}
          {portada?.boton && (
            <Enlace href={portada.boton.href} className={BOTON_ORO}>
              {portada.boton.texto}
              <ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
            </Enlace>
          )}
        </div>
      </div>
      {productos.length > 0 && <FilaProductos productos={productos} basePath={basePath} posicionar={false} className={portada ? "mt-4" : undefined} />}
    </section>
  );
}

const TITULO_SECCION = "font-serif-tienda mb-4 text-[28px] font-medium leading-none text-fg sm:text-4xl";
const TARJETA = "flex h-full flex-col overflow-hidden rounded-[20px] border border-edge/80 bg-card";

/** Imagen de una tarjeta de oferta o combo (el texto es HTML real; la imagen no lleva texto encima). */
function ImagenTarjeta({ imagen }: { imagen: NonNullable<OfertaVitrina["imagen"]> }) {
  return (
    <div className="relative aspect-[16/9] bg-ink-2">
      <Image
        src={imagen.src}
        alt={imagen.alt}
        fill
        sizes="(min-width: 1152px) 360px, (min-width: 768px) 33vw, 82vw"
        className="object-cover"
        style={{ objectPosition: imagen.focus ?? "center" }}
      />
    </div>
  );
}

/**
 * Ofertas vigentes (CMS): anuncian el beneficio, qué cubren y hasta cuándo. Los precios de cada producto ya reflejan la oferta en todas las tarjetas; este bloque solo
 * la explica. Una oferta mayorista jamás llega aquí (la tienda detal solo recibe las del detal).
 */
function OfertasInicio({ ofertas }: { ofertas: readonly OfertaVitrina[] }) {
  return (
    <section id="ofertas" aria-labelledby="tienda-ofertas" className="scroll-mt-24">
      <h2 id="tienda-ofertas" className={TITULO_SECCION}>
        Ofertas vigentes
      </h2>
      <ul className="tienda-scroll -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0">
        {ofertas.map((o) => (
          <li key={o.clave} className="w-[82%] shrink-0 snap-start sm:w-[46%] md:w-auto">
            <article className={TARJETA}>
              {o.imagen && <ImagenTarjeta imagen={o.imagen} />}
              <div className="flex flex-1 flex-col gap-1.5 px-4 pb-4 pt-3.5">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--tienda-oro)]">{o.beneficio}</p>
                <h3 className="font-serif-tienda text-[22px] font-medium leading-tight text-fg">{o.nombre}</h3>
                {o.descripcion && <p className="text-[13.5px] leading-snug text-mist">{o.descripcion}</p>}
                <p className="text-[12.5px] text-mist">
                  {o.alcance}
                  {o.vigencia ? ` · ${o.vigencia}` : ""}
                </p>
                {o.condiciones && <p className="text-[12px] leading-snug text-mist">{o.condiciones}</p>}
                <Enlace href={o.href} className="mt-auto inline-flex h-11 w-fit items-center gap-1.5 pt-1 text-sm font-medium text-[var(--tienda-oro)] transition-colors hover:text-[var(--tienda-oro-hover)]">
                  Ver productos
                  <ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
                </Enlace>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Combos vigentes (CMS, Etapa 1): se muestran con lo que incluyen, su precio y su disponibilidad (la decide el backend), pero NO se compran desde el carrito: la venta
 * la cierra una asesora por WhatsApp. Nunca el stock exacto.
 */
function CombosInicio({ combos }: { combos: readonly ComboVitrina[] }) {
  return (
    <section id="combos" aria-labelledby="tienda-combos" className="scroll-mt-24">
      <h2 id="tienda-combos" className={TITULO_SECCION}>
        Combos
      </h2>
      <ul className="grid gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
        {combos.map((c) => (
          <li key={c.clave}>
            <article className={TARJETA}>
              {c.imagen && <ImagenTarjeta imagen={c.imagen} />}
              <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-3.5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-serif-tienda text-[22px] font-medium leading-tight text-fg">{c.nombre}</h3>
                  <span
                    className={
                      "mt-1 inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-medium leading-none " +
                      (c.disponible ? "bg-[var(--tienda-oro-suave)] text-fg" : "bg-ink-2 text-mist")
                    }
                  >
                    {c.disponible ? "Disponible" : "No disponible por ahora"}
                  </span>
                </div>
                {c.descripcion && <p className="text-[13.5px] leading-snug text-mist">{c.descripcion}</p>}
                <ul className="space-y-0.5 text-[13.5px] text-fg/90">
                  {c.componentes.map((x) => (
                    <li key={x.referencia} className={x.disponible ? undefined : "text-mist"}>
                      {x.cantidad} × {x.nombre}
                      {x.disponible ? "" : " (agotado)"}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pt-1">
                  <span className="text-xl font-semibold tabular-nums text-fg">{formatCop(c.precioCombo)}</span>
                  {c.precioNormal !== null && c.ahorro !== undefined && (
                    <span className="text-sm tabular-nums text-mist">
                      <span className="sr-only">Precio normal: </span>
                      <s>{formatCop(c.precioNormal)}</s>
                    </span>
                  )}
                  {c.ahorro !== undefined && <span className="text-[12.5px] font-medium text-[var(--tienda-oro)]">Ahorras {formatCop(c.ahorro)}</span>}
                </div>
                {c.vigencia && <p className="text-[12.5px] text-mist">Vigente {c.vigencia}</p>}
                {c.condiciones && <p className="text-[12px] leading-snug text-mist">{c.condiciones}</p>}
                {c.consultaHref ? (
                  <Enlace href={c.consultaHref} className={BOTON_ORO}>
                    <MessageCircle className="size-4" strokeWidth={1.8} aria-hidden />
                    Pedir con una asesora
                  </Enlace>
                ) : null}
              </div>
            </article>
          </li>
        ))}
      </ul>
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
  const secciones = config.secciones ?? ORDEN_INICIO_CLASICO;

  function seccion(tipo: (typeof secciones)[number]): ReactNode {
    switch (tipo) {
      case "portada":
        return hero ? <Hero key={tipo} hero={hero} listPath={listPath} /> : null;
      case "categorias":
        return home.categories.length > 0 ? (
          <Revelar key={tipo}>
            <Categorias home={home} basePath={basePath} />
          </Revelar>
        ) : null;
      case "destacados":
        return (
          <Revelar key={tipo}>
            <Destacados home={home} basePath={basePath} listPath={listPath} />
          </Revelar>
        );
      case "banner": {
        if (!banner) return null;
        // La imagen ya trae todo su diseño (y márgenes transparentes): se muestra limpia, sin nada encima.
        const imagen = (
          <Image
            src={banner.src}
            alt={banner.alt}
            width={banner.width}
            height={banner.height}
            sizes="(min-width: 1152px) 1120px, 100vw"
            className="-mx-1 h-auto w-[calc(100%+0.5rem)] max-w-none sm:mx-0 sm:w-full sm:max-w-full"
          />
        );
        return (
          <Revelar key={tipo}>
            {config.bannerHref ? (
              <Enlace href={config.bannerHref} className="block">
                {imagen}
              </Enlace>
            ) : (
              imagen
            )}
          </Revelar>
        );
      }
      case "campana":
        return config.campana ? (
          <Revelar key={tipo}>
            <CampanaInicio campana={config.campana} productos={home.campana ?? []} basePath={basePath} />
          </Revelar>
        ) : null;
      case "ofertas":
        return config.ofertas && config.ofertas.length > 0 ? (
          <Revelar key={tipo}>
            <OfertasInicio ofertas={config.ofertas} />
          </Revelar>
        ) : null;
      case "combos":
        return config.combos && config.combos.length > 0 ? (
          <Revelar key={tipo}>
            <CombosInicio combos={config.combos} />
          </Revelar>
        ) : null;
      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col gap-7 pt-3 sm:gap-10 sm:pt-6">
      {/* Sin portada la página igual necesita su título principal (lectores de pantalla y buscadores). */}
      {!hero || !secciones.includes("portada") ? <h1 className="sr-only">{businessName}</h1> : null}
      {secciones.map((tipo) => seccion(tipo))}
    </div>
  );
}
