/**
 * CMS comercial — CONTRATO del repositorio. PURO (solo tipos).
 *
 * Toda mutación es atómica con su auditoría y devuelve un RESULTADO tipado (conflicto, no encontrada, estado inválido…) en vez de lanzar: el servicio decide
 * qué mensaje ve la administradora. Todo método recibe el negocio y lo filtra siempre; un elemento de otro negocio simplemente «no existe».
 */
import type { ActorCms, AssetCms, EntidadCms, EstadoEntidad, RegistroAuditoria, TipoEntidad, VersionCms } from "@/lib/cms-comercial/contrato";

export type ResultadoMutacion =
  | { resultado: "ok"; entidad: EntidadCms; version?: number }
  /** Alguien más cambió el elemento (rev o versión activa distintas de las esperadas). */
  | { resultado: "conflicto"; rev: number | null; versionActiva: number | null }
  | { resultado: "no_encontrada" }
  | { resultado: "archivada" }
  | { resultado: "sin_cambios" }
  | { resultado: "estado_invalido"; estado: string }
  | { resultado: "version_no_encontrada" }
  | { resultado: "invalido" };

export type ResultadoCrear = { resultado: "ok"; entidad: EntidadCms } | { resultado: "clave_existente" } | { resultado: "invalido" };

export type ResultadoAsset = { resultado: "ok"; asset: AssetCms } | { resultado: "existente" } | { resultado: "no_encontrada" } | { resultado: "invalido" };

export interface FiltroListado {
  tipo?: TipoEntidad;
  estado?: EstadoEntidad;
  incluirArchivadas?: boolean;
}

/** Un elemento publicado tal como sale de la base, SIN verificar todavía (el lector comprueba esquema y checksum). */
export interface PublicadoCrudo {
  id: string;
  tipo: string;
  clave: string;
  estado: string;
  version: number;
  checksum: string;
  contenido: unknown;
  publicadaAt: string;
  creadaAt: string;
}

export interface AssetCrudo {
  id: string;
  storagePath: string;
  mimeType: string;
  ancho: number;
  alto: number;
}

export interface LecturaActivaCruda {
  entidades: PublicadoCrudo[];
  assets: AssetCrudo[];
}

export interface CmsRepositorio {
  // --- Lecturas del editor (incluyen borradores) ---
  listar(tenantId: string, filtro?: FiltroListado): Promise<EntidadCms[]>;
  obtener(tenantId: string, id: string): Promise<EntidadCms | null>;
  versiones(tenantId: string, id: string, limite?: number): Promise<VersionCms[]>;
  version(tenantId: string, id: string, version: number): Promise<VersionCms | null>;
  auditoria(tenantId: string, filtro?: { entidadId?: string; limite?: number; antesDe?: number }): Promise<RegistroAuditoria[]>;

  // --- Mutaciones atómicas (cambio + auditoría en una transacción) ---
  crear(tenantId: string, input: { tipo: TipoEntidad; clave: string; borrador: Record<string, unknown>; actor: ActorCms }): Promise<ResultadoCrear>;
  guardarBorrador(tenantId: string, id: string, input: { borrador: Record<string, unknown>; revEsperada: number; actor: ActorCms }): Promise<ResultadoMutacion>;
  publicar(tenantId: string, id: string, input: { revEsperada: number; versionEsperada: number; checksum: string; nota?: string | null; actor: ActorCms }): Promise<ResultadoMutacion>;
  restaurar(tenantId: string, id: string, input: { version: number; versionEsperada: number; nota?: string | null; actor: ActorCms }): Promise<ResultadoMutacion>;
  pausar(tenantId: string, id: string, actor: ActorCms): Promise<ResultadoMutacion>;
  reanudar(tenantId: string, id: string, actor: ActorCms): Promise<ResultadoMutacion>;
  despublicar(tenantId: string, id: string, actor: ActorCms): Promise<ResultadoMutacion>;
  archivar(tenantId: string, id: string, actor: ActorCms): Promise<ResultadoMutacion>;
  desarchivar(tenantId: string, id: string, actor: ActorCms): Promise<ResultadoMutacion>;

  // --- Imágenes ---
  crearAsset(tenantId: string, input: { id: string; storagePath: string; mimeType: string; bytes: number; ancho: number; alto: number; nombreOriginal?: string | null; actor: ActorCms }): Promise<ResultadoAsset>;
  confirmarAsset(tenantId: string, id: string, input: { bytes: number; ancho: number; alto: number; actor: ActorCms }): Promise<ResultadoAsset>;
  obtenerAsset(tenantId: string, id: string): Promise<AssetCms | null>;
  listarAssets(tenantId: string, limite?: number): Promise<AssetCms[]>;

  /**
   * LO ÚNICO que consumen la tienda, el precio del pedido y ARIA: solo elementos publicados, con su versión activa. null = el módulo está apagado para
   * el negocio o la migración no se aplicó (el CMS no existe: todo se comporta como antes).
   */
  lecturaActiva(tenantId: string): Promise<LecturaActivaCruda | null>;
}
