/**
 * CMS comercial — LO PUBLICADO que consumen la tienda, el precio efectivo del pedido y ARIA. PURO (solo tipos).
 *
 * La instantánea contiene ÚNICAMENTE elementos en estado «publicada» con versión activa, ya verificados por el lector (esquema y checksum). Los borradores,
 * los pausados y los archivados no existen para quien la recibe. Lo que falta decidir (vigencia, modalidad/audiencia, campaña activa, aplicabilidad al
 * producto) lo decide evaluacion.ts, que es el ÚNICO lugar donde se evalúa: tienda, pedido y ARIA no repiten esas reglas.
 */
import type { TipoEntidad } from "@/lib/cms-comercial/contrato";
import type { ContenidoPorTipo } from "@/lib/cms-comercial/esquemas";

export interface PublicadaCms<T extends TipoEntidad = TipoEntidad> {
  /** Id interno. Nunca sale hacia el cliente ni hacia ARIA: lo público es `clave`. */
  id: string;
  clave: string;
  /** Versión activa publicada. */
  version: number;
  /** Cuándo se publicó esa versión (ISO). */
  publicadaAt: string;
  /** Cuándo se creó el elemento (ISO): desempata a favor del más antiguo. */
  creadaAt: string;
  contenido: ContenidoPorTipo[T];
}

export interface AssetPublicoCms {
  id: string;
  storagePath: string;
  mimeType: string;
  ancho: number;
  alto: number;
}

export interface InstantaneaCms {
  tenantId: string;
  home: PublicadaCms<"home"> | null;
  ofertas: readonly PublicadaCms<"oferta">[];
  combos: readonly PublicadaCms<"combo">[];
  campanas: readonly PublicadaCms<"campana">[];
  contenidos: readonly PublicadaCms<"contenido">[];
  assets: ReadonlyMap<string, AssetPublicoCms>;
}

/** Instantánea sin nada publicado (negocio con el CMS encendido pero sin contenido). */
export const instantaneaVacia = (tenantId: string): InstantaneaCms => ({ tenantId, home: null, ofertas: [], combos: [], campanas: [], contenidos: [], assets: new Map() });
