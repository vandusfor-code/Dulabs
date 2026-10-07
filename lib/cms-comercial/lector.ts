/**
 * CMS comercial — LECTOR de lo PUBLICADO: la ÚNICA puerta por la que la tienda, el precio del pedido y las herramientas de ARIA ven contenido comercial.
 *
 * Verifica cada elemento antes de entregarlo: que esté publicado, que su checksum coincida con el contenido (si alguien tocó la base a mano, o se
 * corrompió, NO se entrega) y que cumpla el esquema estricto. Lo que no pase se descarta y se registra (solo clave y motivo, nunca el contenido), jamás se
 * muestra a medias. Devuelve null si el módulo está apagado para el negocio o la migración no se aplicó: el CMS no existe y todo sigue como antes.
 */
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { TIPOS_ENTIDAD, type TipoEntidad } from "@/lib/cms-comercial/contrato";
import { ESQUEMA_POR_TIPO } from "@/lib/cms-comercial/esquemas";
import type { AssetPublicoCms, InstantaneaCms, PublicadaCms } from "@/lib/cms-comercial/publicado";
import { instantaneaVacia } from "@/lib/cms-comercial/publicado";
import type { CmsRepositorio, LecturaActivaCruda } from "@/lib/cms-comercial/repositorio";
import { crearRepositorioSupabaseCms } from "@/lib/cms-comercial/repositorio-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MotivoDescarte = "tipo_desconocido" | "no_publicada" | "fecha_invalida" | "checksum" | "esquema" | "repetida";

export interface Descartado {
  clave: string;
  tipo: string;
  motivo: MotivoDescarte;
}

export interface CmsLector {
  /** null = el CMS no existe para este negocio (módulo apagado o migración pendiente). Lanza ante un error inesperado de la base: el que llama decide qué hacer. */
  cargar(tenantId: string): Promise<InstantaneaCms | null>;
}

const esTipo = (t: string): t is TipoEntidad => (TIPOS_ENTIDAD as readonly string[]).includes(t);

function aIso(valor: string): string | null {
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Convierte lo que devolvió la base en una instantánea verificada. Puro: se prueba sin base de datos. */
export function construirInstantanea(tenantId: string, cruda: LecturaActivaCruda): { snap: InstantaneaCms; descartados: Descartado[] } {
  const descartados: Descartado[] = [];
  const ofertas: PublicadaCms<"oferta">[] = [];
  const combos: PublicadaCms<"combo">[] = [];
  const campanas: PublicadaCms<"campana">[] = [];
  const contenidos: PublicadaCms<"contenido">[] = [];
  let home: PublicadaCms<"home"> | null = null;

  for (const e of cruda.entidades) {
    const descartar = (motivo: MotivoDescarte) => void descartados.push({ clave: e.clave, tipo: e.tipo, motivo });
    if (!esTipo(e.tipo)) {
      descartar("tipo_desconocido");
      continue;
    }
    if (e.estado !== "publicada") {
      descartar("no_publicada");
      continue;
    }
    const publicadaAt = aIso(e.publicadaAt);
    const creadaAt = aIso(e.creadaAt);
    if (publicadaAt === null || creadaAt === null) {
      descartar("fecha_invalida");
      continue;
    }
    if (checksumDe(e.contenido) !== e.checksum) {
      descartar("checksum");
      continue;
    }
    const parseo = ESQUEMA_POR_TIPO[e.tipo].safeParse(e.contenido);
    if (!parseo.success) {
      descartar("esquema");
      continue;
    }
    const base = { id: e.id, clave: e.clave, version: e.version, publicadaAt, creadaAt };
    switch (e.tipo) {
      case "home":
        if (home !== null) descartar("repetida");
        else home = { ...base, contenido: parseo.data as PublicadaCms<"home">["contenido"] };
        break;
      case "oferta":
        ofertas.push({ ...base, contenido: parseo.data as PublicadaCms<"oferta">["contenido"] });
        break;
      case "combo":
        combos.push({ ...base, contenido: parseo.data as PublicadaCms<"combo">["contenido"] });
        break;
      case "campana":
        campanas.push({ ...base, contenido: parseo.data as PublicadaCms<"campana">["contenido"] });
        break;
      case "contenido":
        contenidos.push({ ...base, contenido: parseo.data as PublicadaCms<"contenido">["contenido"] });
        break;
    }
  }

  const assets = new Map<string, AssetPublicoCms>(cruda.assets.map((a) => [a.id, { id: a.id, storagePath: a.storagePath, mimeType: a.mimeType, ancho: a.ancho, alto: a.alto }]));
  return { snap: { ...instantaneaVacia(tenantId), home, ofertas, combos, campanas, contenidos, assets }, descartados };
}

export function crearLector(repo: CmsRepositorio, opciones: { alDescartar?: (tenantId: string, descartados: Descartado[]) => void } = {}): CmsLector {
  return {
    async cargar(tenantId) {
      const cruda = await repo.lecturaActiva(tenantId);
      if (cruda === null) return null;
      const { snap, descartados } = construirInstantanea(tenantId, cruda);
      if (descartados.length > 0) {
        if (opciones.alDescartar) opciones.alDescartar(tenantId, descartados);
        else console.warn("[cms-comercial] contenido publicado descartado por el lector:", descartados.map((d) => `${d.tipo}/${d.clave}:${d.motivo}`).join(", "));
      }
      return snap;
    },
  };
}

export const crearLectorSupabase = (supabase: SupabaseClient): CmsLector => crearLector(crearRepositorioSupabaseCms(supabase));
