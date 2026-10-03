/**
 * FASE 3B.7 — las RUTAS reales del panel "Por aceptar" (lista, detalle, decisión): el frontend no es la autoridad.
 * Cada llamada vuelve a validar sesión, rol, módulos y negocio, contra un Supabase EN MEMORIA
 * (lib/testing/supabase-rest-memoria.ts): nada toca Supabase real ni Meta.
 *
 *   - sin sesión => 401; rol sin permiso => 403; negocio sin el módulo "pedidos_por_aceptar" (Delacour) => 403;
 *     negocio con "pedidos_por_aceptar" pero sin "pedidos" => 403;
 *   - con todo en regla, el negocio sale de la sesión (nunca de la URL ni del cuerpo);
 *   - parámetros mal formados => 400/404 antes de leer nada.
 * La lógica de negocio (aceptar, rechazar, concurrencia, documento) se prueba en lib/catalogo/pedidos/por-aceptar-b37.test.ts.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { GET as listaGET } from "./route";
import { GET as detalleGET, POST as decidirPOST } from "../[pedido]/aceptacion/route";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { CATALOG_MODULE, ORDERS_MODULE, POR_ACEPTAR_MODULE, decideCatalogAccess } from "@/lib/catalogo/auth";
import { MODULOS, esModuloId } from "@/lib/tenant-modulos";

const TA = "aaaaaaaa-0000-4000-8000-00000000000a"; // ASLC: pedidos + pedidos_por_aceptar
const TB = "bbbbbbbb-0000-4000-8000-00000000000b"; // Delacour: pedidos, SIN pedidos_por_aceptar
const TC = "cccccccc-0000-4000-8000-00000000000c"; // pedidos_por_aceptar SIN pedidos
const PEDIDO = "DL-ORD-AAAAAA";

let db: SupabaseMemoria;

beforeEach(() => {
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  db.table("dulabs_miembros_equipo").push(
    { id: 1, tenant_id: TA, user_id: "u-admin-a", rol: "admin", estado: "activo", email: "admin@a.test", nombre: "Ana" },
    { id: 2, tenant_id: TA, user_id: "u-agente-a", rol: "agente", estado: "activo", email: "agente@a.test", nombre: "Bea" },
    { id: 3, tenant_id: TA, user_id: "u-lectura-a", rol: "lectura", estado: "activo", email: "lectura@a.test", nombre: "Caro" },
    { id: 4, tenant_id: TB, user_id: "u-admin-b", rol: "admin", estado: "activo", email: "admin@b.test", nombre: "Dani" },
    { id: 5, tenant_id: TC, user_id: "u-admin-c", rol: "admin", estado: "activo", email: "admin@c.test", nombre: "Eva" },
    { id: 6, tenant_id: TA, user_id: "u-suspendido-a", rol: "agente", estado: "suspendido", email: "susp@a.test", nombre: "Fer" },
  );
  for (const [token, id] of [
    ["t-admin-a", "u-admin-a"],
    ["t-agente-a", "u-agente-a"],
    ["t-lectura-a", "u-lectura-a"],
    ["t-admin-b", "u-admin-b"],
    ["t-admin-c", "u-admin-c"],
    ["t-suspendido-a", "u-suspendido-a"],
    ["t-sin-equipo", "u-nadie"],
  ]) db.user(token, id);
  db.table("dulabs_tenant_modulos").push(
    { id_tenant: TA, modulo: "pedidos", habilitado: true },
    { id_tenant: TA, modulo: "pedidos_por_aceptar", habilitado: true },
    { id_tenant: TB, modulo: "pedidos", habilitado: true },
    { id_tenant: TC, modulo: "pedidos_por_aceptar", habilitado: true },
  );
  // Tablas de pedidos vacías: el motor de pedidos está disponible y no hay nada que listar.
  db.table("dulabs_catalogo_pedidos");
  db.table("dulabs_catalogo_reservas");
  db.table("dulabs_catalogo_pedido_eventos");
});
afterEach(() => db.uninstall());

const headers = (token?: string, extra: Record<string, string> = {}) => ({ ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra });
const lista = (token?: string, query = "") => listaGET(new NextRequest(`http://localhost/api/dashboard/pedidos/por-aceptar${query}`, { headers: headers(token) }));
const detalle = (token: string | undefined, pedido = PEDIDO) =>
  detalleGET(new NextRequest(`http://localhost/api/dashboard/pedidos/${pedido}/aceptacion`, { headers: headers(token) }), { params: Promise.resolve({ pedido }) });
const decidir = (token: string | undefined, body: unknown, pedido = PEDIDO) =>
  decidirPOST(new NextRequest(`http://localhost/api/dashboard/pedidos/${pedido}/aceptacion`, { method: "POST", headers: headers(token, { "content-type": "application/json" }), body: JSON.stringify(body) }), {
    params: Promise.resolve({ pedido }),
  });
type Cuerpo = { success: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
const leer = async (r: Response): Promise<{ status: number; body: Cuerpo }> => ({ status: r.status, body: (await r.json()) as Cuerpo });

const TRES = [
  ["lista", (t?: string) => lista(t)],
  ["detalle", (t?: string) => detalle(t)],
  ["decisión", (t?: string) => decidir(t, { accion: "aceptar" })],
] as const;

describe("3B.7 · rutas de Por aceptar: sesión, rol, módulos", () => {
  it("sin sesión => 401 en las tres rutas (nada se lee ni se decide)", async () => {
    for (const [nombre, llamar] of TRES) {
      const r = await leer(await llamar(undefined));
      assert.equal(r.status, 401, nombre);
      assert.equal(r.body.error?.code, "UNAUTHENTICATED", nombre);
    }
  });

  it("token que no es de nadie, o de alguien sin equipo => 401/403, jamás datos", async () => {
    for (const [nombre, llamar] of TRES) {
      for (const token of ["t-invalido", "t-sin-equipo"]) {
        const r = await leer(await llamar(token));
        assert.ok(r.status === 401 || r.status === 403, `${nombre}/${token}: ${r.status}`);
        assert.equal(r.body.success, false);
      }
    }
  });

  it("miembro SUSPENDIDO del negocio => no entra", async () => {
    for (const [nombre, llamar] of TRES) {
      const r = await leer(await llamar("t-suspendido-a"));
      assert.ok(r.status === 401 || r.status === 403, `${nombre}: ${r.status}`);
    }
  });

  it("rol 'lectura' => 403 FORBIDDEN en las tres rutas (solo admin y agente atienden pedidos)", async () => {
    for (const [nombre, llamar] of TRES) {
      const r = await leer(await llamar("t-lectura-a"));
      assert.equal(r.status, 403, nombre);
      assert.equal(r.body.error?.code, "FORBIDDEN", nombre);
    }
  });

  it("Delacour (módulo 'pedidos' SIN 'pedidos_por_aceptar') => 403 MODULE_DISABLED: ni lista, ni detalle, ni decisión", async () => {
    for (const [nombre, llamar] of TRES) {
      const r = await leer(await llamar("t-admin-b"));
      assert.equal(r.status, 403, nombre);
      assert.equal(r.body.error?.code, "MODULE_DISABLED", nombre);
      assert.match(r.body.error?.message ?? "", /Por aceptar/);
    }
  });

  it("'pedidos_por_aceptar' sin 'pedidos' => 403 MODULE_DISABLED (Por aceptar vive dentro de Pedidos)", async () => {
    for (const [nombre, llamar] of TRES) {
      const r = await leer(await llamar("t-admin-c"));
      assert.equal(r.status, 403, nombre);
      assert.equal(r.body.error?.code, "MODULE_DISABLED", nombre);
      assert.match(r.body.error?.message ?? "", /Pedidos/);
    }
  });

  it("negocio con ambos módulos: admin y agente entran (lista vacía, no un error)", async () => {
    for (const token of ["t-admin-a", "t-agente-a"]) {
      const r = await leer(await lista(token));
      assert.equal(r.status, 200, token);
      assert.deepEqual(r.body.data, { pedidos: [], siguiente: null });
    }
  });

  it("el módulo apagado (habilitado=false) también cierra las rutas", async () => {
    const fila = db.table("dulabs_tenant_modulos").find((f) => f.id_tenant === TA && f.modulo === "pedidos_por_aceptar");
    assert.ok(fila);
    fila.habilitado = false;
    for (const [nombre, llamar] of TRES) assert.equal((await leer(await llamar("t-admin-a"))).status, 403, nombre);
  });

  it("negocio con ambos módulos pero un pedido que no existe en ESE negocio => 404 (el pedido no se cruza por URL)", async () => {
    const r = await leer(await detalle("t-agente-a"));
    assert.equal(r.status, 404);
    assert.equal(r.body.error?.code, "NOT_FOUND");
    for (const accion of ["aceptar", "rechazar", "cancelar"]) assert.equal((await leer(await decidir("t-agente-a", { accion, motivo: "motivo de prueba" }))).status, 404, accion);
  });

  it("el negocio de la sesión manda: ni un tenant_id en la consulta o en el cuerpo, ni el id del pedido, lo cambian", async () => {
    const lis = await leer(await lista("t-agente-a", `?tenant_id=${TB}&tenantId=${TB}&id_tenant=${TB}`));
    assert.equal(lis.status, 200);
    const dec = await leer(await decidir("t-agente-a", { accion: "aceptar", tenant_id: TB, tenantId: TB, id_tenant: TB }));
    assert.equal(dec.status, 404, "busca el pedido en el negocio de la sesión (A), donde no existe");
  });

  it("parámetros mal formados: limite/cursor inválidos => 400; pedido mal formado => 404; acción o cuerpo inválidos => 400", async () => {
    for (const q of ["?limite=0", "?limite=51", "?limite=abc", "?cursor=basura", `?cursor=${"a".repeat(300)}`]) assert.equal((await leer(await lista("t-agente-a", q))).status, 400, q);
    for (const malo of ["DL-ORD-12", "x", "DL-ORD-AAAAA1U"]) assert.equal((await leer(await detalle("t-agente-a", malo))).status, 404, malo);
    for (const cuerpo of [{}, { accion: "confirmar" }, { accion: 1 }, null]) assert.equal((await leer(await decidir("t-agente-a", cuerpo))).status, 400, JSON.stringify(cuerpo));
    // Un rechazo sin motivo se rechaza ANTES de leer nada.
    assert.equal((await leer(await decidir("t-agente-a", { accion: "rechazar" }))).status, 400);
  });

  it("la URL no es un vector de acceso: la ruta del detalle exige las mismas guardas que la lista", async () => {
    // Una persona de Delacour que adivina la URL del detalle de un pedido de ASLC no entra (módulo), ni una sin sesión.
    assert.equal((await leer(await detalle("t-admin-b", "DL-ORD-AAAAAB"))).status, 403);
    assert.equal((await leer(await detalle(undefined, "DL-ORD-AAAAAB"))).status, 401);
  });
});

describe("3B.7 · módulo propio y política de acceso", () => {
  it("'pedidos_por_aceptar' es un módulo reconocido (la fila de dulabs_tenant_modulos lo habilita; no hace falta una migración)", () => {
    assert.ok(esModuloId("pedidos_por_aceptar"));
    assert.ok((MODULOS as readonly string[]).includes("pedidos_por_aceptar"));
    assert.equal(POR_ACEPTAR_MODULE, "pedidos_por_aceptar");
    assert.ok(!esModuloId("pedidos_por_aceptar "));
    assert.ok(!esModuloId("PEDIDOS_POR_ACEPTAR"));
  });

  it("decideCatalogAccess: admin y agente con el módulo => permitido; lectura => FORBIDDEN; sin módulo => MODULE_DISABLED con su mensaje", () => {
    for (const role of ["admin", "agente"] as const) assert.deepEqual(decideCatalogAccess({ role, mode: "orders", moduleEnabled: true, module: POR_ACEPTAR_MODULE }), { allowed: true });
    const lectura = decideCatalogAccess({ role: "lectura", mode: "orders", moduleEnabled: true, module: POR_ACEPTAR_MODULE });
    assert.equal(lectura.allowed, false);
    if (!lectura.allowed) assert.equal(lectura.code, "FORBIDDEN");
    const sinModulo = decideCatalogAccess({ role: "admin", mode: "orders", moduleEnabled: false, module: POR_ACEPTAR_MODULE });
    assert.equal(sinModulo.allowed, false);
    if (!sinModulo.allowed) {
      assert.equal(sinModulo.code, "MODULE_DISABLED");
      assert.match(sinModulo.message, /Por aceptar/);
    }
    // Los otros módulos conservan su mensaje de siempre.
    const pedidos = decideCatalogAccess({ role: "admin", mode: "orders", moduleEnabled: false, module: ORDERS_MODULE });
    if (!pedidos.allowed) assert.match(pedidos.message, /Pedidos/);
    const catalogo = decideCatalogAccess({ role: "admin", mode: "read", moduleEnabled: false, module: CATALOG_MODULE });
    if (!catalogo.allowed) assert.match(catalogo.message, /Catálogo/);
  });
});
