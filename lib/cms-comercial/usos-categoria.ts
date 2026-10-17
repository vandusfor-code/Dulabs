/**
 * CMS comercial — EN QUÉ PARTES de la tienda está elegida una categoría. PURO (sin I/O).
 *
 * Antes de eliminar una categoría del catálogo, la persona necesita saber dónde la había puesto: la página principal (categorías destacadas, botones), una oferta, el pie de página o la imagen de la
 * categoría en «Fotos y videos». Esto lo calcula con el MISMO extractor de dependencias que usa la validación al publicar (`dependenciasDe`), así que lo que aquí se anuncia es exactamente lo que después
 * haría fallar una publicación («Una de las categorías elegidas ya no existe»).
 *
 * Se mira dos veces cada elemento: lo PUBLICADO (la versión activa: lo que la tienda muestra hoy, si el elemento está publicado) y el BORRADOR (los cambios que todavía no se publican, o lo que nunca se publicó).
 * Los elementos archivados no cuentan: no se ven ni se publican. No se devuelve contenido, solo nombres y el tipo de lugar (código estable; la pantalla lo traduce).
 */
import { TIPOS_ENTIDAD, nombreDeEntidad, type EntidadCms, type EstadoEntidad, type TipoEntidad } from "@/lib/cms-comercial/contrato";
import { dependenciasDe } from "@/lib/cms-comercial/validacion";

/** Dónde, dentro de un elemento, está elegida la categoría (código estable; la pantalla lo traduce). */
export const LUGARES_CATEGORIA = ["destacadas", "boton", "oferta", "enlace_pie", "imagen_categoria", "otro"] as const;
export type LugarCategoria = (typeof LUGARES_CATEGORIA)[number];

export interface UsoCategoria {
  tipo: TipoEntidad;
  /** Código público estable del elemento (no el id interno). */
  clave: string;
  /** Cómo lo conoce la persona («Página principal», «Amor y Amistad»…). */
  nombre: string;
  estado: EstadoEntidad;
  /** En qué partes del elemento está elegida (sin repetir, en orden fijo). */
  lugares: LugarCategoria[];
  /** Está en la versión publicada del elemento. */
  enPublicado: boolean;
  /** Está en el borrador (cambios sin publicar, o un elemento que todavía no se publicó). */
  enBorrador: boolean;
  /** La tienda lo muestra HOY: está en la versión publicada y el elemento está publicado (no pausado). */
  visibleHoy: boolean;
}

/** De la ruta del campo (`categorias_destacadas.2`, `alcance.categorias.0`, `columnas.1.enlaces.0.destino.categoria_id`…) a qué parte es. */
export function lugarDeCampo(campo: string): LugarCategoria {
  const ruta = campo.split(".").filter((s) => !/^\d+$/.test(s)).join(".");
  if (ruta === "categorias_destacadas") return "destacadas";
  if (ruta === "alcance.categorias") return "oferta";
  if (ruta === "portada.boton.destino.categoria_id" || ruta === "banner.destino.categoria_id") return "boton";
  if (ruta === "columnas.enlaces.destino.categoria_id") return "enlace_pie";
  if (ruta === "categorias.categoria_id") return "imagen_categoria";
  return "otro";
}

function lugaresDe(tipo: TipoEntidad, contenido: unknown, categoriaId: string): LugarCategoria[] {
  const encontrados = new Set(dependenciasDe(tipo, contenido).categorias.filter((c) => c.valor === categoriaId).map((c) => lugarDeCampo(c.campo)));
  return LUGARES_CATEGORIA.filter((l) => encontrados.has(l));
}

/**
 * Los elementos de la tienda donde está elegida la categoría. Primero los que la tienda muestra hoy, luego los demás; dentro de cada grupo, por tipo (en el orden del CMS) y por nombre.
 * `entidades` son las del negocio (la lista del editor): el que llama es quien garantiza que sean de ese negocio.
 */
export function usosDeCategoria(entidades: readonly EntidadCms[], categoriaId: string): UsoCategoria[] {
  const usos: UsoCategoria[] = [];
  for (const e of entidades) {
    if (e.archivadaAt !== null) continue;
    const enActivo = e.contenidoActivo ? lugaresDe(e.tipo, e.contenidoActivo, categoriaId) : [];
    const enBorrador = e.borrador ? lugaresDe(e.tipo, e.borrador, categoriaId) : [];
    if (enActivo.length === 0 && enBorrador.length === 0) continue;
    usos.push({
      tipo: e.tipo,
      clave: e.clave,
      nombre: nombreDeEntidad(e.tipo, e.borrador ?? e.contenidoActivo),
      estado: e.estado,
      lugares: LUGARES_CATEGORIA.filter((l) => enActivo.includes(l) || enBorrador.includes(l)),
      enPublicado: enActivo.length > 0,
      enBorrador: enBorrador.length > 0,
      visibleHoy: enActivo.length > 0 && e.estado === "publicada",
    });
  }
  return usos.sort((a, b) => Number(b.visibleHoy) - Number(a.visibleHoy) || TIPOS_ENTIDAD.indexOf(a.tipo) - TIPOS_ENTIDAD.indexOf(b.tipo) || a.nombre.localeCompare(b.nombre, "es") || a.clave.localeCompare(b.clave));
}
