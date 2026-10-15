/**
 * CMS comercial — el PIE DE PÁGINA de la tienda pública (tema "joyeria"). PURO: sin I/O.
 *
 * Arma lo que dibuja el pie a partir de lo PUBLICADO en el CMS (tipo «pie») y de lo que la tienda ya sabe (rutas, categorías, WhatsApp). Con nada publicado, o ante cualquier problema, el pie
 * es el de siempre (`pieDeRespaldo`): la tienda no cambia hasta que la administradora publique el suyo. Reglas:
 *   - nunca un enlace que no lleve a ningún lado: un destino que hoy no existe (una categoría borrada, «Mayoristas» en una tienda sin mayoristas, WhatsApp sin número) se omite, y una columna
 *     sin ningún enlace disponible también;
 *   - nunca datos inventados: solo lo que la tienda tiene o lo que la administradora escribió; el contacto por WhatsApp sale del número de la tienda, jamás del texto;
 *   - las direcciones externas ya pasaron la revisión de enlaces.ts al publicar y al leer; aquí se vuelven a comprobar (cinturón doble: este es el único lugar que las convierte en `href`).
 */
import { ETIQUETAS_RED, type RedSocial } from "@/lib/cms-comercial/contrato";
import { esUrlHttpsSegura, hrefCorreo, hrefTelefono, perteneceARed, usuarioDeRed } from "@/lib/cms-comercial/enlaces";
import type { DestinoPie, Pie } from "@/lib/cms-comercial/esquemas";
import { rutaPagina } from "@/lib/cms-comercial/pagina";

/** Categorías que se listan en el pie (el resto, en «Ver todas»). */
export const CATEGORIAS_EN_PIE = 6;

export interface ContextoPie {
  /** Raíz de la tienda: /catalogo/{tienda}. */
  basePath: string;
  /** Todo el catálogo: /catalogo/{tienda}?todo=1. */
  listPath: string;
  categorias: ReadonlyArray<{ id: string; name: string }>;
  /** Enlace de WhatsApp de la tienda (con su número válido) o null si no tiene. */
  whatsappHref: string | null;
  /** A dónde lleva «Mayoristas» (la página propia o el bloque del inicio); null si la tienda no tiene mayoristas. */
  mayoristaHref: string | null;
  /** La frase bajo el nombre de la marca que usa el pie de siempre (la del registro de la tienda). */
  descripcion?: string;
  /** Los códigos de las páginas propias que HOY están publicadas: un enlace a una página que no está aquí no se muestra. Sin ellos, ninguna página existe para el pie. */
  paginas?: readonly string[];
}

export interface EnlacePie {
  texto: string;
  href: string;
  /** Sale de la tienda: se abre en una pestaña nueva, sin enviar el origen. */
  externo: boolean;
}

export interface ColumnaPie {
  titulo: string;
  enlaces: EnlacePie[];
}

export interface ContactoPie {
  titulo: string;
  /** El enlace «Escríbenos por WhatsApp» (el número de la tienda). */
  whatsapp: string | null;
  email: { texto: string; href: string } | null;
  telefono: { texto: string; href: string } | null;
  /** Las líneas de la dirección. */
  direccion: string[];
  horario: string | null;
}

export interface RedPie {
  red: RedSocial;
  etiqueta: string;
  href: string;
  /** «@usuario» cuando se puede deducir de la dirección (Instagram, TikTok, X, YouTube). */
  usuario: string | null;
}

export interface PieVista {
  descripcion: string | null;
  columnas: ColumnaPie[];
  categorias: ColumnaPie | null;
  contacto: ContactoPie | null;
  redes: RedPie[];
  /** Lo que sigue al «© año»; null = «{marca}. Todos los derechos reservados.» */
  derechos: string | null;
}

export const TITULO_NAVEGAR = "Navegar";
export const TITULO_CATEGORIAS = "Categorías";
export const TITULO_CONTACTO = "Contacto";

const interno = (texto: string, href: string): EnlacePie => ({ texto, href, externo: false });

function categoriasDelPie(ctx: ContextoPie): ColumnaPie | null {
  if (ctx.categorias.length === 0) return null;
  const enlaces = ctx.categorias.slice(0, CATEGORIAS_EN_PIE).map((c) => interno(c.name, `${ctx.basePath}?categoria=${encodeURIComponent(c.id)}`));
  if (ctx.categorias.length > CATEGORIAS_EN_PIE) enlaces.push(interno("Ver todas", `${ctx.basePath}#categorias`));
  return { titulo: TITULO_CATEGORIAS, enlaces };
}

/** El pie de siempre: «Navegar» (inicio, catálogo, mayoristas), las categorías y el contacto por WhatsApp. SOLO lo que la tienda ya tiene. */
export function pieDeRespaldo(ctx: ContextoPie): PieVista {
  return {
    descripcion: ctx.descripcion ?? null,
    columnas: [{ titulo: TITULO_NAVEGAR, enlaces: [interno("Inicio", ctx.basePath), interno("Todo el catálogo", ctx.listPath), ...(ctx.mayoristaHref ? [interno("Mayoristas", ctx.mayoristaHref)] : [])] }],
    categorias: categoriasDelPie(ctx),
    contacto: ctx.whatsappHref ? { titulo: TITULO_CONTACTO, whatsapp: ctx.whatsappHref, email: null, telefono: null, direccion: [], horario: null } : null,
    redes: [],
    derechos: null,
  };
}

/** A dónde lleva un enlace del pie; null = ese destino no existe hoy (el enlace no se muestra). */
function resolverDestino(destino: DestinoPie, ctx: ContextoPie): { href: string; externo: boolean } | null {
  switch (destino.tipo) {
    case "inicio":
      return { href: ctx.basePath, externo: false };
    case "catalogo":
      return { href: ctx.listPath, externo: false };
    case "mayoristas":
      return ctx.mayoristaHref ? { href: ctx.mayoristaHref, externo: false } : null;
    case "categoria":
      return ctx.categorias.some((c) => c.id === destino.categoria_id) ? { href: `${ctx.basePath}?categoria=${encodeURIComponent(destino.categoria_id)}`, externo: false } : null;
    case "whatsapp":
      return ctx.whatsappHref ? { href: ctx.whatsappHref, externo: true } : null;
    case "pagina":
      return (ctx.paginas ?? []).includes(destino.clave) ? { href: rutaPagina(ctx.basePath, destino.clave), externo: false } : null;
    case "externo":
      return esUrlHttpsSegura(destino.url) ? { href: destino.url, externo: true } : null;
  }
}

function contactoDelPie(pie: Pie, ctx: ContextoPie): ContactoPie | null {
  const c = pie.contacto;
  if (!c) return null;
  const vista: ContactoPie = {
    titulo: c.titulo ?? TITULO_CONTACTO,
    whatsapp: c.whatsapp ? ctx.whatsappHref : null,
    email: c.email ? { texto: c.email, href: hrefCorreo(c.email) } : null,
    telefono: c.telefono ? { texto: c.telefono, href: hrefTelefono(c.telefono) } : null,
    direccion: c.direccion ? c.direccion.split("\n").filter((l) => l.trim() !== "") : [],
    horario: c.horario ?? null,
  };
  const hayAlgo = vista.whatsapp !== null || vista.email !== null || vista.telefono !== null || vista.direccion.length > 0 || vista.horario !== null;
  return hayAlgo ? vista : null;
}

/** El pie publicado + el contexto de la tienda → lo que se dibuja. Sin pie publicado: el de siempre. */
export function pieDesdeCms(pie: Pie | null, ctx: ContextoPie): PieVista {
  if (pie === null) return pieDeRespaldo(ctx);
  const columnas: ColumnaPie[] = [];
  for (const columna of pie.columnas) {
    const enlaces: EnlacePie[] = [];
    for (const e of columna.enlaces) {
      const destino = resolverDestino(e.destino, ctx);
      if (destino) enlaces.push({ texto: e.texto, href: destino.href, externo: destino.externo });
    }
    if (enlaces.length > 0) columnas.push({ titulo: columna.titulo, enlaces });
  }
  const redes: RedPie[] = [];
  for (const r of pie.redes) {
    if (!esUrlHttpsSegura(r.url) || !perteneceARed(r.red, r.url)) continue;
    redes.push({ red: r.red, etiqueta: ETIQUETAS_RED[r.red], href: r.url, usuario: usuarioDeRed(r.red, r.url) });
  }
  return {
    descripcion: pie.descripcion ?? null,
    columnas,
    categorias: pie.mostrar_categorias ? categoriasDelPie(ctx) : null,
    contacto: contactoDelPie(pie, ctx),
    redes,
    derechos: pie.derechos ?? null,
  };
}

/**
 * El borrador con el que arranca la administradora: EXACTAMENTE el pie de siempre, ya como contenido editable (así, al publicarlo sin tocar nada, la tienda no cambia y ella parte de lo que ve).
 * `mayoristas`: la tienda tiene acceso a «Mayoristas»; `descripcion`: la frase actual bajo el nombre.
 */
export function pieInicial(opciones: { mayoristas: boolean; descripcion?: string | null }): Pie {
  return {
    ...(opciones.descripcion ? { descripcion: opciones.descripcion } : {}),
    columnas: [
      {
        titulo: TITULO_NAVEGAR,
        enlaces: [
          { texto: "Inicio", destino: { tipo: "inicio" } },
          { texto: "Todo el catálogo", destino: { tipo: "catalogo" } },
          ...(opciones.mayoristas ? [{ texto: "Mayoristas", destino: { tipo: "mayoristas" as const } }] : []),
        ],
      },
    ],
    mostrar_categorias: true,
    contacto: { whatsapp: true },
    redes: [],
  };
}

/** Las líneas de derechos que se muestran: «© {año} {texto}». */
export function textoDerechos(marca: string, derechos: string | null, anio: number): string {
  return `© ${anio} ${derechos ?? `${marca}. Todos los derechos reservados.`}`;
}
