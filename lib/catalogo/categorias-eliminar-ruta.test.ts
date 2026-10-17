/**
 * Catálogo — ELIMINAR CATEGORÍAS, las RUTAS reales (/api/dashboard/catalogo/categorias) contra un Supabase EN MEMORIA: sesión, rol, módulo, validación del destino, lo que
 * viaja a la base (siempre acotado al negocio de la sesión) y la traducción de la clave foránea. La clave foránea de verdad se prueba contra Postgres real en
 * categorias-sql.pglite.test.ts. (Esta prueba vive en lib/catalogo y no junto a la ruta porque el corredor lee los corchetes de «[id]» como un comodín y correría 0 pruebas.)
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { CatalogError } from "@/lib/catalogo/errors";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { supabaseAdmin } from "@/lib/supabase";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { GET as categoriasGET } from "@/app/api/dashboard/catalogo/categorias/route";
import { DELETE as categoriaDELETE } from "@/app/api/dashboard/catalogo/categorias/[id]/route";

const T1 = "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4";
const T2 = "bbbbbbbb-0000-4000-8000-000000000002";
const U_ADMIN = "11111111-1111-4111-8111-111111111111";
const U_LECTURA = "22222222-2222-4222-8222-222222222222";
const U_AGENTE = "33333333-3333-4333-8333-333333333333";
const U_OTRO = "44444444-4444-4444-8444-444444444444";
const CREADOR = "55555555-5555-4555-8555-555555555555";
const ARETES = "c0000000-0000-4000-8000-0000000000a1";
const DIJES = "c0000000-0000-4000-8000-0000000000a2";
const VACIA = "c0000000-0000-4000-8000-0000000000a3";
const AJENA = "c0000000-0000-4000-8000-0000000000b1";
const INEXISTENTE = "c0000000-0000-4000-8000-0000000000ff";
const TOKEN_VIEJO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let db: SupabaseMemoria;

const cabeceras = (token: string | null) => (token ? { authorization: `Bearer ${token}` } : undefined);
const borrar = (id: string, consulta = "", token: string | null = "t-admin") =>
  categoriaDELETE(new NextRequest(`http://localhost/api/dashboard/catalogo/categorias/${id}${consulta}`, { method: "DELETE", headers: cabeceras(token) }), { params: Promise.resolve({ id }) });
const listar = (consulta = "", token: string | null = "t-admin") => categoriasGET(new NextRequest(`http://localhost/api/dashboard/catalogo/categorias${consulta}`, { headers: cabeceras(token) }));
const leer = async (r: Response) => (await r.json()) as { success?: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
const categorias = (tenant = T1) => db.rows("dulabs_catalogo_categorias").filter((c) => c.id_tenant === tenant);
const productos = () => db.rows("dulabs_inventario_productos");
const producto = (id: string) => productos().find((p) => p.id === id)!;
const patches = () => db.requests.filter((r) => r.method === "PATCH" && r.path.endsWith("/dulabs_inventario_productos"));
const deletes = () => db.requests.filter((r) => r.method === "DELETE");

function fila(id: string, tenant: string, categoriaId: string | null, categoria: string | null, extra: Record<string, unknown> = {}) {
  return { id, id_tenant: tenant, nombre: `Producto ${id.slice(-2)}`, categoria_id: categoriaId, categoria, activo: true, updated_by: CREADOR, escritura_id: TOKEN_VIEJO, updated_at: "2026-09-01T00:00:00.000Z", ...extra };
}

beforeEach(() => {
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  db.user("t-admin", U_ADMIN);
  db.user("t-lectura", U_LECTURA);
  db.user("t-agente", U_AGENTE);
  db.user("t-otro", U_OTRO);
  db.table("dulabs_miembros_equipo").push(
    { id: 1, tenant_id: T1, user_id: U_ADMIN, rol: "admin", estado: "activo" },
    { id: 2, tenant_id: T1, user_id: U_LECTURA, rol: "lectura", estado: "activo" },
    { id: 3, tenant_id: T1, user_id: U_AGENTE, rol: "agente", estado: "activo" },
    { id: 4, tenant_id: T2, user_id: U_OTRO, rol: "admin", estado: "activo" },
  );
  db.table("dulabs_tenant_modulos").push({ id_tenant: T1, modulo: "catalogo", habilitado: true }, { id_tenant: T2, modulo: "catalogo", habilitado: true });
  db.rpc("dulabs_rate_limit_incrementar", () => ({ data: [{ permitido: true, conteo: 1, reinicia_en: new Date(Date.now() + 60_000).toISOString() }] }));
  // Como la base real: una categoría con productos apuntándole no se puede borrar (clave foránea compuesta, sin «on delete»).
  db.table("dulabs_catalogo_categorias", { referencedBy: [{ table: "dulabs_inventario_productos", columns: ["id_tenant", "categoria_id"], parentColumns: ["id_tenant", "id"] }] }).push(
    { id: ARETES, id_tenant: T1, nombre: "Aretes" },
    { id: DIJES, id_tenant: T1, nombre: "Dijes" },
    { id: VACIA, id_tenant: T1, nombre: "Vacía" },
    { id: AJENA, id_tenant: T2, nombre: "Ajena" },
  );
  db.table("dulabs_inventario_productos").push(
    fila("a0000000-0000-4000-8000-000000000001", T1, ARETES, "Aretes"),
    fila("a0000000-0000-4000-8000-000000000002", T1, ARETES, "Aretes", { activo: false }),
    fila("a0000000-0000-4000-8000-000000000003", T1, DIJES, "Dijes"),
    fila("a0000000-0000-4000-8000-000000000004", T1, null, null),
    fila("a0000000-0000-4000-8000-000000000005", T2, AJENA, "Ajena"),
  );
});

afterEach(() => {
  db.uninstall();
});

describe("autorización", () => {
  it("sin sesión → 401 y no se toca nada", async () => {
    assert.equal((await borrar(VACIA, "", null)).status, 401);
    assert.equal((await listar("?conteo=1", null)).status, 401);
    assert.equal(deletes().length, 0);
    assert.equal(categorias().length, 3);
  });

  it("quien solo LEE o es asesora no puede eliminar (403), pero sí ve el listado con conteo", async () => {
    for (const token of ["t-lectura", "t-agente"]) {
      const r = await borrar(VACIA, "", token);
      assert.equal(r.status, 403, `${token} no debe poder eliminar`);
      assert.equal((await leer(r)).error?.code, "FORBIDDEN");
      assert.equal((await listar("?conteo=1", token)).status, 200, `${token} sí puede ver las categorías`);
    }
    assert.equal(categorias().length, 3, "la categoría sigue");
    assert.equal(deletes().length, 0);
  });

  it("el módulo apagado bloquea el borrado", async () => {
    db.rows("dulabs_tenant_modulos").find((m) => m.id_tenant === T1)!.habilitado = false;
    const r = await borrar(VACIA);
    assert.equal(r.status, 403);
    assert.equal((await leer(r)).error?.code, "MODULE_DISABLED");
    assert.equal(categorias().length, 3);
  });

  it("una categoría de OTRO negocio responde 404 y sigue ahí (el negocio sale de la sesión, nunca de la URL)", async () => {
    const r = await borrar(AJENA);
    assert.equal(r.status, 404);
    assert.equal(categorias(T2).length, 1);
    assert.equal(producto("a0000000-0000-4000-8000-000000000005").categoria_id, AJENA);
  });
});

describe("validación", () => {
  it("un id que no es UUID responde 404 sin consultar categorías", async () => {
    const antes = db.requests.length;
    const r = await borrar("no-es-un-uuid");
    assert.equal(r.status, 404);
    assert.ok(db.requests.slice(antes).every((q) => !q.path.includes("dulabs_catalogo_categorias") && !q.path.includes("dulabs_inventario_productos")), "ni siquiera tocó las tablas del catálogo");
  });

  it("un destino inválido responde 400 y no cambia nada", async () => {
    for (const malo of ["ninguna", "123", "todas"]) {
      const r = await borrar(ARETES, `?moveTo=${malo}`);
      assert.equal(r.status, 400, `«${malo}»`);
      assert.equal((await leer(r)).error?.code, "VALIDATION_ERROR");
    }
    assert.equal(patches().length, 0);
    assert.equal(categorias().length, 3);
  });

  it("una categoría que no existe → 404", async () => {
    assert.equal((await borrar(INEXISTENTE)).status, 404);
  });
});

describe("eliminar", () => {
  it("sin productos: se borra directo, con el negocio de la sesión en el filtro, y no se mueve nada", async () => {
    const r = await borrar(VACIA);
    assert.equal(r.status, 200);
    assert.deepEqual((await leer(r)).data, { deleted: true, moved: 0, movedTo: null });
    assert.deepEqual(categorias().map((c) => c.id).sort(), [ARETES, DIJES]);
    assert.equal(patches().length, 0, "no había productos que mover");
    const borrado = deletes().find((d) => d.path.endsWith("/dulabs_catalogo_categorias"))!;
    assert.equal(borrado.query.get("id_tenant"), `eq.${T1}`, "el borrado va acotado al negocio");
    assert.equal(borrado.query.get("id"), `eq.${VACIA}`);
  });

  it("con productos y sin decidir → 409 con el número, y NO viaja ningún cambio a la base", async () => {
    const r = await borrar(ARETES);
    assert.equal(r.status, 409);
    const cuerpo = await leer(r);
    assert.equal(cuerpo.error?.code, "CONFLICT");
    assert.match(cuerpo.error?.message ?? "", /2 productos/, "cuenta también el producto inactivo");
    assert.equal(patches().length, 0);
    assert.equal(deletes().length, 0);
    assert.equal(categorias().length, 3);
  });

  it("pasarlos a otra categoría: solo los de esa categoría, con el texto legado, el actor y un token de escritura nuevo", async () => {
    const r = await borrar(ARETES, `?moveTo=${DIJES}`);
    assert.equal(r.status, 200);
    assert.deepEqual((await leer(r)).data, { deleted: true, moved: 2, movedTo: { id: DIJES, name: "Dijes" } });
    assert.deepEqual(categorias().map((c) => c.id).sort(), [DIJES, VACIA]);

    for (const id of ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002"]) {
      const p = producto(id);
      assert.equal(p.categoria_id, DIJES);
      assert.equal(p.categoria, "Dijes", "el texto legado viaja con el id");
      assert.equal(p.updated_by, U_ADMIN, "atribuido a quien eliminó la categoría");
      assert.notEqual(p.escritura_id, TOKEN_VIEJO, "token nuevo: sin él la auditoría la registraría «sin actor»");
      assert.match(String(p.escritura_id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.notEqual(p.updated_at, "2026-09-01T00:00:00.000Z");
    }
    // Lo demás, intacto.
    assert.deepEqual(producto("a0000000-0000-4000-8000-000000000003"), fila("a0000000-0000-4000-8000-000000000003", T1, DIJES, "Dijes"));
    assert.deepEqual(producto("a0000000-0000-4000-8000-000000000004"), fila("a0000000-0000-4000-8000-000000000004", T1, null, null));
    assert.deepEqual(producto("a0000000-0000-4000-8000-000000000005"), fila("a0000000-0000-4000-8000-000000000005", T2, AJENA, "Ajena"), "los productos de otro negocio ni se tocan");

    const mover = patches();
    assert.equal(mover.length, 1, "un solo UPDATE por categoría, no uno por producto");
    assert.equal(mover[0].query.get("id_tenant"), `eq.${T1}`);
    assert.equal(mover[0].query.get("categoria_id"), `eq.${ARETES}`);
  });

  it("dejarlos sin categoría (moveTo=none): id y texto legado en null", async () => {
    const r = await borrar(ARETES, "?moveTo=none");
    assert.equal(r.status, 200);
    assert.deepEqual((await leer(r)).data, { deleted: true, moved: 2, movedTo: null });
    for (const id of ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002"]) {
      assert.equal(producto(id).categoria_id, null);
      assert.equal(producto(id).categoria, null);
      assert.equal(producto(id).updated_by, U_ADMIN);
    }
  });

  it("destino inexistente, de otro negocio o la misma categoría → 400 y NO se mueve ni se borra nada", async () => {
    for (const destino of [INEXISTENTE, AJENA, ARETES]) {
      const r = await borrar(ARETES, `?moveTo=${destino}`);
      assert.equal(r.status, 400, destino);
      assert.equal((await leer(r)).error?.code, "VALIDATION_ERROR");
    }
    assert.equal(patches().length, 0);
    assert.equal(deletes().length, 0);
    assert.equal(categorias().length, 3);
    assert.equal(producto("a0000000-0000-4000-8000-000000000001").categoria_id, ARETES);
  });
});

describe("la clave foránea es la barrera final", () => {
  it("el repositorio traduce «todavía hay productos» (23503 al borrar) a 409, y no a «la categoría no existe»", async () => {
    const repo = createSupabaseCatalogRepository(supabaseAdmin());
    await assert.rejects(repo.deleteCategory(T1, ARETES), (e: unknown) => e instanceof CatalogError && e.code === "CONFLICT" && /todavía tiene productos/.test(e.message));
    assert.equal(categorias().length, 3, "no se borró");
    // Y con la categoría ya vacía sí se puede; una que no existe devuelve false.
    assert.equal(await repo.deleteCategory(T1, VACIA), true);
    assert.equal(await repo.deleteCategory(T1, VACIA), false);
  });

  it("si un producto entra justo antes de borrar, la ruta responde 409 y la categoría sobrevive", async () => {
    // Un producto «llega» entre el movimiento y el borrado: se simula agregándolo cuando la ruta ya hizo el UPDATE.
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const respuesta = await original(input, init);
      const metodo = (input instanceof Request ? input.method : init?.method) ?? "GET";
      const url = input instanceof Request ? input.url : String(input);
      if (metodo === "PATCH" && url.includes("/dulabs_inventario_productos")) productos().push(fila("a0000000-0000-4000-8000-0000000000ee", T1, ARETES, "Aretes"));
      return respuesta;
    }) as typeof fetch;
    try {
      const r = await borrar(ARETES, `?moveTo=${DIJES}`);
      assert.equal(r.status, 409);
      assert.equal((await leer(r)).error?.code, "CONFLICT");
    } finally {
      globalThis.fetch = original;
    }
    assert.ok(categorias().some((c) => c.id === ARETES), "la categoría NO se borró");
    assert.equal(producto("a0000000-0000-4000-8000-000000000001").categoria_id, DIJES, "los que sí se alcanzaron a pasar ya están en su destino");
  });
});

describe("listado con conteo", () => {
  it("?conteo=1 trae cuántos productos usa cada categoría (activos e inactivos), 0 las vacías, solo del negocio de la sesión", async () => {
    const r = await listar("?conteo=1");
    assert.equal(r.status, 200);
    const categories = (await leer(r)).data?.categories as Array<{ id: string; name: string; productCount: number }>;
    assert.deepEqual(
      categories.map((c) => [c.name, c.productCount]),
      [["Aretes", 2], ["Dijes", 1], ["Vacía", 0]],
    );
    assert.ok(!categories.some((c) => c.id === AJENA), "ninguna categoría de otro negocio");
  });

  it("sin ?conteo el listado es el de siempre (sin consultar productos)", async () => {
    const antes = db.requests.length;
    const categories = (await leer(await listar())).data?.categories as Array<Record<string, unknown>>;
    assert.deepEqual(categories.map((c) => Object.keys(c).sort()), [["id", "name"], ["id", "name"], ["id", "name"]]);
    assert.ok(db.requests.slice(antes).every((q) => !q.path.includes("dulabs_inventario_productos")), "no cuesta consultas de más al formulario de producto");
  });
});
