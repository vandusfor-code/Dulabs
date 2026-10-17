/**
 * Cliente del navegador para /api/dashboard/tienda/* (mismo patrón que lib/catalogo-client.ts: resultados tipados, nunca lanza por HTTP).
 *
 * subirImagen() orquesta la subida en 3 etapas sin pasar la foto por Vercel:
 *   preparar (si pesa demasiado, se comprime en el navegador) → pedir la URL firmada → subir DIRECTO a Storage → confirmar (el servidor la verifica y la re-codifica).
 *
 * Todo lo que toca la red o el navegador se puede reemplazar (`fetch`, `preparar`, `subir`) para probar los componentes sin red.
 */
import type { AccionAuditoria, Problema, RegistroAuditoria, ResultadoValidacion, TextosMayoristas, TipoEntidad, EstadoEntidad, VersionCms } from "@/lib/cms-comercial/contrato";
import type { ImagenVista, TicketSubida } from "@/lib/cms-comercial/imagenes";
import type { ProductoVista } from "@/lib/cms-comercial/puertos";
import type { EntidadDetalle, EntidadResumen } from "@/lib/cms-comercial/servicio";
import type { UsoCategoria } from "@/lib/cms-comercial/usos-categoria";
import type { VariableId } from "@/lib/cms-comercial/variables";
import type { ArchivoVideoId, EspacioVideo } from "@/lib/cms-comercial/video-requisitos";
import type { VideoConfirmado, VideoVista } from "@/lib/cms-comercial/videos";
import type { ArchivoVideo } from "@/lib/catalogo/vitrina";
import { supabaseBrowser } from "@/lib/supabase-browser";

export interface CmsClientError {
  code: string;
  message: string;
  status: number;
  /** Problemas de validación (errores 422 al publicar o restaurar): se muestran para que la administradora corrija. */
  problemas?: Problema[];
}

export type CmsResult<T> = { ok: true; data: T } | { ok: false; error: CmsClientError };

/** Los videos con los que la tienda se ve hoy en cada espacio (antes de que la administradora suba los suyos). Solo los espacios que la tienda tiene. */
export type VideosDeSiempre = Partial<Record<EspacioVideo, { horizontal: ArchivoVideo; vertical?: ArchivoVideo }>>;

export interface ContextoTienda {
  variables: Array<{ id: VariableId; etiqueta: string; valor: string | null }>;
  minimoMayorista: number | null;
  categorias: Array<{ id: string; nombre: string }>;
  /** Ruta pública de la tienda (`/catalogo/{tienda}`) si está publicada; null si no se pudo resolver. */
  rutaTienda?: string | null;
  /** Qué tienda es el negocio (null si no se pudo resolver): del tema depende si se dibujan el pie y la página de mayoristas. */
  tienda?: {
    slug: string;
    nombre: string;
    tema: "clasico" | "tecnologia" | "joyeria";
    mayoristas: boolean;
    paginaMayoristas: { intro: string | null; omitir: string[]; tambien: string[] } | null;
    descripcion: string | null;
    videosDeSiempre?: VideosDeSiempre;
    /** Los textos con los que se ve hoy el bloque «Compras por mayor» (los de la tienda); null si la tienda no tiene ese bloque. */
    textosMayoristas?: TextosMayoristas | null;
  } | null;
  zona: string;
  ahora: string;
}

export interface FiltroListadoCliente {
  tipo?: TipoEntidad;
  estado?: EstadoEntidad;
  archivadas?: boolean;
}

export type EtapaSubida = "preparando" | "subiendo" | "confirmando";
/** Las etapas de subir un video: su imagen fija, el video y la verificación del servidor. */
export type EtapaSubidaVideo = "imagen-fija" | "subiendo" | "verificando";

export type { AccionAuditoria, EntidadDetalle, EntidadResumen, ImagenVista, ProductoVista, RegistroAuditoria, ResultadoValidacion, UsoCategoria, VersionCms, VideoConfirmado, VideoVista };

const BASE = "/api/dashboard/tienda";

/** Lo que se sube sin tocarlo: hasta 5,5 MB (el servidor acepta 6 MB y lo re-codifica). Más pesado se comprime antes en el navegador. */
export const MAX_BYTES_SIN_COMPRIMIR = 5.5 * 1024 * 1024;
export const TIPOS_IMAGEN_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"] as const;

export interface OpcionesCliente {
  fetch?: typeof fetch;
  /** Prepara el archivo antes de subirlo (por defecto: lo deja igual si es liviano y lo comprime si no). */
  preparar?: (archivo: File, opciones?: { ladoMaximo?: number }) => Promise<{ blob: Blob; mimeType: string }>;
  /** Sube el archivo a la URL firmada (por defecto: Storage de Supabase desde el navegador). */
  subir?: (ticket: TicketSubida, blob: Blob, mimeType: string) => Promise<CmsResult<null>>;
}

async function llamar<T>(f: typeof fetch, accessToken: string, ruta: string, init: RequestInit = {}): Promise<CmsResult<T>> {
  let respuesta: Response;
  try {
    respuesta = await f(`${BASE}${ruta}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    return { ok: false, error: { code: "NETWORK_ERROR", message: "Sin conexión. Revisa tu internet e intenta de nuevo.", status: 0 } };
  }
  let cuerpo: { success?: boolean; data?: T; error?: { code?: string; message?: string; diagnostics?: { problemas?: Problema[] } } | string } = {};
  try {
    cuerpo = await respuesta.json();
  } catch {
    // sin cuerpo JSON: error genérico abajo
  }
  if (respuesta.ok && cuerpo.success && cuerpo.data !== undefined) return { ok: true, data: cuerpo.data };
  const err = cuerpo.error;
  const problemas = typeof err === "object" ? err?.diagnostics?.problemas : undefined;
  return {
    ok: false,
    error: {
      code: typeof err === "object" && err?.code ? err.code : respuesta.status === 429 ? "RATE_LIMITED" : "UNKNOWN",
      message: typeof err === "string" ? err : (err?.message ?? "Ocurrió un error inesperado."),
      status: respuesta.status,
      ...(Array.isArray(problemas) ? { problemas } : {}),
    },
  };
}

/**
 * Respaldo cuando no hay preparación propia: lo liviano sube tal cual (el servidor lo re-codifica). Lo pesado se reduce con un canvas. Con `ladoMaximo` (por ejemplo, las imágenes de las
 * categorías, que se ven pequeñas) también se reduce lo que sea más grande que eso, aunque pese poco: una foto de 4000 px no tiene por qué viajar al celular de quien visita la tienda.
 */
async function prepararPorDefecto(archivo: File, opciones: { ladoMaximo?: number } = {}): Promise<{ blob: Blob; mimeType: string }> {
  if (!(TIPOS_IMAGEN_PERMITIDOS as readonly string[]).includes(archivo.type)) throw new Error("Usa una imagen JPG, PNG o WebP.");
  const liviana = archivo.size <= MAX_BYTES_SIN_COMPRIMIR;
  if (liviana && opciones.ladoMaximo === undefined) return { blob: archivo, mimeType: archivo.type };
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    if (liviana) return { blob: archivo, mimeType: archivo.type }; // no se puede reducir aquí: el servidor la limita de todos modos
    throw new Error("La imagen pesa demasiado. Redúcela e intenta de nuevo.");
  }
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, (opciones.ladoMaximo ?? 2400) / Math.max(bitmap.width, bitmap.height));
  if (liviana && escala === 1) {
    bitmap.close?.();
    return { blob: archivo, mimeType: archivo.type };
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolver) => canvas.toBlob(resolver, "image/webp", 0.86));
  if (!blob || blob.size > MAX_BYTES_SIN_COMPRIMIR) throw new Error("La imagen pesa demasiado. Redúcela e intenta de nuevo.");
  return { blob, mimeType: "image/webp" };
}

async function subirPorDefecto(ticket: TicketSubida, blob: Blob, mimeType: string): Promise<CmsResult<null>> {
  const { error } = await supabaseBrowser().storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, blob, { contentType: mimeType });
  if (error) return { ok: false, error: { code: "UPLOAD_FAILED", message: `No se pudo subir ${mimeType.startsWith("video/") ? "el video" : "la imagen"}. Revisa tu conexión e intenta de nuevo.`, status: 0 } };
  return { ok: true, data: null };
}

export function createCmsClient(accessToken: string, opciones: OpcionesCliente = {}) {
  const f: typeof fetch = opciones.fetch ?? ((...args) => fetch(...args));
  const get = <T>(ruta: string) => llamar<T>(f, accessToken, ruta);
  const post = <T>(ruta: string, cuerpo?: unknown) => llamar<T>(f, accessToken, ruta, { method: "POST", ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }) });
  const accion = (id: string, nombre: "pausar" | "reanudar" | "despublicar" | "archivar" | "desarchivar") => post<{ entidad: EntidadDetalle }>(`/entidades/${encodeURIComponent(id)}/${nombre}`);

  /** Sube una imagen en 3 etapas: preparar (reducir si hace falta) → pedir la URL firmada → subir DIRECTO a Storage → confirmar. `ladoMaximo`: reducirla antes de subir si es más grande. */
  const subirImagen = async (archivo: File, opts: { onEtapa?: (e: EtapaSubida) => void; ladoMaximo?: number } = {}): Promise<CmsResult<{ imagen: ImagenVista }>> => {
    opts.onEtapa?.("preparando");
    let preparada: { blob: Blob; mimeType: string };
    try {
      preparada = await (opciones.preparar ?? prepararPorDefecto)(archivo, opts.ladoMaximo === undefined ? undefined : { ladoMaximo: opts.ladoMaximo });
    } catch (err) {
      return { ok: false, error: { code: "IMAGE_INVALID", message: err instanceof Error && err.message ? err.message : "No pudimos procesar esta imagen.", status: 0 } };
    }
    opts.onEtapa?.("subiendo");
    const ticket = await post<{ subida: TicketSubida }>("/imagenes/upload-url", { mimeType: preparada.mimeType, bytes: preparada.blob.size, nombreOriginal: archivo.name });
    if (!ticket.ok) return ticket;
    const subida = await (opciones.subir ?? subirPorDefecto)(ticket.data.subida, preparada.blob, preparada.mimeType);
    if (!subida.ok) return subida;
    opts.onEtapa?.("confirmando");
    return post(`/imagenes/${encodeURIComponent(ticket.data.subida.id)}/confirmar`);
  };

  return {
    listar(filtro: FiltroListadoCliente = {}): Promise<CmsResult<{ items: EntidadResumen[] }>> {
      const qs = new URLSearchParams();
      if (filtro.tipo) qs.set("tipo", filtro.tipo);
      if (filtro.estado) qs.set("estado", filtro.estado);
      if (filtro.archivadas) qs.set("archivadas", "true");
      return get(`/entidades${qs.size > 0 ? `?${qs.toString()}` : ""}`);
    },
    obtener: (id: string) => get<{ entidad: EntidadDetalle }>(`/entidades/${encodeURIComponent(id)}`),
    crear: (tipo: TipoEntidad, borrador: Record<string, unknown>) => post<{ entidad: EntidadDetalle }>("/entidades", { tipo, borrador }),
    guardarBorrador: (id: string, borrador: Record<string, unknown>, rev: number) =>
      llamar<{ entidad: EntidadDetalle }>(f, accessToken, `/entidades/${encodeURIComponent(id)}/borrador`, { method: "PUT", body: JSON.stringify({ borrador, rev }) }),
    validar: (id: string) => post<{ validacion: ResultadoValidacion }>(`/entidades/${encodeURIComponent(id)}/validar`),
    publicar: (id: string, rev: number, nota?: string | null) => post<{ entidad: EntidadDetalle; version: number; advertencias: Problema[] }>(`/entidades/${encodeURIComponent(id)}/publicar`, { rev, ...(nota ? { nota } : {}) }),
    restaurar: (id: string, version: number, nota?: string | null) => post<{ entidad: EntidadDetalle; version: number }>(`/entidades/${encodeURIComponent(id)}/restaurar`, { version, ...(nota ? { nota } : {}) }),
    pausar: (id: string) => accion(id, "pausar"),
    reanudar: (id: string) => accion(id, "reanudar"),
    despublicar: (id: string) => accion(id, "despublicar"),
    archivar: (id: string) => accion(id, "archivar"),
    desarchivar: (id: string) => accion(id, "desarchivar"),
    versiones: (id: string) => get<{ versiones: VersionCms[] }>(`/entidades/${encodeURIComponent(id)}/versiones`),
    auditoria(params: { entidad?: string; limite?: number; antes?: number } = {}): Promise<CmsResult<{ registros: RegistroAuditoria[] }>> {
      const qs = new URLSearchParams();
      if (params.entidad) qs.set("entidad", params.entidad);
      if (params.limite) qs.set("limite", String(params.limite));
      if (params.antes) qs.set("antes", String(params.antes));
      return get(`/auditoria${qs.size > 0 ? `?${qs.toString()}` : ""}`);
    },
    contexto: () => get<ContextoTienda>("/contexto"),
    /** En qué partes de la tienda está elegida una categoría del catálogo (publicado y borradores): lo que deja de mostrarse si se elimina. */
    usosDeCategoria: (id: string) => get<{ usos: UsoCategoria[] }>(`/categorias/${encodeURIComponent(id)}/usos`),
    productos(params: { q?: string; referencias?: readonly string[] } = {}): Promise<CmsResult<{ items: ProductoVista[] }>> {
      const qs = new URLSearchParams();
      if (params.referencias && params.referencias.length > 0) qs.set("referencias", params.referencias.join(","));
      else if (params.q) qs.set("q", params.q);
      return get(`/productos${qs.size > 0 ? `?${qs.toString()}` : ""}`);
    },
    imagenes: () => get<{ items: ImagenVista[] }>("/imagenes"),
    videos: () => get<{ items: VideoVista[] }>("/videos"),

    subirImagen,

    /**
     * Sube un video para un espacio de la tienda en tres etapas: su imagen fija (la que se ve mientras el video carga; ya tomada en el navegador), el video DIRECTO a Storage y la verificación
     * del servidor, que vuelve a analizarlo con las reglas del espacio. Si el servidor lo rechaza, el error trae `problemas` (qué regla falla y cómo arreglarla).
     */
    async subirVideo(archivo: File, destino: ArchivoVideoId, imagenFija: Blob, opts: { onEtapa?: (e: EtapaSubidaVideo) => void } = {}): Promise<CmsResult<VideoConfirmado & { imagen: ImagenVista }>> {
      opts.onEtapa?.("imagen-fija");
      const foto = new File([imagenFija], `imagen-fija-${destino.replace(".", "-")}.jpg`, { type: imagenFija.type || "image/jpeg" });
      const imagen = await subirImagen(foto, { ladoMaximo: 1280 });
      if (!imagen.ok) return imagen;
      opts.onEtapa?.("subiendo");
      const ticket = await post<{ subida: TicketSubida }>("/videos/upload-url", { mimeType: "video/mp4", bytes: archivo.size, nombreOriginal: archivo.name });
      if (!ticket.ok) return ticket;
      const subida = await (opciones.subir ?? subirPorDefecto)(ticket.data.subida, archivo, "video/mp4");
      if (!subida.ok) return subida;
      opts.onEtapa?.("verificando");
      const confirmado = await post<VideoConfirmado>(`/videos/${encodeURIComponent(ticket.data.subida.id)}/confirmar`, { archivo: destino });
      if (!confirmado.ok) return confirmado;
      return { ok: true, data: { ...confirmado.data, imagen: imagen.data.imagen } };
    },
  };
}

export type CmsClient = ReturnType<typeof createCmsClient>;
