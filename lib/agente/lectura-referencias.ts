/**
 * Bloque 29 — lectura de la REFERENCIA escrita en una foto que envía el cliente (la marca
 * `DL-000087` que el catálogo estampa en sus fotos, o una captura de la tienda).
 *
 * - Solo se leen CÓDIGOS con forma de referencia (LETRAS-NÚMEROS). Nunca se identifica una joya
 *   por cómo se ve: el código leído se valida después contra el catálogo del negocio (runtime.ts);
 *   si no existe, se pide escrito.
 * - La foto se descarga de Meta con el token del número y se envía a Gemini una sola vez, sin
 *   guardarla. Topes: 5 MB, JPEG/PNG/WebP, 8 s por llamada. Cualquier falla => sin lectura.
 * - La API key viaja solo en el header x-goog-api-key y nunca se registra.
 */

export const LECTURA_MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 8_000;
const MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

type Fetch = typeof fetch;

export const PROMPT_LECTURA =
  "Esta imagen puede tener uno o varios códigos de producto con el formato LETRAS-NÚMEROS (por ejemplo DL-000087), " +
  "normalmente en una etiqueta en una esquina de la foto. Responde SOLO con los códigos que veas escritos, separados por coma, " +
  "exactamente como aparecen. Si no ves ninguno, responde NINGUNO. No describas la imagen ni agregues nada más.";

/** Códigos con forma de referencia en un texto (mayúsculas, sin espacios alrededor del guion, sin repetir; máx. 5). */
export function extraerReferencias(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.toUpperCase().matchAll(/(?<![A-Z0-9])([A-Z]{1,6})\s*[-–]\s*(\d{6,9})(?!\d)/g)) {
    const ref = `${m[1]}-${m[2]}`;
    if (!out.includes(ref)) out.push(ref);
  }
  return out.slice(0, 5);
}

async function leerCuerpo(res: Response, max: number): Promise<Uint8Array | null> {
  const largo = Number(res.headers.get("content-length") ?? "0");
  if (largo > max) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.byteLength > 0 && buf.byteLength <= max ? buf : null;
}

/** Descarga una imagen entrante de WhatsApp (Cloud API: /{media-id} -> url -> bytes). null si no se puede o no conviene. */
export async function descargarImagenMeta(input: { mediaId: string; token: string; fetch?: Fetch; graphBaseUrl?: string }): Promise<{ data: Uint8Array; mime: string } | null> {
  const f = input.fetch ?? fetch;
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(input.mediaId)) return null;
  const auth = { Authorization: `Bearer ${input.token}` };
  const meta = await f(`${input.graphBaseUrl ?? GRAPH}/${input.mediaId}`, { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!meta.ok) return null;
  const info = (await meta.json().catch(() => null)) as { url?: unknown; mime_type?: unknown; file_size?: unknown } | null;
  const mime = typeof info?.mime_type === "string" ? info.mime_type.split(";")[0].trim().toLowerCase() : "";
  if (typeof info?.url !== "string" || !/^https:\/\//.test(info.url) || !MIMES.has(mime)) return null;
  if (typeof info.file_size === "number" && info.file_size > LECTURA_MAX_BYTES) return null;
  const res = await f(info.url, { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = await leerCuerpo(res, LECTURA_MAX_BYTES);
  return data ? { data, mime } : null;
}

/** Pide a Gemini SOLO los códigos escritos en la imagen. Devuelve los que tienen forma de referencia. */
export async function leerReferenciasEnImagen(input: { data: Uint8Array; mime: string; apiKey: string; model: string; fetch?: Fetch; baseUrl?: string }): Promise<string[]> {
  const f = input.fetch ?? fetch;
  const base = (input.baseUrl ?? GEMINI).replace(/\/+$/, "");
  const res = await f(`${base}/models/${input.model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: input.mime, data: Buffer.from(input.data).toString("base64") } }, { text: PROMPT_LECTURA }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 512 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }> } | null;
  const texto = (body?.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text as string)
    .join(" ");
  return extraerReferencias(texto);
}

/** Lector completo (descarga de Meta + lectura con Gemini). Cualquier error => [] (el agente pide la referencia escrita). */
export function crearLectorDeReferencias(input: { token: string | null; apiKey: string; model: string; fetch?: Fetch; baseUrl?: string; graphBaseUrl?: string }): (mediaId: string) => Promise<string[]> {
  return async (mediaId) => {
    if (!input.token) return [];
    try {
      const img = await descargarImagenMeta({ mediaId, token: input.token, fetch: input.fetch, graphBaseUrl: input.graphBaseUrl });
      if (!img) return [];
      return await leerReferenciasEnImagen({ ...img, apiKey: input.apiKey, model: input.model, fetch: input.fetch, baseUrl: input.baseUrl });
    } catch {
      return [];
    }
  };
}
