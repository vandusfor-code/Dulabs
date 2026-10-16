/**
 * CMS comercial — esquemas de las peticiones HTTP (cuerpo y consulta) de /api/dashboard/tienda/*.
 * El contenido de un elemento NO se valida aquí: viaja como objeto y lo normaliza y valida el servicio (borrador seguro al guardar, validación completa al publicar).
 */
import { z } from "zod";
import { ESTADOS_ENTIDAD, TIPOS_ENTIDAD } from "@/lib/cms-comercial/contrato";
import { MAX_BYTES_SUBIDA } from "@/lib/cms-comercial/imagen-servidor";
import { TIPOS_SUBIDA } from "@/lib/cms-comercial/imagenes";
import { TIPO_VIDEO } from "@/lib/cms-comercial/videos";
import { ARCHIVOS_VIDEO, MAX_BYTES_VIDEO, pesoLegible } from "@/lib/cms-comercial/video-requisitos";

const contenido = z.record(z.string(), z.unknown(), { message: "El contenido debe ser un objeto." });
const rev = z.number({ message: "Falta la revisión del elemento." }).int().min(1, { message: "La revisión no es válida." });
const nota = z.string({ message: "La nota debe ser un texto." }).max(500, { message: "La nota no puede superar 500 caracteres." }).nullish();

export const cuerpoCrear = z.strictObject({ tipo: z.enum(TIPOS_ENTIDAD, { message: "El tipo de elemento no es válido." }), borrador: contenido });
export const cuerpoBorrador = z.strictObject({ borrador: contenido, rev });
export const cuerpoPublicar = z.strictObject({ rev, nota });
export const cuerpoRestaurar = z.strictObject({ version: z.number({ message: "Falta la versión a restaurar." }).int().min(1, { message: "La versión no es válida." }), nota });

export const consultaListar = z.object({
  tipo: z.enum(TIPOS_ENTIDAD, { message: "El tipo no es válido." }).optional(),
  estado: z.enum(ESTADOS_ENTIDAD, { message: "El estado no es válido." }).optional(),
  archivadas: z.enum(["true", "false"], { message: "El filtro de archivadas no es válido." }).optional(),
});

export const consultaAuditoria = z.object({
  entidad: z.uuid({ message: "El elemento no es válido." }).optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
  antes: z.coerce.number().int().min(1).optional(),
});

/** Acciones de estado que se ejecutan con POST /entidades/{id}/{accion}. */
export const ACCIONES_DE_ESTADO = ["pausar", "reanudar", "despublicar", "archivar", "desarchivar"] as const;
export type AccionDeEstado = (typeof ACCIONES_DE_ESTADO)[number];
export const esAccionDeEstado = (v: string): v is AccionDeEstado => (ACCIONES_DE_ESTADO as readonly string[]).includes(v);

export const cuerpoSubidaImagen = z.strictObject({
  mimeType: z.enum(TIPOS_SUBIDA, { message: "Usa una imagen JPG, PNG o WebP." }),
  bytes: z.number({ message: "Falta el tamaño de la imagen." }).int().min(1, { message: "La imagen está vacía." }).max(MAX_BYTES_SUBIDA, { message: "La imagen supera el tamaño máximo permitido (6 MB)." }),
  nombreOriginal: z.string({ message: "El nombre del archivo debe ser un texto." }).max(200, { message: "El nombre del archivo es demasiado largo." }).nullish(),
});

export const cuerpoSubidaVideo = z.strictObject({
  mimeType: z.literal(TIPO_VIDEO, { message: "Usa un video MP4 (con video H.264)." }),
  bytes: z
    .number({ message: "Falta el tamaño del video." })
    .int()
    .min(1, { message: "El video está vacío." })
    .max(MAX_BYTES_VIDEO, { message: `El video supera el tamaño máximo permitido (${pesoLegible(MAX_BYTES_VIDEO)}).` }),
  nombreOriginal: z.string({ message: "El nombre del archivo debe ser un texto." }).max(200, { message: "El nombre del archivo es demasiado largo." }).nullish(),
});

/** Al confirmar, el espacio donde se va a usar el video: de él dependen las medidas y la proporción que se le exigen. */
export const cuerpoConfirmarVideo = z.strictObject({ archivo: z.enum(ARCHIVOS_VIDEO, { message: "El espacio del video no es válido." }) });

export const consultaProductos = z.object({
  q: z.string().max(80, { message: "La búsqueda es demasiado larga." }).optional(),
  /** Referencias separadas por coma (para mostrar los productos ya elegidos). */
  referencias: z.string().max(2000, { message: "Son demasiadas referencias." }).optional(),
});
