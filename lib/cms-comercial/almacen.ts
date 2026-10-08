/**
 * CMS comercial — ALMACÉN de imágenes (Supabase Storage). Puerto + adaptador.
 *
 * Las imágenes del CMS viven en el bucket EXISTENTE del catálogo (público, URL estable), siempre bajo `{negocio}/cms/{id}/`:
 *   - `subida`      archivo crudo que sube el navegador con una URL firmada (temporal: se borra al confirmar);
 *   - `imagen.webp` la imagen publicada, ya verificada y re-codificada por el servidor.
 * La ruta la decide SIEMPRE el servidor (y la base de datos exige el prefijo); el navegador solo sube a la ruta que se le entrega.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CATALOG_BUCKET } from "@/lib/catalogo/repository";
import { CmsError } from "@/lib/cms-comercial/errores";

export interface AlmacenImagenes {
  bucket: string;
  /** URL firmada de subida (un solo archivo, esa ruta). */
  firmarSubida(path: string): Promise<{ path: string; token: string }>;
  info(path: string): Promise<{ size: number | null; contentType: string | null } | null>;
  /** Lee el objeto completo; null si no existe o si supera `maxBytes`. */
  leer(path: string, maxBytes: number): Promise<Uint8Array | null>;
  escribir(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  borrar(paths: string[]): Promise<void>;
  urlPublica(path: string): string;
}

const ERROR_ALMACEN = "No se pudo completar la operación con las imágenes. Intenta de nuevo.";

export function crearAlmacenSupabase(supabase: SupabaseClient): AlmacenImagenes {
  const storage = () => supabase.storage.from(CATALOG_BUCKET);
  const base = () => `${(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "")}/storage/v1/object/public/${CATALOG_BUCKET}/`;
  const urlPublica = (path: string) => `${base()}${path.split("/").map(encodeURIComponent).join("/")}`;
  return {
    bucket: CATALOG_BUCKET,

    async firmarSubida(path) {
      // upsert false: una ruta emitida no puede sobrescribir un objeto existente.
      const { data, error } = await storage().createSignedUploadUrl(path);
      if (error || !data) {
        console.error("[cms-comercial/almacen] firmarSubida:", error?.message);
        throw new CmsError("INTERNAL_ERROR", ERROR_ALMACEN);
      }
      return { path: data.path, token: data.token };
    },

    async info(path) {
      const { data, error } = await storage().info(path);
      if (error || !data) return null;
      return { size: typeof data.size === "number" ? data.size : null, contentType: data.contentType ?? null };
    },

    async leer(path, maxBytes) {
      // El bucket es público: se lee por su URL pública, sin pasar por la API de Storage, y se corta si supera el tope.
      try {
        const res = await fetch(urlPublica(path), { cache: "no-store" });
        if (!res.ok || !res.body) {
          void res.body?.cancel().catch(() => {});
          return null;
        }
        const declarado = Number(res.headers.get("content-length"));
        if (Number.isFinite(declarado) && declarado > maxBytes) {
          void res.body.cancel().catch(() => {});
          return null;
        }
        const trozos: Uint8Array[] = [];
        let total = 0;
        const lector = res.body.getReader();
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            void lector.cancel().catch(() => {});
            return null;
          }
          trozos.push(value);
        }
        const salida = new Uint8Array(total);
        let desde = 0;
        for (const t of trozos) {
          salida.set(t, desde);
          desde += t.byteLength;
        }
        return salida;
      } catch (err) {
        console.error("[cms-comercial/almacen] leer:", err instanceof Error ? err.message : err);
        return null;
      }
    },

    async escribir(path, bytes, contentType) {
      const { error } = await storage().upload(path, bytes, { contentType, upsert: true, cacheControl: "31536000" });
      if (error) {
        console.error("[cms-comercial/almacen] escribir:", error.message);
        throw new CmsError("INTERNAL_ERROR", ERROR_ALMACEN);
      }
    },

    async borrar(paths) {
      if (paths.length === 0) return;
      const { error } = await storage().remove(paths);
      // No fatal: lo que no se borre queda huérfano (bajo el prefijo del negocio) pero nunca se sirve.
      if (error) console.error("[cms-comercial/almacen] no se pudieron borrar objetos (no fatal):", error.message);
    },

    urlPublica,
  };
}
