/**
 * Administración de tienda — lo que la API le cuenta al panel sobre la TIENDA del negocio (GET /contexto: tema, mayoristas, nombre) y el pie de página por las rutas reales (crear uno por negocio, solo un
 * administrador, estructura estricta). Sesión, equipo y módulos viven en un Supabase en memoria; el CMS corre sobre el SQL REAL en Postgres embebido (PGlite). Nada toca Supabase.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { pieInicial } from "@/lib/cms-comercial/pie";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { GET as contextoGET } from "./contexto/route";
import { POST as crearPOST } from "./entidades/route";

const TA = "aaaaaaaa-0000-4000-8000-00000000000a";
const TB = "bbbbbbbb-0000-4000-8000-00000000000b";

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
    { id: 3, tenant_id: TB, user_id: "d0000000-0000-4000-8000-000000000004", rol: "admin", estado: "activo", email: "admin@b.test", nombre: "Dani Admin" },
  );
  for (const [token, id] of [
    ["t-admin-a", "d0000000-0000-4000-8000-000000000001"],
    ["t-agente-a", "d0000000-0000-4000-8000-000000000002"],
    ["t-admin-b", "d0000000-0000-4000-8000-000000000004"],
  ]) db.user(token, id);
  db.table("dulabs_tenant_modulos").push({ id_tenant: TA, modulo: "cms_comercial", habilitado: true }, { id_tenant: TB, modulo: "cms_comercial", habilitado: true });
  db.table("dulabs_catalogo_categorias").push({ id: "c0000000-0000-4000-8000-0000000000a1", id_tenant: TA, nombre: "Aretes" });
  db.table("dulabs_catalogo_publicacion"); // la tabla existe aunque todavía no haya tiendas publicadas
  db.table("dulabs_agente_runtime_config").push({ id_tenant: TA, habilitado: true, created_at: "2026-09-01T00:00:00Z", negocio: { nombre_negocio: "Tienda A", pedido: { minimo_mayorista: 750000 } } });
});

afterEach(() => {
  puente.restaurar();
  db.uninstall();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Libre = any;
async function contexto(token: string): Promise<{ status: number; json: { success: boolean; data?: Record<string, Libre>; error?: { code: string; message: string } } }> {
  const res = await contextoGET(new NextRequest("http://localhost/api/dashboard/tienda/contexto", { headers: { authorization: `Bearer ${token}` } }));
  return { status: res.status, json: await res.json() };
}
async function crear(token: string, tipo: string, borrador: unknown) {
  const res = await crearPOST(new NextRequest("http://localhost/api/dashboard/tienda/entidades", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ tipo, borrador }) }));
  return { status: res.status, json: (await res.json()) as { success: boolean; data?: Record<string, Libre>; error?: { code: string; message: string } } };
}
const publicacion = (tenant: string, slug: string, nombre: string, publicado = true) => db.table("dulabs_catalogo_publicacion").push({ id_tenant: tenant, slug, nombre_publico: nombre, publicado, token_mayor: "f".repeat(64) });

describe("GET /contexto — qué tienda es el negocio", () => {
  it("la tienda de tema joyería con página de mayoristas: lo que el panel necesita para ofrecer el pie y las preguntas", async () => {
    publicacion(TA, "delacour", "Delacour y Orus (nombre público)");
    const r = await contexto("t-admin-a");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const t = r.json.data?.tienda;
    assert.equal(t.slug, "delacour");
    assert.equal(t.nombre, "Delacour & Orus", "el nombre de la marca del registro de la tienda, no el nombre público guardado");
    assert.equal(t.tema, "joyeria");
    assert.equal(t.mayoristas, true);
    assert.deepEqual(t.paginaMayoristas, { intro: "venta-al-por-mayor", omitir: ["emprendimiento"], tambien: ["envios", "medios-de-pago", "garantias", "cambios-y-devoluciones"] });
    assert.equal(t.descripcion, "Diseños únicos para cada momento de tu vida.");
    assert.equal(r.json.data?.rutaTienda, "/catalogo/delacour");
  });

  it("la tienda de joyería cuenta con qué videos se ve hoy en cada espacio (lo que el panel muestra como «el de siempre»)", async () => {
    publicacion(TA, "delacour", "Delacour");
    const v = (await contexto("t-admin-a")).json.data?.tienda.videosDeSiempre;
    assert.deepEqual(Object.keys(v).sort(), ["coleccion", "marca", "mayoristas", "portada"]);
    assert.deepEqual(v.portada.horizontal, { src: "/catalogo/delacour/video/portada-h.mp4", poster: "/catalogo/delacour/video/portada-h.webp", width: 1280, height: 720 });
    assert.deepEqual(v.portada.vertical, { src: "/catalogo/delacour/video/portada-v.mp4", poster: "/catalogo/delacour/video/portada-v.webp", width: 720, height: 1280 });
    assert.equal(v.marca.vertical, undefined, "la marca solo tiene un archivo");
    assert.equal(v.mayoristas.horizontal.width, 1280);
  });

  it("la tienda de joyería cuenta con qué textos se ve hoy el bloque «Compras por mayor» (lo que el panel muestra como «el de siempre»); una tienda sin ese bloque no trae el campo", async () => {
    publicacion(TA, "delacour", "Delacour");
    const t = (await contexto("t-admin-a")).json.data?.tienda;
    assert.deepEqual(t.textosMayoristas, {
      etiqueta: "Compras por mayor",
      titulo: "Compra al por mayor",
      texto: "Escríbenos por WhatsApp y una asesora te atiende.",
      boton: "Hablar con una asesora",
      mensaje: "Hola, quiero información para comprar al por mayor.",
    });
    assert.equal("textosMayoristas" in ((await contexto("t-agente-a")).json.data?.tienda ?? {}), true, "también lo ve quien solo consulta");
  });

  it("una tienda sin tema propio: no hay pie ni preguntas que ofrecer (mayoristas false, sin página, sin frase)", async () => {
    publicacion(TA, "tienda-a", "Tienda A");
    const t = (await contexto("t-admin-a")).json.data?.tienda;
    assert.deepEqual(t, { slug: "tienda-a", nombre: "Tienda A", tema: "clasico", mayoristas: false, paginaMayoristas: null, descripcion: null, videosDeSiempre: {} });
  });

  it("sin tienda publicada (o con la tienda sin publicar) no hay información de tienda, y el resto del contexto sigue llegando", async () => {
    const sin = await contexto("t-admin-a");
    assert.equal(sin.status, 200);
    assert.equal(sin.json.data?.tienda, null);
    assert.ok(Array.isArray(sin.json.data?.categorias) && sin.json.data?.zona);
    publicacion(TA, "delacour", "Delacour", false);
    assert.equal((await contexto("t-admin-a")).json.data?.tienda, null);
  });

  it("cada negocio ve SU tienda (el negocio sale de la sesión)", async () => {
    publicacion(TA, "delacour", "Delacour");
    publicacion(TB, "tienda-b", "Tienda B");
    assert.equal((await contexto("t-admin-a")).json.data?.tienda.slug, "delacour");
    assert.equal((await contexto("t-admin-b")).json.data?.tienda.slug, "tienda-b");
  });

  it("lo pueden leer todos los roles del equipo, y NO trae el secreto del enlace mayorista ni ningún identificador interno", async () => {
    publicacion(TA, "delacour", "Delacour");
    const r = await contexto("t-agente-a");
    assert.equal(r.status, 200);
    const texto = JSON.stringify(r.json);
    assert.ok(!texto.includes("f".repeat(64)) && !/token/i.test(texto), "ni el token mayorista");
    assert.ok(!texto.includes(TA), "ni el id del negocio");
    assert.equal((await contexto("sin-sesion")).status, 401);
  });
});

describe("el pie por las rutas reales", () => {
  it("un administrador lo crea (código fijo «pie»); otro intento en el mismo negocio se rechaza; el otro negocio tiene el suyo", async () => {
    const a = await crear("t-admin-a", "pie", pieInicial({ mayoristas: true }));
    assert.equal(a.status, 201, JSON.stringify(a.json));
    assert.equal(a.json.data?.entidad.clave, "pie");
    assert.equal(a.json.data?.entidad.nombre, "Pie de página");
    assert.equal(a.json.data?.entidad.estadoVigencia, null);
    const otra = await crear("t-admin-a", "pie", pieInicial({ mayoristas: true }));
    assert.equal(otra.status, 400);
    assert.equal(otra.json.error?.message, "El pie de página ya existe.");
    assert.equal((await crear("t-admin-b", "pie", pieInicial({ mayoristas: false }))).status, 201);
  });

  it("solo un administrador: un agente recibe 403 y no se crea nada", async () => {
    const r = await crear("t-agente-a", "pie", pieInicial({ mayoristas: true }));
    assert.equal(r.status, 403);
    assert.equal((await pg.sql("select 1 from public.dulabs_cms_entidades where tipo = 'pie'")).length, 0);
  });

  it("la estructura es la del pie: campos de otro tipo y valores que no son del pie se rechazan con un mensaje en español", async () => {
    const ajeno = await crear("t-admin-a", "pie", { portada: { visible: true } });
    assert.equal(ajeno.status, 400);
    assert.match(ajeno.json.error?.message ?? "", /Campo no permitido: portada/);
    const noObjeto = await crear("t-admin-a", "pie", [1, 2, 3]);
    assert.equal(noObjeto.status, 400);
    assert.equal((await pg.sql("select 1 from public.dulabs_cms_entidades where tipo = 'pie'")).length, 0);
  });
});
