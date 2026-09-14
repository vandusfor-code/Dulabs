// Validación de archivos de subida COMPARTIDA entre el cliente (chequeo previo
// e instantáneo antes de gastar una request) y el servidor (validación real,
// nunca se confía en el cliente). Este módulo es deliberadamente ligero: NO
// importa dependencias pesadas de servidor (exceljs / pdf-parse), así puede
// usarse dentro de un componente de cliente sin inflar el bundle ni arrastrar
// APIs de Node al navegador.

// Límite de tamaño de la subida. Vercel rechaza a NIVEL DE PLATAFORMA los
// cuerpos de request de una función serverless por encima de ~4.5 MB, ANTES de
// que corra nuestro código (un 413 opaco, sin JSON). 4 MB deja margen para el
// overhead de multipart/form-data y garantiza que se vea NUESTRO mensaje de
// error claro en vez de un fallo silencioso de la plataforma. Para esta
// funcionalidad (extraer texto como contexto del bot, tope de 100 000
// caracteres) 4 MB de PDF con texto ya excede de sobra lo aprovechable, así que
// es un límite de PRODUCTO razonable, no un parche.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_MB = 4;

// Extensiones aceptadas por la base de conocimiento. `.xls` (binario legacy) NO
// está: exceljs no lo lee y el backend lo rechaza — incluirlo en el `accept`
// del input solo produce un error confuso tras subirlo.
export const EXTENSIONES_CONOCIMIENTO = ["pdf", "xlsx", "csv"] as const;

export function extensionDe(nombre: string): string {
  return nombre.split(".").pop()?.toLowerCase() ?? "";
}

export type ResultadoValidacion = { ok: true } | { ok: false; error: string };

/** MB con un decimal, para mensajes ("El archivo pesa 6.3 MB…"). */
export function bytesAMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

// Valida nombre + tamaño de un archivo de conocimiento y devuelve un mensaje
// claro y accionable cuando algo no cuadra. Pensada para llamarse tanto en el
// navegador (con un objeto `{ name, size }` del `File`) como en el servidor.
export function validarArchivoConocimiento(
  archivo: { name: string; size: number },
  opciones?: { extensiones?: readonly string[]; maxBytes?: number }
): ResultadoValidacion {
  const extensiones = opciones?.extensiones ?? EXTENSIONES_CONOCIMIENTO;
  const maxBytes = opciones?.maxBytes ?? MAX_UPLOAD_BYTES;

  const ext = extensionDe(archivo.name);
  if (!ext || !extensiones.includes(ext)) {
    const lista = extensiones.map((e) => `.${e}`).join(", ");
    return { ok: false, error: `Formato no soportado. Sube un archivo ${lista}.` };
  }
  if (!Number.isFinite(archivo.size) || archivo.size <= 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (archivo.size > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return {
      ok: false,
      error: `El archivo pesa ${bytesAMb(archivo.size)} MB y supera el límite de ${maxMb} MB. Comprime el PDF o sube solo las páginas con texto (también puedes usar Excel/CSV).`,
    };
  }
  return { ok: true };
}
