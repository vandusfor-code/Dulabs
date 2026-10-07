/**
 * CMS comercial — PUENTE de pruebas entre el Supabase en memoria (lib/testing/supabase-rest-memoria.ts, que emula la autenticación, el equipo y los módulos que
 * usan las rutas) y el Postgres embebido (PGlite): las llamadas `rpc/dulabs_cms_*` van al SQL REAL; todo lo demás sigue en el emulador. Así una ruta de la API
 * se prueba de punta a punta: sesión, rol, módulo, servicio, repositorio y base de datos.
 *
 * Con `almacen` también emula Supabase Storage para las rutas de imágenes.
 * Solo para pruebas.
 */
import type { AlmacenMemoria } from "@/lib/cms-comercial/testing/almacen-memoria";
import type { BaseCms } from "@/lib/cms-comercial/testing/pglite";

export interface PuenteRpc {
  /** Llamadas a funciones del CMS recibidas (nombre), para afirmar que una petición rechazada NO llegó a la base. */
  llamadas: string[];
  /** Falla a propósito la próxima llamada a esa función (para probar que un error de base de datos no se filtra al cliente). */
  fallarProxima(nombre: string): void;
  /** Con `true`, el limitador de tasa responde «demasiadas solicitudes» (429) hasta que se vuelva a poner en `false`. */
  bloquearTasa(bloqueada: boolean): void;
  /** Veces que las rutas consultaron el limitador de tasa (para afirmar que una ruta lo aplica). */
  readonly llamadasTasa: number;
  restaurar(): void;
}

export function instalarPuenteRpcCms(base: BaseCms, urlBase: string, opciones: { almacen?: AlmacenMemoria } = {}): PuenteRpc {
  const original = globalThis.fetch;
  const origen = new URL(urlBase).origin;
  const llamadas: string[] = [];
  const fallar = new Set<string>();
  const tasa = { llamadas: 0, bloqueada: false };

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    // Storage (subida firmada, info, lectura pública, escritura y borrado): al almacén en memoria, si se instaló.
    if (opciones.almacen && url.origin === origen) {
      const r = await opciones.almacen.manejarHttp(url, init ?? (typeof input === "object" && !(input instanceof URL) ? { method: (input as Request).method, headers: (input as Request).headers } : undefined));
      if (r) return r;
    }
    // Limitador de tasa (RPC genérico de DuLabs): cuenta las llamadas y deja pasar, salvo que la prueba lo bloquee a propósito.
    if (url.origin === origen && url.pathname === "/rest/v1/rpc/dulabs_rate_limit_incrementar") {
      tasa.llamadas++;
      return Response.json([{ permitido: !tasa.bloqueada, conteo: tasa.llamadas, reinicia_en: new Date(Date.now() + 60_000).toISOString() }]);
    }
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
    bloquearTasa: (bloqueada) => void (tasa.bloqueada = bloqueada),
    get llamadasTasa() {
      return tasa.llamadas;
    },
    restaurar: () => {
      globalThis.fetch = original;
    },
  };
}
