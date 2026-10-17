/**
 * Administración de tienda — GET /api/dashboard/tienda/categorias/[id]/usos por las rutas reales: en qué partes de la tienda está elegida una categoría del catálogo (lo que se muestra antes de eliminarla).
 * Sesión, rol, módulo y aislamiento por negocio viven en un Supabase en memoria; el CMS corre sobre el SQL REAL en Postgres embebido (PGlite): los elementos se crean, se publican, se editan y se archivan
 * por las mismas rutas que usa el panel. Nada toca Supabase.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { CAT_ARETES, CAT_DIJES, home, multimedia, oferta } from "@/lib/cms-comercial/testing/fixtures";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { GET as usosGET } from "./categorias/[id]/usos/route";
import { POST as crearPOST } from "./entidades/route";
import { PUT as borradorPUT } from "./entidades/[id]/borrador/route";
import { POST as accionPOST } from "./entidades/[id]/[accion]/route";
import { POST as publicarPOST } from "./entidades/[id]/publicar/route";

const TA = "aaaaaaaa-0000-4000-8000-00000000000a"; // CMS habilitado
const TB = "bbbbbbbb-0000-4000-8000-00000000000b"; // CMS habilitado (otro negocio)
const TC = "cccccccc-0000-4000-8000-00000000000c"; // SIN el módulo
const CAT_DE_B = "c0000000-0000-4000-8000-0000000000b1";
const INEXISTENTE = "c0000000-0000-4000-8000-0000000000ff";
const IMAGEN = "e0000000-0000-4000-8000-000000000021";

let pg: BaseCms;
let db: SupabaseMemoria;
let puente: PuenteRpc;

before(async () => {
  pg = await crearBaseCms();
});
after(async () => {
  await pg.cerrar();
});

beforeEach(async () => {
  await pg.aplicarSql("truncate public.dulabs_cms_auditoria, public.dulabs_cms_versiones, public.dulabs_cms_assets, public.dulabs_cms_entidades cascade");
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  puente = instalarPuenteRpcCms(pg, process.env.SUPABASE_URL as string);
  db.table("dulabs_miembros_equipo").push(
    { id: 1, tenant_id: TA, user_id: "d0000000-0000-4000-8000-000000000001", rol: "admin", estado: "activo", email: "admin@a.test", nombre: "Ana Admin" },
    { id: 2, tenant_id: TA, user_id: "d0000000-0000-4000-8000-000000000002", rol: "agente", estado: "activo", email: "agente@a.test", nombre: "Bea Agente" },
    { id: 3, tenant_id: TA, user_id: "d0000000-0000-4000-8000-000000000003", rol: "lectura", estado: "activo", email: "lectura@a.test", nombre: null },
    { id: 4, tenant_id: TB, user_id: "d0000000-0000-4000-8000-000000000004", rol: "admin", estado: "activo", email: "admin@b.test", nombre: "Dani Admin" },
    { id: 5, tenant_id: TC, user_id: "d0000000-0000-4000-8000-000000000005", rol: "admin", estado: "activo", email: "admin@c.test", nombre: "Eva Admin" },
  );
  for (const [token, id] of [
    ["t-admin-a", "d0000000-0000-4000-8000-000000000001"],
    ["t-agente-a", "d0000000-0000-4000-8000-000000000002"],
    ["t-lectura-a", "d0000000-0000-4000-8000-000000000003"],
    ["t-admin-b", "d0000000-0000-4000-8000-000000000004"],
    ["t-admin-c", "d0000000-0000-4000-8000-000000000005"],
  ]) db.user(token, id);
  db.table("dulabs_tenant_modulos").push({ id_tenant: TA, modulo: "cms_comercial", habilitado: true }, { id_tenant: TB, modulo: "cms_comercial", habilitado: true }, { id_tenant: TC, modulo: "catalogo", habilitado: true });
  db.table("dulabs_catalogo_categorias").push({ id: CAT_ARETES, id_tenant: TA, nombre: "Aretes" }, { id: CAT_DIJES, id_tenant: TA, nombre: "Dijes" }, { id: CAT_DE_B, id_tenant: TB, nombre: "Anillos" });
  db.table("dulabs_agente_runtime_config").push({ id_tenant: TA, habilitado: true, created_at: "2026-09-01T00:00:00Z", negocio: { nombre_negocio: "Tienda A", pedido: { minimo_mayorista: 750000 } } });
});

afterEach(() => {
  puente.restaurar();
  db.uninstall();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Libre = any;
interface Respuesta {
  status: number;
  json: { success: boolean; data?: Record<string, Libre>; error?: { code: string; message: string } };
}
const con = (token: string | undefined, cuerpo?: unknown) => ({
  method: cuerpo === undefined ? "GET" : "POST",
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
  ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
});
const req = (ruta: string, init: ReturnType<typeof con>) => new NextRequest(`http://localhost/api/dashboard/tienda${ruta}`, init as ConstructorParameters<typeof NextRequest>[1]);
const leer = async (r: Response): Promise<Respuesta> => ({ status: r.status, json: await r.json() });

const usos = (token: string | undefined, id: string) => usosGET(req(`/categorias/${id}/usos`, con(token)), { params: Promise.resolve({ id }) }).then(leer);
const crear = (token: string, tipo: string, borrador: unknown) => crearPOST(req("/entidades", con(token, { tipo, borrador }))).then(leer);
const publicar = (token: string, id: string, rev: number) => publicarPOST(req(`/entidades/${id}/publicar`, con(token, { rev })), { params: Promise.resolve({ id }) }).then(leer);
const archivar = (token: string, id: string) => accionPOST(req(`/entidades/${id}/archivar`, con(token, {})), { params: Promise.resolve({ id, accion: "archivar" }) }).then(leer);
const guardar = (token: string, id: string, borrador: unknown, rev: number) =>
  borradorPUT(req(`/entidades/${id}/borrador`, { ...con(token, { borrador, rev }), method: "PUT" }), { params: Promise.resolve({ id }) }).then(leer);
const entidadDe = (r: Respuesta) => r.json.data?.entidad as { id: string; rev: number };

describe("acceso", () => {
  it("sin sesión → 401; sin el módulo de la tienda → 403; quien solo consulta (agente, lectura) sí puede verlo", async () => {
    assert.equal((await usos(undefined, CAT_ARETES)).status, 401);
    const sinModulo = await usos("t-admin-c", CAT_ARETES);
    assert.equal(sinModulo.status, 403);
    assert.equal(sinModulo.json.error?.code, "MODULE_DISABLED");
    for (const token of ["t-agente-a", "t-lectura-a", "t-admin-a"]) assert.equal((await usos(token, CAT_ARETES)).status, 200, token);
  });

  it("una categoría de OTRO negocio, una que no existe o un id que no es UUID: «no existe» (nunca se cuenta nada ajeno)", async () => {
    // El otro negocio SÍ tiene un elemento que menciona esa categoría: no debe delatarse.
    await crear("t-admin-b", "home", home({ categorias_destacadas: [CAT_DE_B] }));
    for (const id of [CAT_DE_B, INEXISTENTE, "no-es-un-uuid"]) {
      const r = await usos("t-admin-a", id);
      assert.equal(r.status, 404, id);
      assert.equal(r.json.error?.code, "NOT_FOUND");
    }
  });
});

describe("qué responde", () => {
  it("una categoría que nadie eligió: lista vacía", async () => {
    const r = await usos("t-admin-a", CAT_ARETES);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data, { usos: [] });
  });

  it("el ciclo de la tienda: borrador → publicado → cambios sin publicar que la quitan → archivado", async () => {
    const creada = await crear("t-admin-a", "home", home({ categorias_destacadas: [CAT_ARETES] }));
    assert.equal(creada.status, 201, JSON.stringify(creada.json));
    const { id, rev } = entidadDe(creada);

    // Solo en borrador: todavía no se ve en la tienda.
    assert.deepEqual((await usos("t-admin-a", CAT_ARETES)).json.data?.usos, [{ tipo: "home", clave: "home", nombre: "Página principal", estado: "borrador", lugares: ["destacadas"], enPublicado: false, enBorrador: true, visibleHoy: false }]);

    // Publicada: la tienda la muestra hoy.
    const pub = await publicar("t-admin-a", id, rev);
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    const [hoy] = (await usos("t-admin-a", CAT_ARETES)).json.data?.usos;
    assert.deepEqual([hoy.estado, hoy.enPublicado, hoy.visibleHoy], ["publicada", true, true]);

    // Un borrador nuevo que la quita: lo publicado todavía la trae (y la tienda la muestra), el borrador ya no.
    const rev2 = (await pg.sql<{ rev: number }>("select rev from public.dulabs_cms_entidades where id = $1", [id]))[0].rev;
    const g = await guardar("t-admin-a", id, home({ categorias_destacadas: [CAT_DIJES] }), rev2);
    assert.equal(g.status, 200, JSON.stringify(g.json));
    const [cambiado] = (await usos("t-admin-a", CAT_ARETES)).json.data?.usos;
    assert.deepEqual([cambiado.enPublicado, cambiado.enBorrador, cambiado.visibleHoy], [true, false, true]);
    const [deDijes] = (await usos("t-admin-a", CAT_DIJES)).json.data?.usos;
    assert.deepEqual([deDijes.enPublicado, deDijes.enBorrador, deDijes.visibleHoy], [false, true, false], "y la otra categoría solo está en el borrador");
  });

  it("ofertas y fotos y videos también cuentan, cada uno con el lugar donde está", async () => {
    const o = await crear("t-admin-a", "oferta", oferta({ nombre: "Amor y Amistad", alcance: { todos: false, referencias: [], categorias: [CAT_ARETES] } }));
    assert.equal(o.status, 201, JSON.stringify(o.json));
    const m = await crear("t-admin-a", "multimedia", multimedia({ categorias: [{ categoria_id: CAT_ARETES, imagen: { origen: "cms", asset: IMAGEN, alt: "Aretes" } }] } as never));
    assert.equal(m.status, 201, JSON.stringify(m.json));
    const lista = (await usos("t-admin-a", CAT_ARETES)).json.data?.usos as Array<{ tipo: string; nombre: string; lugares: string[] }>;
    assert.deepEqual(
      lista.map((u) => [u.tipo, u.nombre, u.lugares]),
      [["oferta", "Amor y Amistad", ["oferta"]], ["multimedia", "Fotos y videos", ["imagen_categoria"]]],
    );
    assert.deepEqual((await usos("t-admin-a", CAT_DIJES)).json.data?.usos, [], "la otra categoría no aparece");
  });

  it("un elemento archivado ya no cuenta", async () => {
    const o = await crear("t-admin-a", "oferta", oferta({ nombre: "Vieja", alcance: { todos: false, referencias: [], categorias: [CAT_ARETES] } }));
    assert.equal((await usos("t-admin-a", CAT_ARETES)).json.data?.usos.length, 1);
    assert.equal((await archivar("t-admin-a", entidadDe(o).id)).status, 200);
    assert.deepEqual((await usos("t-admin-a", CAT_ARETES)).json.data?.usos, []);
  });

  it("los elementos de OTRO negocio no se cuentan, aunque mencionen el mismo id de categoría", async () => {
    await crear("t-admin-b", "home", home({ categorias_destacadas: [CAT_ARETES] }));
    assert.deepEqual((await usos("t-admin-a", CAT_ARETES)).json.data?.usos, []);
    await crear("t-admin-a", "home", home({ categorias_destacadas: [CAT_ARETES] }));
    assert.equal((await usos("t-admin-a", CAT_ARETES)).json.data?.usos.length, 1);
  });

  it("solo cuenta cómo se llama cada elemento y dónde está la categoría: ni contenido, ni ids internos, ni el negocio", async () => {
    const o = await crear("t-admin-a", "oferta", oferta({ nombre: "Amor y Amistad", alcance: { todos: false, referencias: ["DL-000001"], categorias: [CAT_ARETES] } }));
    const r = await usos("t-admin-a", CAT_ARETES);
    const texto = JSON.stringify(r.json);
    assert.ok(!texto.includes(entidadDe(o).id) && !texto.includes(TA) && !texto.includes("DL-000001") && !/token/i.test(texto));
    assert.deepEqual(Object.keys((r.json.data?.usos as Libre[])[0]).sort(), ["clave", "enBorrador", "enPublicado", "estado", "lugares", "nombre", "tipo", "visibleHoy"]);
  });
});
