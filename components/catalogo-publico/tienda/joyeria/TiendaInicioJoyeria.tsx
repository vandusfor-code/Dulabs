/**
 * INICIO del tema "joyeria" (Delacour, Bloque 30). Dibuja EXACTAMENTE las secciones que dice `config.secciones` (las que publica el CMS comercial; sin él, el orden de siempre: portada,
 * categorías, destacados y banner), con otro diseño: portada a pantalla completa que queda fija mientras el contenido sube sobre ella («cortina»), categorías en carrusel, productos en
 * cuadrícula vertical, y al final una invitación a compradores mayoristas. Server Component: todo llega en el HTML.
 *
 * Nada inventado: no hay «más vendidos», materiales, direcciones ni redes. Un bloque sin datos NO se dibuja (sin categorías, sin banner, sin ofertas, sin campaña, sin combos, sin
 * WhatsApp para los mayoristas). Los precios, las ofertas y los combos los calcula el backend: aquí solo se muestran.
 */
import Image from "next/image";
import { ArrowRight, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Revelar } from "@/components/catalogo-publico/tienda/Revelar";
import { CarruselCategorias } from "@/components/catalogo-publico/tienda/joyeria/CarruselCategorias";
import { HeroJoyeria } from "@/components/catalogo-publico/tienda/joyeria/HeroJoyeria";
import { TarjetaJoyeria } from "@/components/catalogo-publico/tienda/joyeria/TarjetaJoyeria";
import { VeloHero } from "@/components/catalogo-publico/tienda/joyeria/VeloHero";
import { Destellos, EncabezadoSeccion, EnlaceJoyeria, indice } from "@/components/catalogo-publico/tienda/joyeria/piezas";
import { formatCop } from "@/lib/business-agent-quote";
import { mayoristasVisible, rotuloDeDestacados, type MayoristasVisible } from "@/lib/catalogo/joyeria";
import type { PublicHome } from "@/lib/catalogo/service";
import { heroOf, ORDEN_INICIO_CLASICO, type CampanaVitrina, type CatalogStorefrontConfig, type ComboVitrina, type ConfigJoyeria, type OfertaVitrina, type SeccionInicio } from "@/lib/catalogo/vitrina";

const BANDA = "joy-ancla py-16 md:py-24";
const CONTENEDOR = "mx-auto max-w-7xl px-4 sm:px-6 lg:px-8";
const BOTON_LINEA =
  "joy-boton-linea inline-flex h-12 items-center justify-center gap-2 rounded-lg border px-8 text-sm tracking-[0.1em] active:scale-[0.98]";
const ENLACE_TEXTO = "joy-enlace-texto group inline-flex items-center gap-2 text-sm uppercase tracking-[0.08em] text-[var(--tienda-oro)]";

/** Cuadrícula de tarjetas (destacados y productos de la campaña). `posicionar`: la foto de las primeras se carga de inmediato. */
function CuadriculaProductos({ productos, basePath, posicionar }: { productos: PublicHome["featured"]; basePath: string; posicionar: boolean }) {
  // Con menos de cuatro piezas (una campaña corta) se centran en vez de quedar pegadas a la izquierda.
  const pocas = productos.length < 4;
  return (
    <ul className={pocas ? "flex flex-wrap justify-center gap-x-4 gap-y-8" : "grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4"}>
      {productos.map((p, i) => (
        <li key={p.reference} className={pocas ? "joy-item w-[calc(50%-0.5rem)] md:w-[calc(25%-0.75rem)]" : "joy-item"} style={indice(i)}>
          <TarjetaJoyeria product={p} basePath={basePath} posicion={posicionar ? i : undefined} />
        </li>
      ))}
    </ul>
  );
}

function Destacados({ home, basePath, listPath, fondo }: { home: PublicHome; basePath: string; listPath: string; fondo: string }) {
  const rotulo = rotuloDeDestacados(home.featuredPolicy);
  return (
    <section aria-labelledby="joy-destacados" className={`${BANDA} ${fondo}`}>
      <div className={CONTENEDOR}>
        <EncabezadoSeccion etiqueta={rotulo.etiqueta} titulo={rotulo.titulo} id="joy-destacados" />
        {home.featured.length === 0 ? (
          <div className="rounded-xl border border-edge bg-card px-6 py-14 text-center">
            <p className="font-serif-tienda text-2xl text-fg">Muy pronto, nuevas piezas</p>
            <p className="mt-1 text-sm text-mist">Estamos preparando el catálogo. Vuelve en unos días.</p>
          </div>
        ) : (
          <>
            <CuadriculaProductos productos={home.featured} basePath={basePath} posicionar />
            <div className="mt-12 text-center">
              <EnlaceJoyeria href={listPath} className={BOTON_LINEA}>
                Ver todo el catálogo
                <ArrowRight className="size-4" strokeWidth={1.7} aria-hidden />
              </EnlaceJoyeria>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Campaña vigente (CMS). Con portada propia: bloque editorial de dos columnas (foto, etiqueta, título, subtítulo y botón; el texto es HTML real, nunca va dentro de la imagen); sin
 * ella, un encabezado sencillo con el nombre de la campaña. Debajo, sus productos ACTIVOS. Sin portada y sin productos no se dibuja nada.
 */
function CampanaInicio({ campana, productos, basePath, fondo }: { campana: CampanaVitrina; productos: PublicHome["featured"]; basePath: string; fondo: string }) {
  const portada = campana.portada;
  return (
    <section id="campana" aria-labelledby="joy-campana" className={`${BANDA} ${fondo}`}>
      <div className={CONTENEDOR}>
        {portada ? (
          <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
            {portada.imagen && (
              <div className="relative aspect-[5/4] w-full overflow-hidden rounded-xl bg-ink-2 md:order-2 md:aspect-square">
                <Image
                  src={portada.imagen.src}
                  alt={portada.imagen.alt}
                  fill
                  sizes="(min-width: 768px) 560px, 100vw"
                  className="object-cover"
                  style={{ objectPosition: portada.imagen.focus ?? "center" }}
                />
              </div>
            )}
            <div className={portada.imagen ? "md:order-1" : "text-center md:col-span-2"}>
              {portada.etiqueta && <p className="text-[11px] font-normal uppercase tracking-[0.3em] text-[var(--tienda-oro)]">{portada.etiqueta}</p>}
              <h2 id="joy-campana" className="font-serif-tienda mt-2 text-[clamp(2rem,5vw,3.5rem)] font-medium leading-[1.05] text-fg">
                {portada.titulo}
              </h2>
              {portada.subtitulo && <p className={`mt-5 max-w-xl text-base leading-relaxed text-mist md:text-lg ${portada.imagen ? "" : "mx-auto"}`}>{portada.subtitulo}</p>}
              {portada.boton && (
                <EnlaceJoyeria href={portada.boton.href} className={`${ENLACE_TEXTO} mt-7`}>
                  {portada.boton.texto}
                  <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.7} aria-hidden />
                </EnlaceJoyeria>
              )}
            </div>
          </div>
        ) : (
          <EncabezadoSeccion titulo={campana.nombre} id="joy-campana" />
        )}
        {productos.length > 0 && (
          <div className={portada ? "mt-14" : undefined}>
            <CuadriculaProductos productos={productos} basePath={basePath} posicionar={false} />
          </div>
        )}
      </div>
    </section>
  );
}

/** Imagen de una tarjeta de oferta o combo (el texto es HTML real; la imagen no lleva texto encima). */
function ImagenTarjeta({ imagen }: { imagen: NonNullable<OfertaVitrina["imagen"]> }) {
  return (
    <div className="relative aspect-[16/10] bg-ink-2">
      <Image
        src={imagen.src}
        alt={imagen.alt}
        fill
        sizes="(min-width: 1280px) 400px, (min-width: 768px) 33vw, 82vw"
        className="object-cover"
        style={{ objectPosition: imagen.focus ?? "center" }}
      />
    </div>
  );
}

const TARJETA = "flex h-full flex-col overflow-hidden rounded-xl border border-edge bg-card";

/** Ofertas vigentes (CMS): anuncian el beneficio, qué cubren y hasta cuándo. Los precios de cada producto ya reflejan la oferta en todas las tarjetas; este bloque solo la explica. */
function OfertasInicio({ ofertas, fondo }: { ofertas: readonly OfertaVitrina[]; fondo: string }) {
  return (
    <section id="ofertas" aria-labelledby="joy-ofertas" className={`${BANDA} ${fondo}`}>
      <div className={CONTENEDOR}>
        <EncabezadoSeccion titulo="Ofertas vigentes" id="joy-ofertas" />
        <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {ofertas.map((o, i) => (
            <li key={o.clave} className="joy-item" style={indice(i)}>
              <article className={TARJETA}>
                {o.imagen && <ImagenTarjeta imagen={o.imagen} />}
                <div className="flex flex-1 flex-col gap-1.5 px-5 pb-5 pt-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--tienda-oro)]">{o.beneficio}</p>
                  <h3 className="font-serif-tienda text-[24px] font-medium leading-tight text-fg">{o.nombre}</h3>
                  {o.descripcion && <p className="text-[14px] leading-snug text-mist">{o.descripcion}</p>}
                  <p className="text-[13px] text-mist">
                    {o.alcance}
                    {o.vigencia ? ` · ${o.vigencia}` : ""}
                  </p>
                  {o.condiciones && <p className="text-[12.5px] leading-snug text-mist">{o.condiciones}</p>}
                  <EnlaceJoyeria href={o.href} className={`${ENLACE_TEXTO} mt-auto pt-3`}>
                    Ver productos
                    <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.7} aria-hidden />
                  </EnlaceJoyeria>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Combos vigentes (CMS): se muestran con lo que incluyen, su precio y su disponibilidad (la decide el backend), pero NO se compran desde el carrito: la venta la cierra una asesora por
 * WhatsApp. Nunca el stock exacto.
 */
function CombosInicio({ combos, fondo }: { combos: readonly ComboVitrina[]; fondo: string }) {
  return (
    <section id="combos" aria-labelledby="joy-combos" className={`${BANDA} ${fondo}`}>
      <div className={CONTENEDOR}>
        <EncabezadoSeccion titulo="Combos" id="joy-combos" />
        <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {combos.map((c, i) => (
            <li key={c.clave} className="joy-item" style={indice(i)}>
              <article className={TARJETA}>
                {c.imagen && <ImagenTarjeta imagen={c.imagen} />}
                <div className="flex flex-1 flex-col gap-2 px-5 pb-5 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-serif-tienda text-[24px] font-medium leading-tight text-fg">{c.nombre}</h3>
                    <span
                      className={
                        "mt-1.5 inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-medium leading-none " +
                        (c.disponible ? "bg-[var(--tienda-oro-suave)] text-fg" : "bg-ink-2 text-mist")
                      }
                    >
                      {c.disponible ? "Disponible" : "No disponible por ahora"}
                    </span>
                  </div>
                  {c.descripcion && <p className="text-[14px] leading-snug text-mist">{c.descripcion}</p>}
                  <ul className="space-y-0.5 text-[14px] text-fg/90">
                    {c.componentes.map((x) => (
                      <li key={x.referencia} className={x.disponible ? undefined : "text-mist"}>
                        {x.cantidad} × {x.nombre}
                        {x.disponible ? "" : " (agotado)"}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pt-1">
                    <span className="text-xl font-medium tabular-nums text-fg">{formatCop(c.precioCombo)}</span>
                    {c.precioNormal !== null && c.ahorro !== undefined && (
                      <span className="text-sm tabular-nums text-mist">
                        <span className="sr-only">Precio normal: </span>
                        <s>{formatCop(c.precioNormal)}</s>
                      </span>
                    )}
                    {c.ahorro !== undefined && <span className="text-[13px] font-medium text-[var(--tienda-oro)]">Ahorras {formatCop(c.ahorro)}</span>}
                  </div>
                  {c.vigencia && <p className="text-[13px] text-mist">Vigente {c.vigencia}</p>}
                  {c.condiciones && <p className="text-[12.5px] leading-snug text-mist">{c.condiciones}</p>}
                  {c.consultaHref ? (
                    <EnlaceJoyeria href={c.consultaHref} className={`${BOTON_LINEA} mt-2 w-full sm:w-fit`}>
                      <MessageCircle className="size-4" strokeWidth={1.7} aria-hidden />
                      Pedir con una asesora
                    </EnlaceJoyeria>
                  ) : null}
                </div>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Invitación a compradores mayoristas: una banda oscura con un único botón que abre WhatsApp (sin precios ni condiciones inventados). */
function Mayoristas({ m }: { m: MayoristasVisible }) {
  return (
    <section id="mayoristas" aria-labelledby="joy-mayoristas" className="joy-ancla joy-mayoristas relative isolate overflow-hidden px-6 py-24 text-center md:py-32">
      <div className="joy-mayoristas-fondo pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <Destellos className="-z-10" />
      <div className="relative mx-auto max-w-3xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.34em] text-[var(--joy-oro-claro)]">{m.etiqueta}</p>
        <h2 id="joy-mayoristas" className="font-serif-tienda mt-3 text-[clamp(2.1rem,6vw,3.75rem)] font-medium leading-[1.05] text-[#faf8f5]">
          {m.titulo}
        </h2>
        <div className="mx-auto mt-5 flex items-center justify-center gap-3" aria-hidden>
          <span className="h-px w-10 bg-[var(--joy-oro)]" />
          <span className="text-[10px] text-[var(--joy-oro)]">◆</span>
          <span className="h-px w-10 bg-[var(--joy-oro)]" />
        </div>
        <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-white/85 md:text-lg">{m.texto}</p>
        <div className="mt-9">
          <EnlaceJoyeria href={m.href} className="joy-cristal inline-flex h-12 items-center justify-center gap-2 rounded-lg px-8 text-base font-medium tracking-[0.1em] active:scale-[0.98]">
            <MessageCircle className="size-4" strokeWidth={1.8} aria-hidden />
            {m.boton}
          </EnlaceJoyeria>
        </div>
      </div>
    </section>
  );
}

export function TiendaInicioJoyeria({
  home,
  config,
  joyeria,
  basePath,
  listPath,
  businessName,
  whatsapp,
}: {
  home: PublicHome;
  config: CatalogStorefrontConfig;
  joyeria: ConfigJoyeria;
  basePath: string;
  listPath: string;
  businessName: string;
  whatsapp: string | null;
}) {
  const hero = heroOf(config);
  const banner = config.bannerImage;
  const secciones = config.secciones ?? ORDEN_INICIO_CLASICO;
  const mayoristas = mayoristasVisible(joyeria, whatsapp);

  const hay: Record<SeccionInicio, boolean> = {
    portada: Boolean(hero),
    categorias: home.categories.length > 0,
    destacados: true,
    banner: Boolean(banner),
    campana: Boolean(config.campana && (config.campana.portada || (home.campana?.length ?? 0) > 0)),
    ofertas: Boolean(config.ofertas && config.ofertas.length > 0),
    combos: Boolean(config.combos && config.combos.length > 0),
  };
  // La portada va ARRIBA solo si el CMS la puso primera: es el fondo del encabezado transparente. En otra posición es un bloque normal, sin cortina.
  const portadaArriba = hero !== null && secciones[0] === "portada";
  const cuerpo = secciones.filter((t) => hay[t] && !(t === "portada" && portadaArriba));

  // Bandas alternas (crema / crema profundo) entre las secciones de contenido.
  const fondoDe = (i: number) => (i % 2 === 0 ? "bg-ink" : "bg-ink-2");

  function seccion(tipo: SeccionInicio, fondo: string): ReactNode {
    switch (tipo) {
      case "portada":
        return hero ? <HeroJoyeria key={tipo} hero={hero} listPath={listPath} fijo={false} /> : null;
      case "categorias":
        return (
          <Revelar key={tipo}>
            <section id="categorias" aria-labelledby="joy-categorias" className={`${BANDA} ${fondo}`}>
              <div className={CONTENEDOR}>
                <EncabezadoSeccion etiqueta="Explora" titulo="Categorías" id="joy-categorias" />
                <CarruselCategorias categorias={home.categories} basePath={basePath} />
              </div>
            </section>
          </Revelar>
        );
      case "destacados":
        return (
          <Revelar key={tipo}>
            <Destacados home={home} basePath={basePath} listPath={listPath} fondo={fondo} />
          </Revelar>
        );
      case "banner": {
        if (!banner) return null;
        // La imagen ya trae todo su diseño (y márgenes transparentes): se muestra limpia, sin nada encima.
        const imagen = <Image src={banner.src} alt={banner.alt} width={banner.width} height={banner.height} sizes="(min-width: 1280px) 1216px, 100vw" className="h-auto w-full" />;
        return (
          <Revelar key={tipo}>
            <section aria-label="Destacado" className={`joy-ancla py-8 md:py-12 ${fondo}`}>
              <div className={CONTENEDOR}>
                {config.bannerHref ? (
                  <EnlaceJoyeria href={config.bannerHref} className="block">
                    {imagen}
                  </EnlaceJoyeria>
                ) : (
                  imagen
                )}
              </div>
            </section>
          </Revelar>
        );
      }
      case "campana":
        return config.campana ? (
          <Revelar key={tipo}>
            <CampanaInicio campana={config.campana} productos={home.campana ?? []} basePath={basePath} fondo={fondo} />
          </Revelar>
        ) : null;
      case "ofertas":
        return config.ofertas && config.ofertas.length > 0 ? (
          <Revelar key={tipo}>
            <OfertasInicio ofertas={config.ofertas} fondo={fondo} />
          </Revelar>
        ) : null;
      case "combos":
        return config.combos && config.combos.length > 0 ? (
          <Revelar key={tipo}>
            <CombosInicio combos={config.combos} fondo={fondo} />
          </Revelar>
        ) : null;
      default:
        return null;
    }
  }

  const contenido = (
    <>
      {cuerpo.map((tipo, i) => seccion(tipo, fondoDe(i)))}
      {mayoristas && (
        <Revelar>
          <Mayoristas m={mayoristas} />
        </Revelar>
      )}
    </>
  );

  return (
    <div className={portadaArriba ? undefined : "joy-compensa"}>
      {/* Sin portada arriba la página igual necesita su título principal (lectores de pantalla y buscadores). */}
      {!portadaArriba && !(hero && secciones.includes("portada")) ? <h1 className="sr-only">{businessName}</h1> : null}
      {portadaArriba && hero ? (
        <div className="joy-escena relative">
          <div className="joy-hero-fijo">
            <HeroJoyeria hero={hero} listPath={listPath} fijo />
            <VeloHero />
          </div>
          <div className="joy-cortina" data-joy-cortina="">
            {contenido}
          </div>
        </div>
      ) : (
        <div className="joy-cortina-plana">{contenido}</div>
      )}
    </div>
  );
}
