/**
 * CMS comercial — CONTRATO COMPARTIDO (tipos y constantes). PURO.
 *
 * El CMS administra contenido comercial ESTRUCTURADO de un negocio (portada y página principal, ofertas, combos, campañas y contenido como preguntas
 * frecuentes o políticas) con un ciclo único: BORRADOR → VALIDACIÓN → PUBLICAR → VERSIÓN ACTIVA (+ historial y restauración). Lo único que ven la
 * tienda, el carrito/pedido y ARIA es lo PUBLICADO, vigente y aplicable al canal del cliente; los borradores solo los lee el editor del Dashboard.
 *
 * Las claves de los contenidos (JSON) van en español y snake_case, como el resto de configuraciones jsonb del proyecto (`negocio.pedido.minimo_mayorista`).
 */
import type { Rol } from "@/lib/team";

/** Módulo por negocio (dulabs_tenant_modulos). Sin él, el CMS no existe para el negocio: ni API, ni menú, ni lectura publicada. */
export const CMS_MODULE = "cms_comercial" as const;

export const TIPOS_ENTIDAD = ["home", "oferta", "combo", "campana", "contenido"] as const;
export type TipoEntidad = (typeof TIPOS_ENTIDAD)[number];

/**
 * Estado GUARDADO. «Vencida» no se guarda: se deriva de la vigencia al leer (ver tiempo.ts), para que una oferta deje de valer en el instante exacto
 * de su fin sin depender de ningún proceso programado.
 */
export const ESTADOS_ENTIDAD = ["borrador", "publicada", "pausada"] as const;
export type EstadoEntidad = (typeof ESTADOS_ENTIDAD)[number];

export const MODALIDADES = ["detal", "mayorista", "ambas"] as const;
export type Modalidad = (typeof MODALIDADES)[number];

/** Canal de venta del cliente: lo decide SIEMPRE el backend (nunca el modelo ni el navegador). Mismos valores que `OrderChannel` del catálogo. */
export type Canal = "retail" | "wholesale";
export const CANALES: readonly Canal[] = ["retail", "wholesale"];

/** ¿Un contenido de esta modalidad le sirve a un cliente de este canal? «Ambas» sirve a los dos; detal solo a detal; mayorista solo a mayorista. */
export function modalidadAplica(modalidad: Modalidad, canal: Canal): boolean {
  if (modalidad === "ambas") return true;
  return modalidad === "detal" ? canal === "retail" : canal === "wholesale";
}

export const AUDIENCIAS = ["todos", "detal", "mayorista"] as const;
export type Audiencia = (typeof AUDIENCIAS)[number];

/** Un contenido con esta audiencia, ¿lo puede recibir un cliente de este canal? */
export function audienciaAplica(audiencia: Audiencia, canal: Canal): boolean {
  if (audiencia === "todos") return true;
  return audiencia === "detal" ? canal === "retail" : canal === "wholesale";
}

export const TEMAS_CONTENIDO = ["general", "horarios", "ubicacion", "pagos", "envios", "garantias", "cambios", "devoluciones", "mayoristas", "materiales", "promociones", "faq"] as const;
export type TemaContenido = (typeof TEMAS_CONTENIDO)[number];

export const ETIQUETAS_TEMA: Readonly<Record<TemaContenido, string>> = {
  general: "Información general",
  horarios: "Horarios",
  ubicacion: "Ubicación",
  pagos: "Medios de pago",
  envios: "Envíos",
  garantias: "Garantías",
  cambios: "Cambios",
  devoluciones: "Devoluciones",
  mayoristas: "Mayoristas",
  materiales: "Materiales",
  promociones: "Promociones",
  faq: "Preguntas frecuentes",
};

/** Secciones que puede mostrar la página principal (lista cerrada: la tienda sabe pintar cada una). */
export const SECCIONES_HOME = ["portada", "categorias", "destacados", "banner", "ofertas", "combos", "campana"] as const;
export type SeccionHome = (typeof SECCIONES_HOME)[number];

/** Quién ejecuta una acción del CMS (siempre sale de la sesión autenticada y de la membresía; nunca del cuerpo de la petición). */
export interface ActorCms {
  tenantId: string;
  /** Usuario de Supabase Auth. */
  userId: string;
  miembroId: number;
  rol: Rol;
  /** Nombre o correo para mostrar en el historial («quién lo cambió»). Nunca un secreto. */
  etiqueta: string;
}

/** Lectura para todos los roles del equipo; crear, editar, publicar, pausar, despublicar y restaurar: solo administrador (igual que el catálogo). */
export const CMS_ROLES_LECTURA: readonly Rol[] = ["admin", "agente", "lectura"];
export const CMS_ROLES_ESCRITURA: readonly Rol[] = ["admin"];

/** Tope de tamaño de un contenido (borrador o publicado), en caracteres de su JSON. También lo exige la base de datos. */
export const LIMITE_JSON_CONTENIDO = 131_072;

/** Acciones que quedan en el historial de auditoría. */
export const ACCIONES_AUDITORIA = ["crear", "editar_borrador", "publicar", "restaurar", "pausar", "reanudar", "despublicar", "archivar", "desarchivar", "subir_imagen"] as const;
export type AccionAuditoria = (typeof ACCIONES_AUDITORIA)[number];

export type DeepPartial<T> = T extends readonly (infer U)[] ? DeepPartial<U>[] : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/** Entidad tal como la ve el editor del Dashboard (puede traer borrador). */
export interface EntidadCms {
  id: string;
  tenantId: string;
  tipo: TipoEntidad;
  /** Código público estable (p. ej. «dia-de-la-madre»). Es lo que ve ARIA; nunca el id interno. */
  clave: string;
  estado: EstadoEntidad;
  /** Contador de cambios del borrador/publicación: control optimista para que dos editores no se pisen. */
  rev: number;
  versionActiva: number | null;
  /** Copia de trabajo pendiente. null = no hay cambios sin publicar. */
  borrador: Record<string, unknown> | null;
  /** Contenido de la versión activa (para mostrar y para empezar a editar). null = nunca publicada o despublicada. */
  contenidoActivo: Record<string, unknown> | null;
  archivadaAt: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface VersionCms {
  id: string;
  entidadId: string;
  version: number;
  contenido: Record<string, unknown>;
  checksum: string;
  accion: "publicar" | "restaurar";
  restauradaDe: number | null;
  nota: string | null;
  creadoPor: string | null;
  creadoPorEtiqueta: string | null;
  createdAt: string;
}

export interface RegistroAuditoria {
  id: number;
  entidadTipo: TipoEntidad | "imagen";
  entidadId: string;
  accion: AccionAuditoria;
  version: number | null;
  nota: string | null;
  antes: unknown;
  despues: unknown;
  actorUserId: string | null;
  actorEtiqueta: string | null;
  createdAt: string;
}

/** Imagen subida por el negocio (Storage). La ruta la decide el servidor. */
export interface AssetCms {
  id: string;
  tenantId: string;
  storagePath: string;
  mimeType: string;
  bytes: number;
  ancho: number;
  alto: number;
  estado: "pendiente" | "listo";
  nombreOriginal: string | null;
  createdAt: string;
}

/** Un problema de validación con un mensaje claro para la administradora. */
export interface Problema {
  severidad: "error" | "advertencia";
  codigo: string;
  /** Ruta del campo dentro del contenido (p. ej. `beneficio.valor`, `componentes.1.cantidad`); vacío = el contenido completo. */
  campo: string;
  mensaje: string;
}

export interface ResultadoValidacion {
  /** true si NO hay errores (las advertencias no bloquean). */
  ok: boolean;
  errores: Problema[];
  advertencias: Problema[];
}

export function nombreDeEntidad(tipo: TipoEntidad, contenido: Record<string, unknown> | null | undefined): string {
  if (tipo === "home") return "Página principal";
  const c = contenido ?? {};
  const valor = tipo === "contenido" ? c.titulo : c.nombre;
  return typeof valor === "string" && valor.trim() ? valor.trim() : "Sin nombre";
}
