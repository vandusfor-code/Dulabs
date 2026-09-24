/**
 * Bloque 21 — el límite de las páginas del catálogo contra Postgres REAL (local): el contador
 * dulabs_rate_limit_incrementar es atómico bajo concurrencia. 700 peticiones SIMULTÁNEAS del mismo
 * cliente => exactamente 600 permitidas; las de otro cliente no se afectan; búsquedas aparte.
 * Nunca contra Supabase: requiere el PostgREST local de scripts/perf (README) con la migración
 * 20261001000000_dulabs_rate_limit.sql aplicada.
 *
 * Uso: PERF_REST=http://127.0.0.1:54440 npx tsx scripts/perf/limite-concurrencia.ts
 */
import { createClient } from "@supabase/supabase-js";
import { crearLimitadorPaginas } from "@/lib/catalogo/limite-paginas";
import { verificarLimiteTasa } from "@/lib/rate-limit";

const REST = process.env.PERF_REST ?? "http://127.0.0.1:54440";
const supabase = createClient("http://perf.local", "local-sin-jwt", {
  auth: { persistSession: false },
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.delete("authorization");
      headers.delete("apikey");
      return fetch(String(input).replace("http://perf.local/rest/v1", REST), { ...init, headers });
    },
  },
});

async function main() {
  // Una ventana nueva y claves únicas por corrida: el contador real no se contamina entre corridas.
  const sufijo = Math.random().toString(36).slice(2, 8);
  const decidir = crearLimitadorPaginas({ verificar: (i) => verificarLimiteTasa(supabase, i), timeoutMs: 10_000 });
  const pedir = (path: string, ip: string) => new Request(`https://perf.local${path}`, { headers: { "x-real-ip": ip } });
  const ip = `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  // Alinear al inicio de un minuto para que las 700 caigan en la misma ventana.
  const resto = 60_000 - (Date.now() % 60_000);
  if (resto < 8_000) await new Promise((r) => setTimeout(r, resto + 200));

  const t0 = performance.now();
  const r = await Promise.all(Array.from({ length: 700 }, (_, i) => decidir(pedir(`/catalogo/perf-${sufijo}?pagina=${i}`, ip))));
  const ms = performance.now() - t0;
  const ok = r.filter((d) => d?.permitido).length;
  const otro = await decidir(pedir(`/catalogo/perf-${sufijo}`, `${ip}1`));
  const busquedas = await Promise.all(Array.from({ length: 150 }, (_, i) => decidir(pedir(`/catalogo/perf-${sufijo}?q=x${i}`, `${ip}2`))));
  const okBusqueda = busquedas.filter((d) => d?.permitido).length;

  console.log(`700 simultáneas del mismo cliente: permitidas ${ok} (esperado 600) en ${ms.toFixed(0)} ms`);
  console.log(`otro cliente al mismo tiempo: ${otro?.permitido ? "permitido" : "BLOQUEADO"}`);
  console.log(`150 búsquedas simultáneas de un cliente: permitidas ${okBusqueda} (esperado 120)`);
  if (ok !== 600 || !otro?.permitido || okBusqueda !== 120) throw new Error("FALLA: el contador distribuido no es exacto bajo concurrencia");
  console.log("OK límite distribuido exacto bajo concurrencia");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
