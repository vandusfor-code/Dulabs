/**
 * Bloque 22 — listado del PANEL con productos borrados mientras alguien está en una página alta.
 * PostgREST responde 416 (PGRST103) si la página empieza más allá del total: antes el panel
 * devolvía un error 500; ahora una página vacía con el total REAL (para volver atrás). Repositorio
 * Supabase contra el PostgREST en memoria, que imita ese comportamiento de PostgREST 12. Nada toca
 * Supabase.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { createCatalogService } from "@/lib/catalogo/service";
import { supabaseAdmin } from "@/lib/supabase";
import { installSupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";

const T = "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4";
const OTRO = "bbbbbbbb-0000-4000-8000-00000000000b";

function fila(tenant: string, n: number, activo = true) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    id_tenant: tenant,
    referencia: `DL-${String(n).padStart(6, "0")}`,
    nombre: `Aretes ${n}`,
    descripcion: null,
    precio: 50_000,
    precio_mayor: null,
    material: null,
    color: null,
    categoria: null,
    categoria_id: null,
    activo,
    controla_stock: true,
    stock: 3,
    foto_url: null,
    created_at: new Date(Date.UTC(2026, 8, 24, 12, 0, n)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 8, 24, 12, 0, n)).toISOString(),
  };
}

describe("panel: listado de productos por páginas", () => {
  it("página normal: total REAL de los filtrados (no el tamaño de la página); página más allá del final: vacía, sin error", async () => {
    const db = installSupabaseMemoria(process.env.SUPABASE_URL);
    try {
      db.table("dulabs_inventario_productos");
      db.table("dulabs_catalogo_media");
      for (let n = 1; n <= 7; n++) db.rows("dulabs_inventario_productos").push(fila(T, n, n !== 7));
      for (let n = 1; n <= 30; n++) db.rows("dulabs_inventario_productos").push(fila(OTRO, 100 + n));
      const repo = createSupabaseCatalogRepository(supabaseAdmin());

      const p1 = await repo.listProducts(T, { status: "ALL", offset: 0, limit: 5 });
      assert.equal(p1.items.length, 5);
      assert.equal(p1.total, 7, "total del negocio, no de la página ni de otros negocios");
      const activos = await repo.listProducts(T, { status: "ACTIVE", offset: 5, limit: 5 });
      assert.deepEqual([activos.items.length, activos.total], [1, 6]);

      // Alguien estaba en la página 4 (offset 15) y se borraron productos: página vacía con el total real.
      const fuera = await repo.listProducts(T, { status: "ALL", offset: 15, limit: 5 });
      assert.deepEqual(fuera, { items: [], total: 7 });
      // Justo en el borde (offset = total) PostgREST no falla: también vacía.
      assert.deepEqual(await repo.listProducts(T, { status: "ALL", offset: 7, limit: 5 }), { items: [], total: 7 });

      // A través del servicio del panel (lo que usa la API): nunca un 500.
      const panel = createCatalogService({ repo });
      const r = await panel.listProducts({ tenantId: T, userId: "admin" }, { q: undefined, status: "ALL", page: 40, pageSize: 50 });
      assert.deepEqual([r.items.length, r.total, r.page], [0, 7, 40]);
    } finally {
      db.uninstall();
    }
  });
});
