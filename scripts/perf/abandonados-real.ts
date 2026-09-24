/**
 * Bloque 23 — vencimiento de pedidos abandonados con el motor REAL contra PostgREST + PostgreSQL
 * LOCALES (nunca Supabase). Dos "crons" a la vez: cada pedido vence UNA sola vez (compare-and-set).
 *   SUPABASE_URL=http://127.0.0.1:54452 SUPABASE_SERVICE_ROLE_KEY=local npx tsx scripts/perf/abandonados-real.ts
 */
import { createClient } from "@supabase/supabase-js";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createSupabaseOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";

const url = process.env.SUPABASE_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("Solo contra un PostgREST LOCAL.");
const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "local", { auth: { persistSession: false } });
const futuro = () => new Date(Date.now() + 4 * 24 * 3600 * 1000);
const engine = () =>
  createOrderEngine({ orders: createSupabaseOrdersRepository(supabase), catalog: createSupabaseCatalogRepository(supabase), key: Buffer.alloc(32, 5), log: () => {}, now: futuro });

async function main() {
  const [a, b] = await Promise.all([engine().expireAbandonedOrders({ limit: 500 }), engine().expireAbandonedOrders({ limit: 500 })]);
  const again = await engine().expireAbandonedOrders({ limit: 500 });
  console.log(JSON.stringify({ cron1: a, cron2: b, total: a + b, segunda_pasada: again }));
}

void main();
