/**
 * CMS comercial — un `fetch` de PRUEBA que lleva las llamadas del cliente del navegador (lib/cms-comercial-client.ts) a los handlers REALES de
 * /api/dashboard/tienda/*, sin red. Con el SQL real en Postgres embebido (testing/pglite.ts) y el Supabase en memoria, una prueba de pantalla recorre
 * la pantalla → el cliente → la ruta (sesión, rol, módulo) → el servicio → la base, exactamente como en producción. Solo para pruebas.
 */
import { NextRequest } from "next/server";
import { GET as auditoriaGET } from "@/app/api/dashboard/tienda/auditoria/route";
import { GET as contextoGET } from "@/app/api/dashboard/tienda/contexto/route";
import { GET as listarGET, POST as crearPOST } from "@/app/api/dashboard/tienda/entidades/route";
import { GET as detalleGET } from "@/app/api/dashboard/tienda/entidades/[id]/route";
import { PUT as borradorPUT } from "@/app/api/dashboard/tienda/entidades/[id]/borrador/route";
import { POST as accionPOST } from "@/app/api/dashboard/tienda/entidades/[id]/[accion]/route";
import { POST as publicarPOST } from "@/app/api/dashboard/tienda/entidades/[id]/publicar/route";
import { POST as restaurarPOST } from "@/app/api/dashboard/tienda/entidades/[id]/restaurar/route";
import { POST as validarPOST } from "@/app/api/dashboard/tienda/entidades/[id]/validar/route";
import { GET as versionesGET } from "@/app/api/dashboard/tienda/entidades/[id]/versiones/route";
import { GET as imagenesGET } from "@/app/api/dashboard/tienda/imagenes/route";
import { POST as confirmarPOST } from "@/app/api/dashboard/tienda/imagenes/[id]/confirmar/route";
import { POST as subidaPOST } from "@/app/api/dashboard/tienda/imagenes/upload-url/route";
import { GET as productosGET } from "@/app/api/dashboard/tienda/productos/route";

const PREFIJO = "/api/dashboard/tienda";

export interface FetchRutas {
  fetch: typeof fetch;
  /** Cada llamada que hizo el navegador: método y ruta (sin el prefijo), en orden. */
  llamadas: Array<{ metodo: string; ruta: string }>;
}

export function crearFetchRutas(): FetchRutas {
  const llamadas: FetchRutas["llamadas"] = [];
  const f = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url, "http://localhost");
    const metodo = (init?.method ?? "GET").toUpperCase();
    const ruta = url.pathname.startsWith(PREFIJO) ? url.pathname.slice(PREFIJO.length) : url.pathname;
    llamadas.push({ metodo, ruta: `${ruta}${url.search}` });
    const request = new NextRequest(url, { method: metodo, headers: init?.headers as HeadersInit | undefined, body: typeof init?.body === "string" ? init.body : undefined });
    const partes = ruta.split("/").filter(Boolean);
    const conId = (id: string) => ({ params: Promise.resolve({ id }) });

    if (partes[0] === "auditoria") return auditoriaGET(request);
    if (partes[0] === "contexto") return contextoGET(request);
    if (partes[0] === "productos") return productosGET(request);
    if (partes[0] === "imagenes") {
      if (partes.length === 1) return imagenesGET(request);
      if (partes[1] === "upload-url") return subidaPOST(request);
      return confirmarPOST(request, conId(partes[1]));
    }
    if (partes[0] === "entidades") {
      if (partes.length === 1) return metodo === "GET" ? listarGET(request) : crearPOST(request);
      if (partes.length === 2) return detalleGET(request, conId(partes[1]));
      switch (partes[2]) {
        case "borrador":
          return borradorPUT(request, conId(partes[1]));
        case "validar":
          return validarPOST(request, conId(partes[1]));
        case "publicar":
          return publicarPOST(request, conId(partes[1]));
        case "restaurar":
          return restaurarPOST(request, conId(partes[1]));
        case "versiones":
          return versionesGET(request, conId(partes[1]));
        default:
          return accionPOST(request, { params: Promise.resolve({ id: partes[1], accion: partes[2] }) });
      }
    }
    return new Response(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Ruta desconocida." } }), { status: 404, headers: { "content-type": "application/json" } });
  };
  return { fetch: f as typeof fetch, llamadas };
}
