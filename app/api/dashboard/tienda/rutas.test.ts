/**
 * Administración de tienda (CMS comercial) — las RUTAS reales de /api/dashboard/tienda/*, de punta a punta: sesión, rol, módulo, validación de entrada,
 * aislamiento por negocio, el ciclo completo y que ningún error interno se filtre al cliente. La sesión, el equipo y los módulos viven en un Supabase en memoria
 * (lib/testing/supabase-rest-memoria.ts); el CMS corre sobre el SQL REAL en Postgres embebido (PGlite). Nada toca Supabase.
 *
 * El frontend no es la autoridad: cada llamada vuelve a validar sesión, rol, módulo y negocio. El negocio sale de la sesión, nunca de la URL ni del cuerpo.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { GET as auditoriaGET } from "./auditoria/route";
import { GET as listarGET, POST as crearPOST } from "./entidades/route";
import { GET as detalleGET } from "./entidades/[id]/route";
import { PUT as borradorPUT } from "./entidades/[id]/borrador/route";
import { POST as accionPOST } from "./entidades/[id]/[accion]/route";
import { POST as publicarPOST } from "./entidades/[id]/publicar/route";
import { POST as restaurarPOST } from "./entidades/[id]/restaurar/route";
import { POST as validarPOST } from "./entidades/[id]/validar/route";
import { GET as versionesGET } from "./entidades/[id]/versiones/route";

const TA = "aaaaaaaa-0000-4000-8000-00000000000a"; // CMS habilitado
const TB = "bbbbbbbb-0000-4000-8000-00000000000b"; // CMS habilitado (otro negocio)
const TC = "cccccccc-0000-4000-8000-00000000000c"; // SIN el módulo
const CAT = "c0000000-0000-4000-8000-0000000000a1";

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
    { id: 6, tenant_id: TA, user_id: "d0000000-0000-4000-8000-000000000006", rol: "admin", estado: "suspendido", email: "susp@a.test", nombre: "Fer" },
  );
  for (const [token, id] of [
    ["t-admin-a", "d0000000-0000-4000-8000-000000000001"],
    ["t-agente-a", "d0000000-0000-4000-8000-000000000002"],
    ["t-lectura-a", "d0000000-0000-4000-8000-000000000003"],
    ["t-admin-b", "d0000000-0000-4000-8000-000000000004"],
    ["t-admin-c", "d0000000-0000-4000-8000-000000000005"],
    ["t-suspendido-a", "d0000000-0000-4000-8000-000000000006"],
    ["t-sin-equipo", "d0000000-0000-4000-8000-000000000007"],
  ]) db.user(token, id);
  db.table("dulabs_tenant_modulos").push({ id_tenant: TA, modulo: "cms_comercial", habilitado: true }, { id_tenant: TB, modulo: "cms_comercial", habilitado: true }, { id_tenant: TC, modulo: "catalogo", habilitado: true });
  const producto = (referencia: string, tenant: string, over: Record<string, unknown> = {}) => ({
    id: `p-${tenant.slice(0, 2)}-${referencia}`,
    id_tenant: tenant,
    referencia,
    nombre: `Producto ${referencia}`,
    descripcion: null,
    precio: 100000,
    precio_mayor: 70000,
    material: null,
    color: null,
    categoria: null,
    categoria_id: CAT,
    activo: true,
    controla_stock: true,
    stock: 10,
    foto_url: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  });
  db.table("dulabs_inventario_productos").push(producto("DL-000001", TA), producto("DL-000002", TA, { precio: 50000, precio_mayor: 35000 }), producto("DL-000001", TB));
  db.table("dulabs_catalogo_categorias").push({ id: CAT, id_tenant: TA, nombre: "Aretes" });
  db.table("dulabs_agente_runtime_config").push({ id_tenant: TA, habilitado: true, created_at: "2026-09-01T00:00:00Z", negocio: { nombre_negocio: "Tienda A", pedido: { minimo_mayorista: 750000 } } });
});

afterEach(() => {
  puente.restaurar();
  db.uninstall();
});

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** El cuerpo de una respuesta se navega libremente en las pruebas (es JSON de la API, no un tipo del dominio). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Libre = any;
interface Respuesta {
  status: number;
  json: { success: boolean; data?: Record<string, Libre>; error?: { code: string; message: string; diagnostics?: Libre } };
}

async function pedir(token: string | undefined, metodo: "GET" | "POST" | "PUT", ruta: string, cuerpo?: unknown, extra: { headers?: Record<string, string>; crudo?: string } = {}): Promise<Respuesta> {
  const headers: Record<string, string> = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo !== undefined || extra.crudo !== undefined ? { "content-type": "application/json" } : {}), ...(extra.headers ?? {}) };
  const request = new NextRequest(`http://localhost/api/dashboard/tienda${ruta}`, { method: metodo, headers, body: extra.crudo ?? (cuerpo === undefined ? undefined : JSON.stringify(cuerpo)) });
  const conId = (id: string) => ({ params: Promise.resolve({ id }) });
  const [camino] = ruta.split("?");
  const partes = camino.split("/").filter(Boolean); // ["entidades", id?, accion?]
  let res: Response;
  if (partes[0] === "auditoria") res = await auditoriaGET(request);
  else if (partes.length === 1) res = metodo === "GET" ? await listarGET(request) : await crearPOST(request);
  else if (partes.length === 2) res = await detalleGET(request, conId(partes[1]));
  else if (partes[2] === "borrador") res = await borradorPUT(request, conId(partes[1]));
  else if (partes[2] === "validar") res = await validarPOST(request, conId(partes[1]));
  else if (partes[2] === "publicar") res = await publicarPOST(request, conId(partes[1]));
  else if (partes[2] === "restaurar") res = await restaurarPOST(request, conId(partes[1]));
  else if (partes[2] === "versiones") res = await versionesGET(request, conId(partes[1]));
  else res = await accionPOST(request, { params: Promise.resolve({ id: partes[1], accion: partes[2] }) });
  return { status: res.status, json: (await res.json()) as Respuesta["json"] };
}

const VIGENCIA = { desde: "2026-10-25", hasta: "2099-12-31" };
const oferta = (over: Record<string, unknown> = {}) => ({ nombre: "Amor y Amistad", modalidad: "ambas", beneficio: { tipo: "porcentaje", valor: 20 }, alcance: { todos: false, referencias: ["DL-000001"], categorias: [] }, vigencia: VIGENCIA, prioridad: 5, ...over });

async function crearOferta(token = "t-admin-a", over: Record<string, unknown> = {}) {
  const r = await pedir(token, "POST", "/entidades", { tipo: "oferta", borrador: oferta(over) });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data?.entidad as { id: string; rev: number; clave: string; estado: string };
}

async function crearYPublicar(token = "t-admin-a", over: Record<string, unknown> = {}) {
  const e = await crearOferta(token, over);
  const p = await pedir(token, "POST", `/entidades/${e.id}/publicar`, { rev: e.rev });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  return e;
}

// ---------------------------------------------------------------------------
// Sesión, rol y módulo — todas las rutas
// ---------------------------------------------------------------------------

describe("autenticación, roles y módulo en TODAS las rutas", () => {
  /** [descripción, método, ruta, cuerpo]. Las de lectura las puede usar cualquier rol del equipo; las de escritura solo el administrador. */
  async function rutas() {
    const e = await crearYPublicar();
    const id = e.id;
    const lecturas: Array<[string, "GET" | "POST", string, unknown?]> = [
      ["listar", "GET", "/entidades"],
      ["detalle", "GET", `/entidades/${id}`],
      ["validar", "POST", `/entidades/${id}/validar`],
      ["versiones", "GET", `/entidades/${id}/versiones`],
      ["auditoría", "GET", "/auditoria"],
    ];
    const escrituras: Array<[string, "POST" | "PUT", string, unknown?]> = [
      ["crear", "POST", "/entidades", { tipo: "oferta", borrador: oferta({ nombre: "Otra" }) }],
      ["guardar borrador", "PUT", `/entidades/${id}/borrador`, { borrador: oferta(), rev: 2 }],
      ["publicar", "POST", `/entidades/${id}/publicar`, { rev: 2 }],
      ["restaurar", "POST", `/entidades/${id}/restaurar`, { version: 1 }],
      ["pausar", "POST", `/entidades/${id}/pausar`],
      ["reanudar", "POST", `/entidades/${id}/reanudar`],
      ["despublicar", "POST", `/entidades/${id}/despublicar`],
      ["archivar", "POST", `/entidades/${id}/archivar`],
      ["desarchivar", "POST", `/entidades/${id}/desarchivar`],
    ];
    return { id, lecturas, escrituras };
  }

  it("sin sesión, con una sesión falsa o sin equipo: 401/403 y NADA llega a la base", async () => {
    const { lecturas, escrituras } = await rutas();
    puente.llamadas.length = 0;
    for (const [nombre, metodo, ruta, cuerpo] of [...lecturas, ...escrituras]) {
      const sin = await pedir(undefined, metodo, ruta, cuerpo);
      assert.equal(sin.status, 401, `${nombre} sin token`);
      assert.equal(sin.json.success, false);
      assert.equal((await pedir("token-falso", metodo, ruta, cuerpo)).status, 401, `${nombre} token falso`);
      assert.equal((await pedir("t-sin-equipo", metodo, ruta, cuerpo)).status, 403, `${nombre} sin equipo`);
      assert.equal((await pedir("t-suspendido-a", metodo, ruta, cuerpo)).status, 403, `${nombre} suspendido`);
    }
    assert.deepEqual(puente.llamadas, [], "ninguna petición rechazada tocó el CMS");
  });

  it("agente y lectura: pueden CONSULTAR todo, pero NO modificar nada (403 FORBIDDEN, sin tocar la base)", async () => {
    const { lecturas, escrituras } = await rutas();
    for (const token of ["t-agente-a", "t-lectura-a"]) {
      for (const [nombre, metodo, ruta, cuerpo] of lecturas) {
        const r = await pedir(token, metodo, ruta, cuerpo);
        assert.equal(r.status, 200, `${token} ${nombre}: ${JSON.stringify(r.json)}`);
      }
      puente.llamadas.length = 0;
      for (const [nombre, metodo, ruta, cuerpo] of escrituras) {
        const r = await pedir(token, metodo, ruta, cuerpo);
        assert.equal(r.status, 403, `${token} ${nombre}`);
        assert.equal(r.json.error?.code, "FORBIDDEN");
        assert.equal(r.json.error?.message, "Solo un administrador puede modificar la tienda.");
      }
      assert.deepEqual(puente.llamadas, [], `${token}: ninguna escritura rechazada llegó a la base`);
    }
  });

  it("el administrador puede consultar y modificar (ninguna ruta lo rechaza por permisos)", async () => {
    const { lecturas, escrituras } = await rutas();
    for (const [nombre, metodo, ruta, cuerpo] of lecturas) assert.equal((await pedir("t-admin-a", metodo, ruta, cuerpo)).status, 200, nombre);
    for (const [nombre, metodo, ruta, cuerpo] of escrituras) {
      const r = await pedir("t-admin-a", metodo, ruta, cuerpo);
      assert.ok(![401, 403].includes(r.status), `${nombre} → ${r.status} ${JSON.stringify(r.json.error)}`);
    }
  });

  it("un negocio SIN el módulo no tiene la API: 403 MODULE_DISABLED, incluso para su administrador", async () => {
    const { id } = await rutas();
    puente.llamadas.length = 0;
    const casos: Array<["GET" | "POST" | "PUT", string, unknown?]> = [
      ["GET", "/entidades"],
      ["POST", "/entidades", { tipo: "oferta", borrador: oferta() }],
      ["GET", `/entidades/${id}`],
      ["PUT", `/entidades/${id}/borrador`, { borrador: oferta(), rev: 1 }],
      ["POST", `/entidades/${id}/publicar`, { rev: 1 }],
      ["GET", "/auditoria"],
    ];
    for (const [metodo, ruta, cuerpo] of casos) {
      const r = await pedir("t-admin-c", metodo, ruta, cuerpo);
      assert.equal(r.status, 403, `${metodo} ${ruta}`);
      assert.equal(r.json.error?.code, "MODULE_DISABLED");
    }
    assert.deepEqual(puente.llamadas, []);
    // y apagar el módulo a un negocio que lo tenía lo apaga de inmediato
    db.table("dulabs_tenant_modulos").splice(0, db.table("dulabs_tenant_modulos").length);
    assert.equal((await pedir("t-admin-a", "GET", "/entidades")).json.error?.code, "MODULE_DISABLED");
  });

  it("un error al consultar el módulo es un 500, nunca un «permitido»", async () => {
    db.missing("dulabs_tenant_modulos");
    const r = await pedir("t-admin-a", "GET", "/entidades");
    assert.equal(r.status, 500);
    assert.equal(r.json.error?.code, "INTERNAL_ERROR");
  });
});

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

describe("validación de la entrada (antes de tocar nada)", () => {
  it("un id que no es UUID es 404 sin consultar la base; una acción desconocida también", async () => {
    puente.llamadas.length = 0;
    for (const [metodo, ruta, cuerpo] of [
      ["GET", "/entidades/no-es-uuid"],
      ["PUT", "/entidades/123/borrador", { borrador: {}, rev: 1 }],
      ["POST", "/entidades/%27%3B%20drop%20table/publicar", { rev: 1 }],
      ["POST", "/entidades/xyz/pausar"],
      ["GET", "/entidades/xyz/versiones"],
    ] as Array<["GET" | "POST" | "PUT", string, unknown?]>) {
      const r = await pedir("t-admin-a", metodo, ruta, cuerpo);
      assert.equal(r.status, 404, `${metodo} ${ruta}`);
    }
    const e = await crearOferta();
    puente.llamadas.length = 0;
    const accion = await pedir("t-admin-a", "POST", `/entidades/${e.id}/borrar`);
    assert.equal(accion.status, 404);
    assert.equal(accion.json.error?.message, "Esa acción no existe.");
    assert.deepEqual(puente.llamadas, []);
  });

  it("JSON inválido, cuerpo vacío y cuerpo gigante", async () => {
    const e = await crearOferta();
    assert.equal((await pedir("t-admin-a", "POST", "/entidades", undefined, { crudo: "{no es json" })).status, 400);
    assert.equal((await pedir("t-admin-a", "POST", "/entidades", undefined, { crudo: "" })).status, 400);
    assert.equal((await pedir("t-admin-a", "PUT", `/entidades/${e.id}/borrador`, undefined, { crudo: "null" })).status, 400);
    puente.llamadas.length = 0;
    const gigante = await pedir("t-admin-a", "POST", "/entidades", { tipo: "oferta", borrador: { nombre: "x", descripcion: "y".repeat(310_000) } });
    assert.equal(gigante.status, 413);
    const declarado = await pedir("t-admin-a", "POST", "/entidades", { tipo: "oferta", borrador: { nombre: "x" } }, { headers: { "content-length": "999999" } });
    assert.equal(declarado.status, 413);
    assert.deepEqual(puente.llamadas, [], "un cuerpo rechazado no llega a la base");
  });

  it("claves desconocidas, tipos equivocados y valores fuera de lista: 400 con mensaje en español", async () => {
    const e = await crearOferta();
    const casos: Array<["POST" | "PUT", string, unknown, RegExp]> = [
      ["POST", "/entidades", { tipo: "galleta", borrador: {} }, /tipo de elemento no es válido/],
      ["POST", "/entidades", { tipo: "oferta" }, /contenido debe ser un objeto/],
      ["POST", "/entidades", { tipo: "oferta", borrador: [] }, /objeto/],
      ["POST", "/entidades", { tipo: "oferta", borrador: oferta(), id_tenant: TB }, /no permitido/i],
      ["PUT", `/entidades/${e.id}/borrador`, { borrador: oferta() }, /revisión/],
      ["PUT", `/entidades/${e.id}/borrador`, { borrador: oferta(), rev: "uno" }, /revisión/],
      ["PUT", `/entidades/${e.id}/borrador`, { borrador: oferta(), rev: 0 }, /revisión no es válida/],
      ["PUT", `/entidades/${e.id}/borrador`, { borrador: oferta(), rev: 1, tenantId: TB }, /no permitido/i],
      ["POST", `/entidades/${e.id}/publicar`, { rev: 1, nota: "x".repeat(501) }, /500 caracteres/],
      ["POST", `/entidades/${e.id}/restaurar`, { version: 0 }, /versión no es válida/],
      ["POST", `/entidades/${e.id}/restaurar`, {}, /versión a restaurar/],
    ];
    for (const [metodo, ruta, cuerpo, mensaje] of casos) {
      const r = await pedir("t-admin-a", metodo, ruta, cuerpo);
      assert.equal(r.status, 400, `${metodo} ${ruta} ${JSON.stringify(cuerpo).slice(0, 60)}`);
      assert.equal(r.json.error?.code, "VALIDATION_ERROR");
      assert.match(r.json.error?.message ?? "", mensaje);
    }
  });

  it("los filtros de la lista y de la auditoría se validan", async () => {
    for (const q of ["?tipo=galleta", "?estado=vencida", "?archivadas=quizas"]) assert.equal((await pedir("t-admin-a", "GET", `/entidades${q}`)).status, 400, q);
    for (const q of ["?entidad=no-uuid", "?limite=0", "?limite=500", "?antes=abc"]) assert.equal((await pedir("t-admin-a", "GET", `/auditoria${q}`)).status, 400, q);
  });
});

// ---------------------------------------------------------------------------
// Aislamiento
// ---------------------------------------------------------------------------

describe("aislamiento: el negocio sale SIEMPRE de la sesión", () => {
  it("cada negocio ve solo lo suyo; un id ajeno «no existe» en todas las rutas", async () => {
    const a = await crearYPublicar("t-admin-a", { nombre: "Oferta de A" });
    const b = await crearYPublicar("t-admin-b", { nombre: "Oferta de B", alcance: { todos: false, referencias: ["DL-000001"], categorias: [] } });
    assert.deepEqual((await pedir("t-admin-a", "GET", "/entidades")).json.data?.items.map((x: { nombre: string }) => x.nombre), ["Oferta de A"]);
    assert.deepEqual((await pedir("t-admin-b", "GET", "/entidades")).json.data?.items.map((x: { nombre: string }) => x.nombre), ["Oferta de B"]);
    const ajenas: Array<["GET" | "POST" | "PUT", string, unknown?]> = [
      ["GET", `/entidades/${a.id}`],
      ["PUT", `/entidades/${a.id}/borrador`, { borrador: oferta({ nombre: "Robada" }), rev: 2 }],
      ["POST", `/entidades/${a.id}/validar`],
      ["POST", `/entidades/${a.id}/publicar`, { rev: 2 }],
      ["POST", `/entidades/${a.id}/restaurar`, { version: 1 }],
      ["GET", `/entidades/${a.id}/versiones`],
      ["POST", `/entidades/${a.id}/pausar`],
      ["POST", `/entidades/${a.id}/despublicar`],
      ["POST", `/entidades/${a.id}/archivar`],
      ["GET", `/auditoria?entidad=${a.id}`],
    ];
    for (const [metodo, ruta, cuerpo] of ajenas) {
      const r = await pedir("t-admin-b", metodo, ruta, cuerpo);
      assert.equal(r.status, 404, `${metodo} ${ruta}`);
    }
    const aDespues = await pedir("t-admin-a", "GET", `/entidades/${a.id}`);
    assert.equal(aDespues.json.data?.entidad.estado, "publicada");
    assert.equal(aDespues.json.data?.entidad.nombre, "Oferta de A", "nada de lo ajeno cambió nada");
    assert.ok(b.id !== a.id);
  });

  it("el negocio de la URL o de la consulta se ignora: manda el de la sesión", async () => {
    await crearOferta("t-admin-a", { nombre: "De A" });
    await crearOferta("t-admin-b", { nombre: "De B" });
    const r = await pedir("t-admin-a", "GET", `/entidades?tenant=${TB}&id_tenant=${TB}&tenantId=${TB}`);
    assert.deepEqual(r.json.data?.items.map((x: { nombre: string }) => x.nombre), ["De A"]);
    const aud = await pedir("t-admin-a", "GET", `/auditoria?tenant=${TB}`);
    assert.ok(aud.json.data?.registros.every((x: { entidadTipo: string }) => x.entidadTipo === "oferta"));
    assert.equal(aud.json.data?.registros.length, 1);
    const rows = await pg.sql<{ id_tenant: string }>("select id_tenant from public.dulabs_cms_entidades order by created_at");
    assert.deepEqual(rows.map((x) => x.id_tenant), [TA, TB]);
  });
});

// ---------------------------------------------------------------------------
// Flujo completo por HTTP
// ---------------------------------------------------------------------------

describe("el ciclo completo por HTTP", () => {
  it("crear → guardar → validar → publicar → pausar → reanudar → despublicar → archivar → restaurar, con su auditoría", async () => {
    const e = await crearOferta();
    assert.equal(e.estado, "borrador");
    assert.equal(e.clave, "amor-y-amistad");

    const g = await pedir("t-admin-a", "PUT", `/entidades/${e.id}/borrador`, { borrador: oferta({ beneficio: { tipo: "porcentaje", valor: 25 } }), rev: e.rev });
    assert.equal(g.status, 200);
    assert.equal(g.json.data?.entidad.rev, e.rev + 1);

    const v = await pedir("t-admin-a", "POST", `/entidades/${e.id}/validar`);
    assert.equal(v.json.data?.validacion.ok, true);
    assert.deepEqual(v.json.data?.validacion.errores, []);

    const p = await pedir("t-admin-a", "POST", `/entidades/${e.id}/publicar`, { rev: g.json.data?.entidad.rev, nota: "Lanzamiento" });
    assert.equal(p.status, 200);
    assert.equal(p.json.data?.version, 1);
    assert.equal(p.json.data?.entidad.estado, "publicada");
    assert.deepEqual(p.json.data?.advertencias, []);

    assert.equal((await pedir("t-admin-a", "POST", `/entidades/${e.id}/pausar`)).json.data?.entidad.estado, "pausada");
    assert.equal((await pedir("t-admin-a", "POST", `/entidades/${e.id}/reanudar`)).json.data?.entidad.estado, "publicada");
    assert.equal((await pedir("t-admin-a", "POST", `/entidades/${e.id}/despublicar`)).json.data?.entidad.estado, "borrador");
    assert.equal((await pedir("t-admin-a", "POST", `/entidades/${e.id}/archivar`)).json.data?.entidad.archivada, true);
    assert.equal((await pedir("t-admin-a", "GET", "/entidades")).json.data?.items.length, 0);
    assert.equal((await pedir("t-admin-a", "GET", "/entidades?archivadas=true")).json.data?.items.length, 1);
    assert.equal((await pedir("t-admin-a", "POST", `/entidades/${e.id}/desarchivar`)).json.data?.entidad.archivada, false);

    const nueva = await pedir("t-admin-a", "POST", `/entidades/${e.id}/publicar`, { rev: (await pedir("t-admin-a", "GET", `/entidades/${e.id}`)).json.data?.entidad.rev });
    assert.equal(nueva.json.data?.version, 2);
    const r = await pedir("t-admin-a", "POST", `/entidades/${e.id}/restaurar`, { version: 1, nota: "Volver" });
    assert.equal(r.status, 200);
    assert.equal(r.json.data?.version, 3);

    const versiones = await pedir("t-admin-a", "GET", `/entidades/${e.id}/versiones`);
    assert.deepEqual(versiones.json.data?.versiones.map((x: { version: number; accion: string }) => [x.version, x.accion]), [[3, "restaurar"], [2, "publicar"], [1, "publicar"]]);

    const auditoria = await pedir("t-admin-a", "GET", `/auditoria?entidad=${e.id}&limite=200`);
    const acciones = auditoria.json.data?.registros.map((x: { accion: string }) => x.accion).reverse();
    assert.deepEqual(acciones, ["crear", "editar_borrador", "publicar", "pausar", "reanudar", "despublicar", "archivar", "desarchivar", "publicar", "restaurar"]);
    assert.ok(auditoria.json.data?.registros.every((x: { actorEtiqueta: string }) => x.actorEtiqueta === "Ana Admin"), "el historial dice QUIÉN fue (nombre del equipo)");
  });

  it("la auditoría se pagina con `antes`", async () => {
    const e = await crearYPublicar();
    await pedir("t-admin-a", "POST", `/entidades/${e.id}/pausar`);
    await pedir("t-admin-a", "POST", `/entidades/${e.id}/reanudar`);
    const pagina1 = await pedir("t-admin-a", "GET", "/auditoria?limite=2");
    assert.equal(pagina1.json.data?.registros.length, 2);
    const ultimo = pagina1.json.data?.registros[1].id;
    const pagina2 = await pedir("t-admin-a", "GET", `/auditoria?limite=2&antes=${ultimo}`);
    assert.ok(pagina2.json.data?.registros.every((x: { id: number }) => x.id < ultimo));
    assert.equal(pagina2.json.data?.registros.length, 2);
  });

  it("una revisión vieja da 409 CONFLICT y no pisa nada", async () => {
    const e = await crearOferta();
    const ok = await pedir("t-admin-a", "PUT", `/entidades/${e.id}/borrador`, { borrador: oferta({ prioridad: 9 }), rev: e.rev });
    assert.equal(ok.status, 200);
    const viejo = await pedir("t-admin-a", "PUT", `/entidades/${e.id}/borrador`, { borrador: oferta({ prioridad: 1 }), rev: e.rev });
    assert.equal(viejo.status, 409);
    assert.equal(viejo.json.error?.code, "CONFLICT");
    assert.equal((await pedir("t-admin-a", "POST", `/entidades/${e.id}/publicar`, { rev: e.rev })).status, 409);
    assert.equal((await pedir("t-admin-a", "GET", `/entidades/${e.id}`)).json.data?.entidad.borrador.prioridad, 9);
  });

  it("publicar con errores es 422 NOT_PUBLISHABLE, con los problemas para corregir, y no publica nada", async () => {
    const e = await crearOferta("t-admin-a", { alcance: { todos: false, referencias: [], categorias: [] } });
    const p = await pedir("t-admin-a", "POST", `/entidades/${e.id}/publicar`, { rev: e.rev });
    assert.equal(p.status, 422);
    assert.equal(p.json.error?.code, "NOT_PUBLISHABLE");
    assert.ok(p.json.error?.diagnostics.problemas.some((x: { mensaje: string }) => x.mensaje === "Esta oferta no puede publicarse porque no tiene productos asociados."));
    assert.equal((await pedir("t-admin-a", "GET", `/entidades/${e.id}/versiones`)).json.data?.versiones.length, 0);
  });

  it("transiciones inválidas: 409 con un mensaje claro", async () => {
    const e = await crearOferta();
    const r = await pedir("t-admin-a", "POST", `/entidades/${e.id}/pausar`);
    assert.equal(r.status, 409);
    assert.equal(r.json.error?.code, "INVALID_STATE");
    assert.match(r.json.error?.message ?? "", /publicado/);
  });

  it("la validación usa el catálogo y las variables del negocio de la sesión (producto de otro negocio no cuenta)", async () => {
    // DL-000002 solo existe en el negocio A
    const deB = await pedir("t-admin-b", "POST", "/entidades", { tipo: "oferta", borrador: oferta({ alcance: { todos: false, referencias: ["DL-000002"], categorias: [] } }) });
    const idB = deB.json.data?.entidad.id;
    const p = await pedir("t-admin-b", "POST", `/entidades/${idB}/publicar`, { rev: 1 });
    assert.equal(p.status, 422);
    assert.ok(p.json.error?.diagnostics.problemas.some((x: { codigo: string }) => x.codigo === "producto_inexistente"));
    const contenido = await pedir("t-admin-a", "POST", "/entidades", { tipo: "contenido", borrador: { tema: "mayoristas", audiencia: "todos", titulo: "Inversión inicial", texto: "Parte desde $750.000.", palabras_clave: [], orden: 1 } });
    const v = await pedir("t-admin-a", "POST", `/entidades/${contenido.json.data?.entidad.id}/validar`);
    assert.ok(v.json.data?.validacion.errores.some((x: { codigo: string }) => x.codigo === "monto_a_mano"), "el mínimo mayorista (750.000) sale de la configuración del negocio A");
  });
});

// ---------------------------------------------------------------------------
// Sin filtraciones
// ---------------------------------------------------------------------------

describe("errores internos: texto fijo y seguro", () => {
  it("un fallo de la base no se filtra al cliente (sin SQL, sin nombres de tablas, sin detalle)", async () => {
    puente.fallarProxima("dulabs_cms_listar");
    const r = await pedir("t-admin-a", "GET", "/entidades");
    assert.equal(r.status, 500);
    assert.equal(r.json.error?.code, "INTERNAL_ERROR");
    assert.equal(r.json.error?.message, "No se pudo completar la operación de la tienda.");
    const texto = JSON.stringify(r.json);
    for (const sensible of ["secreto interno", "dulabs_cms_entidades", "detalle sensible", "XX000", "stack"]) assert.equal(texto.includes(sensible), false, sensible);
  });

  it("si la migración no está aplicada, 503 claro (y el resto de la aplicación no se entera)", async () => {
    const original = puente.restaurar;
    puente.restaurar();
    puente = instalarPuenteRpcCms(await crearBaseCms({ aplicarMigracion: false }), process.env.SUPABASE_URL as string);
    void original;
    const r = await pedir("t-admin-a", "GET", "/entidades");
    assert.equal(r.status, 503);
    assert.equal(r.json.error?.code, "FEATURE_UNAVAILABLE");
  });
});
