/**
 * CMS comercial — fixtures de prueba compartidos (datos sintéticos; nunca de un negocio real).
 */
import type { TipoEntidad } from "@/lib/cms-comercial/contrato";
import type { Campana, Combo, Contenido, ContenidoPorTipo, Home, Oferta } from "@/lib/cms-comercial/esquemas";
import type { AssetPublicoCms, InstantaneaCms, PublicadaCms } from "@/lib/cms-comercial/publicado";
import { instantaneaVacia } from "@/lib/cms-comercial/publicado";

export const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
export const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000000b";
export const CAT_ARETES = "c0000000-0000-4000-8000-0000000000a1";
export const CAT_DIJES = "c0000000-0000-4000-8000-0000000000a2";

/** Un instante dentro de la vigencia por defecto de los fixtures (25 al 31 de octubre de 2026, hora de Bogotá). */
export const AHORA = Date.parse("2026-10-28T17:00:00.000Z");
export const VIGENCIA = { desde: "2026-10-25", hasta: "2026-10-31" } as const;

let serie = 0;

/** Un elemento publicado de prueba. Las sobrecargas deducen el tipo del contenido (oferta, combo, campaña, contenido o página principal). */
export function publicada(clave: string, contenido: Oferta, extra?: Partial<Omit<PublicadaCms<"oferta">, "contenido" | "clave">>): PublicadaCms<"oferta">;
export function publicada(clave: string, contenido: Combo, extra?: Partial<Omit<PublicadaCms<"combo">, "contenido" | "clave">>): PublicadaCms<"combo">;
export function publicada(clave: string, contenido: Campana, extra?: Partial<Omit<PublicadaCms<"campana">, "contenido" | "clave">>): PublicadaCms<"campana">;
export function publicada(clave: string, contenido: Contenido, extra?: Partial<Omit<PublicadaCms<"contenido">, "contenido" | "clave">>): PublicadaCms<"contenido">;
export function publicada(clave: string, contenido: Home, extra?: Partial<Omit<PublicadaCms<"home">, "contenido" | "clave">>): PublicadaCms<"home">;
export function publicada(clave: string, contenido: ContenidoPorTipo[TipoEntidad], extra: Partial<Omit<PublicadaCms, "contenido" | "clave">> = {}): PublicadaCms {
  serie += 1;
  return { id: `00000000-0000-4000-8000-${String(serie).padStart(12, "0")}`, clave, version: 1, publicadaAt: "2026-10-20T12:00:00.000Z", creadaAt: "2026-10-01T12:00:00.000Z", contenido, ...extra } as PublicadaCms;
}

export const oferta = (over: Partial<Oferta> = {}): Oferta => ({
  nombre: "Oferta de prueba",
  modalidad: "ambas",
  beneficio: { tipo: "porcentaje", valor: 20 },
  alcance: { todos: false, referencias: ["DL-000001"], categorias: [] },
  vigencia: { ...VIGENCIA },
  prioridad: 0,
  ...over,
});

export const combo = (over: Partial<Combo> = {}): Combo => ({
  nombre: "Combo de prueba",
  modalidad: "ambas",
  componentes: [
    { referencia: "DL-000001", cantidad: 1 },
    { referencia: "DL-000002", cantidad: 2 },
  ],
  precio: { detal: 100000, mayorista: 70000 },
  vigencia: { ...VIGENCIA },
  prioridad: 0,
  ...over,
});

export const campana = (over: Partial<Campana> = {}): Campana => ({
  nombre: "Campaña de prueba",
  modalidad: "ambas",
  vigencia: { ...VIGENCIA },
  prioridad: 0,
  productos_destacados: [],
  ...over,
});

export const contenido = (over: Partial<Contenido> = {}): Contenido => ({
  tema: "faq",
  audiencia: "todos",
  titulo: "¿Hacen envíos?",
  texto: "Sí, enviamos a todo el país.",
  palabras_clave: [],
  orden: 0,
  ...over,
});

export const home = (over: Partial<Home> = {}): Home => ({
  portada: { visible: true, titulo: "Historias que brillan contigo", imagen: { origen: "estatico", src: "/catalogo/prueba/portada.png", ancho: 1600, alto: 900, alt: "Portada de prueba" } },
  secciones: [{ tipo: "portada", visible: true }],
  categorias_destacadas: [],
  productos_destacados: [],
  ...over,
});

export function instantanea(partes: Partial<Omit<InstantaneaCms, "assets">> & { assets?: AssetPublicoCms[] } = {}): InstantaneaCms {
  const base = instantaneaVacia(partes.tenantId ?? TENANT_A);
  return { ...base, ...partes, assets: new Map((partes.assets ?? []).map((a) => [a.id, a])) };
}
