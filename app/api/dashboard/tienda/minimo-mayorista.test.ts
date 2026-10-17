/**
 * Administración de tienda — /api/dashboard/tienda/minimo-mayorista por las rutas reales: ver el mínimo de la compra inicial mayorista y cambiarlo. Sesión, rol, módulo y aislamiento por negocio viven en un
 * Supabase en memoria; el cambio corre sobre el SQL REAL (Postgres embebido, PGlite) con la migración 20261214000000 y las tablas reales del asistente. Nada toca Supabase.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { crearBaseCms, rutaMigracion, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { GET, PUT } from "./minimo-mayorista/route";

const TA = "aaaaaaaa-0000-4000-8000-00000000000a"; // CMS habilitado
const TB = "bbbbbbbb-0000-4000-8000-00000000000b"; // CMS habilitado (otro negocio)
const TC = "cccccccc-0000-4000-8000-00000000000c"; // SIN el módulo
const ADMIN_A = "d0000000-0000-4000-8000-000000000001";

let pg: BaseCms;
let db: SupabaseMemoria;
let puente: PuenteRpc;

before(async () => {
  pg = await crearBaseCms();
  for (const archivo of ["20261109000000_dulabs_agente_runtime.sql", "20261201000000_dulabs_agente_negocio_64kb.sql", "20261214000000_dulabs_agente_minimo_mayorista.sql"]) {
    await pg.db.exec(readFileSync(rutaMigracion(archivo), "utf8"));
  }
});
after(async () => {
  await pg.cerrar();
});

/** Una configuración del asistente como la de Delacour, con el monto escrito a mano en dos textos. */
const negocio = (minimo = 750000, texto = "$750.000") => ({
  nombre_negocio: "Tienda",
  inicio: { mayor: `La compra inicial mayorista parte de ${texto}.` },
  conocimiento: [{ tema: "mayoristas", info: `Primera compra desde ${texto}. No confundir con 1.750.000.` }],
  pedido: { minimo_mayorista: minimo },
});
let serie = 0;
async function linea(tenant: string, neg: unknown, habilitado = true) {
  serie += 1;
  const telefono = `5730000${String(serie).padStart(5, "0")}`;
  await pg.db.query(
    `insert into public.dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, herramientas, negocio)
     values ($1, $2, 'catalog_sales', $3, 'gemini', 'gemini-2.5-flash', 'env:GEMINI_KEY_PRUEBA', array['buscar_catalogo'], $4::jsonb)`,
    [tenant, telefono, habilitado, JSON.stringify(neg)],
  );
  return telefono;
}
const negocioDe = async (telefono: string) => (await pg.sql<{ negocio: ReturnType<typeof negocio> }>("select negocio from public.dulabs_agente_runtime_config where phone_number_id = $1", [telefono]))[0].negocio;
const auditoria = () => pg.sql<{ id_tenant: string; actor_user_id: string; antes: { minimo: number }; despues: { minimo: number } }>("select id_tenant, actor_user_id, antes, despues from public.dulabs_agente_config_cambios order by id");

beforeEach(async () => {
  await pg.db.exec("delete from public.dulabs_agente_runtime_config");
  await pg.db.exec("alter table public.dulabs_agente_config_cambios disable trigger dulabs_agente_config_cambios_inmutables; delete from public.dulabs_agente_config_cambios; alter table public.dulabs_agente_config_cambios enable trigger dulabs_agente_config_cambios_inmutables");
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  puente = instalarPuenteRpcCms(pg, process.env.SUPABASE_URL as string);
  db.table("dulabs_miembros_equipo").push(
    { id: 1, tenant_id: TA, user_id: ADMIN_A, rol: "admin", estado: "activo", email: "admin@a.test", nombre: "Ana Admin" },
    { id: 2, tenant_id: TA, user_id: "d0000000-0000-4000-8000-000000000002", rol: "agente", estado: "activo", email: "agente@a.test", nombre: "Bea Agente" },
    { id: 3, tenant_id: TA, user_id: "d0000000-0000-4000-8000-000000000003", rol: "lectura", estado: "activo", email: "lectura@a.test", nombre: null },
    { id: 4, tenant_id: TB, user_id: "d0000000-0000-4000-8000-000000000004", rol: "admin", estado: "activo", email: "admin@b.test", nombre: "Dani Admin" },
    { id: 5, tenant_id: TC, user_id: "d0000000-0000-4000-8000-000000000005", rol: "admin", estado: "activo", email: "admin@c.test", nombre: "Eva Admin" },
  );
  for (const [token, id] of [
    ["t-admin-a", ADMIN_A],
    ["t-agente-a", "d0000000-0000-4000-8000-000000000002"],
    ["t-lectura-a", "d0000000-0000-4000-8000-000000000003"],
    ["t-admin-b", "d0000000-0000-4000-8000-000000000004"],
    ["t-admin-c", "d0000000-0000-4000-8000-000000000005"],
  ]) db.user(token, id);
  db.table("dulabs_tenant_modulos").push({ id_tenant: TA, modulo: "cms_comercial", habilitado: true }, { id_tenant: TB, modulo: "cms_comercial", habilitado: true }, { id_tenant: TC, modulo: "catalogo", habilitado: true });
  // Lo que leen las variables del CMS cuando no existe la migración (el mismo mínimo que las líneas reales).
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
  method: cuerpo === undefined ? "GET" : "PUT",
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
  ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
});
const req = (init: ReturnType<typeof con>) => new NextRequest("http://localhost/api/dashboard/tienda/minimo-mayorista", init as ConstructorParameters<typeof NextRequest>[1]);
const leer = async (r: Response): Promise<Respuesta> => ({ status: r.status, json: await r.json() });
const ver = (token: string | undefined) => GET(req(con(token))).then(leer);
const cambiar = (token: string | undefined, cuerpo: unknown) => PUT(req(con(token, cuerpo))).then(leer);
const llamadasAplicar = () => puente.llamadas.filter((n) => n === "dulabs_agente_minimo_mayorista_aplicar").length;

describe("acceso", () => {
  it("sin sesión → 401; sin el módulo de la tienda → 403 (también para cambiarlo)", async () => {
    assert.equal((await ver(undefined)).status, 401);
    assert.equal((await cambiar(undefined, { minimo: 900000, esperado: 750000 })).status, 401);
    const sinModulo = await ver("t-admin-c");
    assert.equal(sinModulo.status, 403);
    assert.equal(sinModulo.json.error?.code, "MODULE_DISABLED");
    assert.equal((await cambiar("t-admin-c", { minimo: 900000, esperado: 750000 })).status, 403);
  });

  it("verlo: administrador, agente y lectura; cambiarlo: SOLO el administrador (el resto, 403 sin llegar a la base)", async () => {
    await linea(TA, negocio());
    for (const token of ["t-admin-a", "t-agente-a", "t-lectura-a"]) assert.equal((await ver(token)).status, 200, token);
    for (const token of ["t-agente-a", "t-lectura-a"]) {
      const r = await cambiar(token, { minimo: 900000, esperado: 750000 });
      assert.equal(r.status, 403, token);
      assert.equal(r.json.error?.code, "FORBIDDEN");
    }
    assert.equal(llamadasAplicar(), 0, "ninguna petición rechazada llegó a la base");
    assert.equal((await auditoria()).length, 0);
  });
});

describe("GET: cómo está el mínimo", () => {
  it("el monto, que las líneas coinciden y en qué textos del asistente está escrito a mano (rutas, sin el contenido)", async () => {
    await linea(TA, negocio());
    const r = await ver("t-admin-a");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data, { configurado: true, minimo: 750000, uniforme: true, filas: 1, lugares: ["conocimiento.0.info", "inicio.mayor"], disponible: true });
    assert.equal(JSON.stringify(r.json).includes("La compra inicial"), false, "no devuelve el contenido de los textos");
  });

  it("solo las líneas de SU negocio: el mínimo de otro negocio no aparece", async () => {
    await linea(TA, negocio(750000));
    await linea(TB, negocio(2000000, "$2.000.000"));
    assert.equal((await ver("t-admin-a")).json.data?.minimo, 750000);
    assert.equal((await ver("t-admin-b")).json.data?.minimo, 2000000);
  });

  it("sin ninguna línea con mínimo: «no configurado»; con montos distintos entre líneas: «no uniforme»", async () => {
    const vacio = await ver("t-admin-a");
    assert.deepEqual([vacio.json.data?.configurado, vacio.json.data?.minimo, vacio.json.data?.disponible], [false, null, true]);
    await linea(TA, negocio(750000));
    await linea(TA, negocio(900000, "$900.000"));
    const distintos = await ver("t-admin-a");
    assert.equal(distintos.json.data?.uniforme, false);
  });

  it("antes de aplicar la migración se ve el monto que ya usan los textos, pero «cambiarlo todavía no está activo»", async () => {
    puente.restaurar();
    const vieja = await crearBaseCms();
    const puenteViejo = instalarPuenteRpcCms(vieja, process.env.SUPABASE_URL as string);
    try {
      const r = await ver("t-admin-a");
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.data, { configurado: true, minimo: 750000, uniforme: true, filas: 0, lugares: [], disponible: false });
      const intento = await cambiar("t-admin-a", { minimo: 900000, esperado: 750000 });
      assert.equal(intento.status, 503);
      assert.equal(intento.json.error?.code, "FEATURE_UNAVAILABLE");
    } finally {
      puenteViejo.restaurar();
      await vieja.cerrar();
    }
  });
});

describe("PUT: cambiar el mínimo", () => {
  it("cambia el número y el monto escrito a mano, responde con lo que cambió y deja una fila de auditoría con quien lo hizo (de la sesión)", async () => {
    const a = await linea(TA, negocio());
    const ajena = await linea(TB, negocio(750000));
    const r = await cambiar("t-admin-a", { minimo: 1000000, esperado: 750000 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data, { cambio: true, antes: 750000, despues: 1000000, filas: 1, lugares: ["conocimiento.0.info", "inicio.mayor"] });
    const nuevo = await negocioDe(a);
    assert.equal(nuevo.pedido.minimo_mayorista, 1000000);
    assert.equal(nuevo.inicio.mayor, "La compra inicial mayorista parte de $1.000.000.");
    assert.equal(nuevo.conocimiento[0].info, "Primera compra desde $1.000.000. No confundir con 1.750.000.");
    assert.deepEqual(await negocioDe(ajena), negocio(750000), "otro negocio no se toca");
    const filas = await auditoria();
    assert.equal(filas.length, 1);
    assert.deepEqual([filas[0].id_tenant, filas[0].actor_user_id, filas[0].antes.minimo, filas[0].despues.minimo], [TA, ADMIN_A, 750000, 1000000]);
    // Y la vista ya muestra el monto nuevo.
    assert.equal((await ver("t-admin-a")).json.data?.minimo, 1000000);
  });

  it("el cuerpo solo trae el monto nuevo y el que se veía: el negocio y quién cambia salen de la sesión, nunca del cuerpo", async () => {
    const a = await linea(TA, negocio());
    const ajena = await linea(TB, negocio(750000));
    for (const extra of [{ tenantId: TB }, { id_tenant: TB }, { actor: "otro" }, { phone_number_id: "x" }]) {
      const r = await cambiar("t-admin-a", { minimo: 900000, esperado: 750000, ...extra });
      assert.equal(r.status, 400, JSON.stringify(extra));
    }
    assert.equal((await negocioDe(a)).pedido.minimo_mayorista, 750000);
    assert.equal((await negocioDe(ajena)).pedido.minimo_mayorista, 750000);
    assert.equal(llamadasAplicar(), 0);
  });

  it("un monto fuera de rango, no entero o ausente se rechaza con un mensaje claro sin llegar a la base", async () => {
    await linea(TA, negocio());
    const casos: unknown[] = [
      { minimo: 9999, esperado: 750000 },
      { minimo: 100000001, esperado: 750000 },
      { minimo: 75.5, esperado: 750000 },
      { minimo: "900000", esperado: 750000 },
      { minimo: 900000 },
      { esperado: 750000 },
      { minimo: 900000, esperado: 0 },
      {},
    ];
    for (const cuerpo of casos) {
      const r = await cambiar("t-admin-a", cuerpo);
      assert.equal(r.status, 400, JSON.stringify(cuerpo));
      assert.equal(r.json.error?.code, "VALIDATION_ERROR");
    }
    assert.equal(llamadasAplicar(), 0);
    assert.equal((await auditoria()).length, 0);
  });

  it("si el monto que la persona veía ya no es el actual: 409 y no se pisa el cambio de nadie", async () => {
    const a = await linea(TA, negocio());
    assert.equal((await cambiar("t-admin-a", { minimo: 900000, esperado: 750000 })).status, 200);
    const tarde = await cambiar("t-admin-a", { minimo: 1000000, esperado: 750000 });
    assert.equal(tarde.status, 409);
    assert.equal(tarde.json.error?.code, "CONFLICT");
    assert.match(tarde.json.error?.message ?? "", /cambió mientras lo editabas/);
    assert.equal((await negocioDe(a)).pedido.minimo_mayorista, 900000);
    assert.equal((await auditoria()).length, 1);
  });

  it("el mismo monto no cambia nada ni deja auditoría", async () => {
    await linea(TA, negocio());
    const r = await cambiar("t-admin-a", { minimo: 750000, esperado: 750000 });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.data?.cambio, r.json.data?.lugares], [false, []]);
    assert.equal((await auditoria()).length, 0);
    assert.equal(llamadasAplicar(), 0);
  });

  it("un texto que con el monto nuevo superaría su máximo (el asistente dejaría de responder): 400 claro y nada cambia", async () => {
    const justo = `${"a".repeat(891)}$750.000`;
    const a = await linea(TA, { ...negocio(), inicio: { mayor: justo } });
    const r = await cambiar("t-admin-a", { minimo: 1750000, esperado: 750000 });
    assert.equal(r.status, 400);
    assert.match(r.json.error?.message ?? "", /superaría el largo permitido/);
    assert.equal((await negocioDe(a)).pedido.minimo_mayorista, 750000);
    assert.equal(llamadasAplicar(), 0);
  });

  it("sin mínimo configurado o con montos distintos entre líneas: 409 claro y nada cambia", async () => {
    const sin = await cambiar("t-admin-a", { minimo: 900000, esperado: 750000 });
    assert.equal(sin.status, 409);
    assert.match(sin.json.error?.message ?? "", /todavía no tiene un mínimo configurado/);
    await linea(TA, negocio(750000));
    await linea(TA, negocio(850000, "$850.000"));
    const distintos = await cambiar("t-admin-a", { minimo: 900000, esperado: 750000 });
    assert.equal(distintos.status, 409);
    assert.match(distintos.json.error?.message ?? "", /montos mínimos distintos/);
    assert.equal((await auditoria()).length, 0);
  });

  it("un fallo de la base no se filtra: el cliente ve un mensaje general, sin SQL ni nombres internos, y no cambia nada", async () => {
    const a = await linea(TA, negocio());
    puente.fallarProxima("dulabs_agente_minimo_mayorista_aplicar");
    const r = await cambiar("t-admin-a", { minimo: 900000, esperado: 750000 });
    assert.equal(r.status, 500);
    assert.equal(r.json.error?.code, "INTERNAL_ERROR");
    const texto = JSON.stringify(r.json);
    assert.equal(/dulabs_|secreto interno|relation|detalle sensible/.test(texto), false, texto);
    assert.equal((await negocioDe(a)).pedido.minimo_mayorista, 750000);
  });
});
