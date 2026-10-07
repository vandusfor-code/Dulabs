/**
 * CMS comercial — esquemas de las peticiones HTTP (cuerpo y consulta) de /api/dashboard/tienda/*.
 * El contenido de un elemento NO se valida aquí: viaja como objeto y lo normaliza y valida el servicio (borrador seguro al guardar, validación completa al publicar).
 */
import { z } from "zod";
import { ESTADOS_ENTIDAD, TIPOS_ENTIDAD } from "@/lib/cms-comercial/contrato";

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
