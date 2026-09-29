/**
 * Bloque 34 — importar clientes desde Excel (.xlsx) o CSV: VISTA PREVIA (nada se escribe).
 *   POST multipart { archivo }  → { filas: [{ fila, nombre, telefono, modalidad, yaCompro, accion, motivo }], resumen }
 * Columnas: Nombre, Celular, Modalidad (detal / mayorista) y, opcional, Ya es cliente (sí / no).
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { CLIENTS_MODULE } from "@/lib/catalogo/auth";
import { apiError } from "@/lib/agent-compiler/api/http";
import { createSupabaseClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import { previsualizarImportacion } from "@/lib/catalogo/clientes/servicio";
import { ARCHIVO_MAX_BYTES, leerTablaClientes } from "@/lib/catalogo/clientes/archivo";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  return withCatalog(
    request,
    "orders",
    async ({ supabase, actor }) => {
      const form = await request.formData().catch(() => null);
      const archivo = form?.get("archivo");
      if (!(archivo instanceof File) || archivo.size === 0) return apiError("VALIDATION_ERROR", "Falta el archivo.", 400);
      if (archivo.size > ARCHIVO_MAX_BYTES) return apiError("VALIDATION_ERROR", "El archivo supera 2 MB.", 400);
      const tabla = await leerTablaClientes(archivo.name, Buffer.from(await archivo.arrayBuffer())).catch(() => null);
      if (!tabla) return apiError("VALIDATION_ERROR", "Sube un archivo .xlsx o .csv (usa la plantilla).", 400);
      return previsualizarImportacion(createSupabaseClientesRepo(supabase), actor.tenantId, tabla);
    },
    { module: CLIENTS_MODULE, recurso: "clientes_importar" },
  );
}
