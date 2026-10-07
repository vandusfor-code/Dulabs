/**
 * CMS comercial — ALMACÉN DE IMÁGENES EN MEMORIA para pruebas. Un solo almacén que sirve de dos maneras:
 *   - como el puerto `AlmacenImagenes` (pruebas del servicio, sin red);
 *   - como un emulador del HTTP de Supabase Storage (`/storage/v1/...`) que usan las rutas reales a través de supabase-js (pruebas de rutas), incluida la URL pública.
 * Solo para pruebas.
 */
import type { AlmacenImagenes } from "@/lib/cms-comercial/almacen";

export const BUCKET_PRUEBA = "inventario-productos";

export interface AlmacenMemoria extends AlmacenImagenes {
  objetos: Map<string, { bytes: Uint8Array; contentType: string }>;
  /** Lo que haría el navegador con la URL firmada: sube el archivo a la ruta temporal. */
  subirComoNavegador(path: string, bytes: Uint8Array, contentType?: string): void;
  /** Emula las rutas HTTP de Storage; null si la URL no es de Storage. */
  manejarHttp(url: URL, init?: RequestInit): Promise<Response | null>;
  /** Llamadas recibidas (para afirmar que algo NO llegó al almacén). */
  llamadas: string[];
}

export function crearAlmacenMemoria(urlBase = "http://supabase.memoria"): AlmacenMemoria {
  const objetos = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const llamadas: string[] = [];
  const tokens = new Map<string, string>();
  let serie = 0;

  const prefijo = `/storage/v1/object/`;
  const sinBucket = (resto: string) => {
    const i = resto.indexOf("/");
    return { bucket: resto.slice(0, i), path: decodeURIComponent(resto.slice(i + 1)) };
  };
  const json = (cuerpo: unknown, status = 200) => Response.json(cuerpo, { status });
  const noExiste = () => json({ statusCode: "404", error: "not_found", message: "Object not found" }, 404);

  const almacen: AlmacenMemoria = {
    bucket: BUCKET_PRUEBA,
    objetos,
    llamadas,

    async firmarSubida(path) {
      llamadas.push(`firmar:${path}`);
      const token = `tk-${++serie}`;
      tokens.set(token, path);
      return { path, token };
    },
    async info(path) {
      llamadas.push(`info:${path}`);
      const o = objetos.get(path);
      return o ? { size: o.bytes.byteLength, contentType: o.contentType } : null;
    },
    async leer(path, maxBytes) {
      llamadas.push(`leer:${path}`);
      const o = objetos.get(path);
      return o && o.bytes.byteLength <= maxBytes ? o.bytes : null;
    },
    async escribir(path, bytes, contentType) {
      llamadas.push(`escribir:${path}`);
      objetos.set(path, { bytes, contentType });
    },
    async borrar(paths) {
      llamadas.push(`borrar:${paths.join(",")}`);
      for (const p of paths) objetos.delete(p);
    },
    urlPublica: (path) => `${urlBase}${prefijo}public/${BUCKET_PRUEBA}/${path}`,

    subirComoNavegador(path, bytes, contentType = "application/octet-stream") {
      objetos.set(path, { bytes, contentType });
    },

    async manejarHttp(url, init) {
      if (!url.pathname.startsWith(prefijo)) return null;
      const metodo = (init?.method ?? "GET").toUpperCase();
      const resto = url.pathname.slice(prefijo.length);
      const cuerpoCrudo = async () => {
        const b = init?.body;
        if (b === undefined || b === null) return new Uint8Array();
        if (typeof b === "string") return new TextEncoder().encode(b);
        if (b instanceof Uint8Array) return b;
        if (b instanceof ArrayBuffer) return new Uint8Array(b);
        return new Uint8Array(await new Response(b as BodyInit).arrayBuffer());
      };
      const tipoDe = () => new Headers(init?.headers).get("content-type") ?? "application/octet-stream";

      if (metodo === "POST" && resto.startsWith("upload/sign/")) {
        const { path } = sinBucket(resto.slice("upload/sign/".length));
        llamadas.push(`http-firmar:${path}`);
        const token = `tk-${++serie}`;
        tokens.set(token, path);
        return json({ url: `/object/upload/sign/${BUCKET_PRUEBA}/${path}?token=${token}` });
      }
      if (metodo === "PUT" && resto.startsWith("upload/sign/")) {
        const path = tokens.get(url.searchParams.get("token") ?? "");
        if (!path) return json({ statusCode: "403", error: "Unauthorized", message: "invalid token" }, 403);
        objetos.set(path, { bytes: await cuerpoCrudo(), contentType: tipoDe() });
        return json({ Key: `${BUCKET_PRUEBA}/${path}` });
      }
      if (metodo === "GET" && resto.startsWith("info/")) {
        const { path } = sinBucket(resto.slice("info/".length));
        llamadas.push(`http-info:${path}`);
        const o = objetos.get(path);
        return o ? json({ id: path, name: path, size: o.bytes.byteLength, content_type: o.contentType, version: "1" }) : noExiste();
      }
      if (metodo === "GET" && resto.startsWith("public/")) {
        const { path } = sinBucket(resto.slice("public/".length));
        llamadas.push(`http-publico:${path}`);
        const o = objetos.get(path);
        return o ? new Response(o.bytes as BodyInit, { status: 200, headers: { "content-type": o.contentType, "content-length": String(o.bytes.byteLength) } }) : noExiste();
      }
      if (metodo === "POST") {
        const { path } = sinBucket(resto);
        llamadas.push(`http-escribir:${path}`);
        objetos.set(path, { bytes: await cuerpoCrudo(), contentType: tipoDe() });
        return json({ Id: path, Key: `${BUCKET_PRUEBA}/${path}` });
      }
      if (metodo === "DELETE") {
        const { prefixes } = JSON.parse(new TextDecoder().decode(await cuerpoCrudo())) as { prefixes: string[] };
        llamadas.push(`http-borrar:${prefixes.join(",")}`);
        for (const p of prefixes) objetos.delete(p);
        return json([]);
      }
      return json({ error: `storage-memoria: no soporta ${metodo} ${url.pathname}` }, 500);
    },
  };
  return almacen;
}
