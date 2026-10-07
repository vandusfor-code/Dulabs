/**
 * CMS comercial — PUENTE de pruebas entre el Supabase en memoria (lib/testing/supabase-rest-memoria.ts, que emula la autenticación, el equipo y los módulos que
 * usan las rutas) y el Postgres embebido (PGlite): las llamadas `rpc/dulabs_cms_*` van al SQL REAL; todo lo demás sigue en el emulador. Así una ruta de la API
 * se prueba de punta a punta: sesión, rol, módulo, servicio, repositorio y base de datos.
 *
 * Solo para pruebas.
 */
import type { BaseCms } from "@/lib/cms-comercial/testing/pglite";

export interface PuenteRpc {
  /** Llamadas a funciones del CMS recibidas (nombre), para afirmar que una petición rechazada NO llegó a la base. */
  llamadas: string[];
  /** Falla a propósito la próxima llamada a esa función (para probar que un error de base de datos no se filtra al cliente). */
  fallarProxima(nombre: string): void;
  restaurar(): void;
}

export function instalarPuenteRpcCms(base: BaseCms, urlBase: string): PuenteRpc {
  const original = globalThis.fetch;
  const origen = new URL(urlBase).origin;
  const llamadas: string[] = [];
  const fallar = new Set<string>();

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const m = /^\/rest\/v1\/rpc\/(dulabs_cms_[a-z_]+)$/.exec(url.pathname);
    if (url.origin !== origen || !m) return original(input as never, init);
    const nombre = m[1];
    llamadas.push(nombre);
    if (fallar.delete(nombre)) {
      return Response.json({ code: "XX000", message: "relation \"dulabs_cms_entidades\" secreto interno de SQL", details: "detalle sensible", hint: null }, { status: 500 });
    }
    const crudo = typeof input === "object" && !(input instanceof URL) && "text" in input ? await (input as Request).clone().text() : String(init?.body ?? "{}");
    const args = JSON.parse(crudo || "{}") as Record<string, unknown>;
    const r = await base.supabase.rpc(nombre, args);
    if (r.error) return Response.json({ code: r.error.code, message: r.error.message, details: r.error.details ?? null, hint: null }, { status: r.error.code === "PGRST202" ? 404 : 400 });
    return Response.json(r.data ?? null, { status: 200 });
  };

  return {
    llamadas,
    fallarProxima: (nombre) => void fallar.add(nombre),
    restaurar: () => {
      globalThis.fetch = original;
    },
  };
}
