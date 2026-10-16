/**
 * Administración de tienda — las rutas de los VIDEOS: pedir la subida, confirmar (el servidor analiza el MP4) y la lista. De punta a punta con sesión, rol, módulo, el SQL real (Postgres
 * embebido), Storage emulado y los videos reales de la tienda de Delacour. El negocio sale SIEMPRE de la sesión.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { crearAlmacenMemoria, type AlmacenMemoria } from "@/lib/cms-comercial/testing/almacen-memoria";
import { crearMp4 } from "@/lib/cms-comercial/testing/mp4";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { GET as videosGET } from "./videos/route";
import { POST as confirmarPOST } from "./videos/[id]/confirmar/route";
import { POST as subidaPOST } from "./videos/upload-url/route";

const TA = "aaaaaaaa-0000-4000-8000-00000000000a";
const TB = "bbbbbbbb-0000-4000-8000-00000000000b";
const TC = "cccccccc-0000-4000-8000-00000000000c"; // sin el módulo
const CARPETA = path.join(process.cwd(), "public", "catalogo", "delacour", "video");
const real = (nombre: string) => new Uint8Array(readFileSync(path.join(CARPETA, nombre)));

let pg: BaseCms;
let db: SupabaseMemoria;
let puente: PuenteRpc;
let almacen: AlmacenMemoria;

before(async () => {
  pg = await crearBaseCms();
});
after(async () => {
  await pg.cerrar();
});

beforeEach(async () => {
  await pg.aplicarSql("truncate public.dulabs_cms_auditoria, public.dulabs_cms_versiones, public.dulabs_cms_assets, public.dulabs_cms_entidades cascade");
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  almacen = crearAlmacenMemoria(process.env.SUPABASE_URL);
  puente = instalarPuenteRpcCms(pg, process.env.SUPABASE_URL as string, { almacen });
  db.table("dulabs_miembros_equipo").push(
    { id: 1, tenant_id: TA, user_id: "d0000000-0000-4000-8000-000000000001", rol: "admin", estado: "activo", email: "admin@a.test", nombre: "Ana Admin" },
    { id: 2, tenant_id: TA, user_id: "d0000000-0000-4000-8000-000000000002", rol: "agente", estado: "activo", email: "agente@a.test", nombre: "Bea" },
    { id: 3, tenant_id: TA, user_id: "d0000000-0000-4000-8000-000000000003", rol: "lectura", estado: "activo", email: "lectura@a.test", nombre: null },
    { id: 4, tenant_id: TB, user_id: "d0000000-0000-4000-8000-000000000004", rol: "admin", estado: "activo", email: "admin@b.test", nombre: "Dani" },
    { id: 5, tenant_id: TC, user_id: "d0000000-0000-4000-8000-000000000005", rol: "admin", estado: "activo", email: "admin@c.test", nombre: "Eva" },
  );
  for (const [token, id] of [
    ["t-admin-a", "d0000000-0000-4000-8000-000000000001"],
    ["t-agente-a", "d0000000-0000-4000-8000-000000000002"],
    ["t-lectura-a", "d0000000-0000-4000-8000-000000000003"],
    ["t-admin-b", "d0000000-0000-4000-8000-000000000004"],
    ["t-admin-c", "d0000000-0000-4000-8000-000000000005"],
  ]) db.user(token, id);
  db.table("dulabs_tenant_modulos").push({ id_tenant: TA, modulo: "cms_comercial", habilitado: true }, { id_tenant: TB, modulo: "cms_comercial", habilitado: true }, { id_tenant: TC, modulo: "catalogo", habilitado: true });
});

afterEach(() => {
  puente.restaurar();
  db.uninstall();
});

// ---------------------------------------------------------------------------

interface Respuesta {
  status: number;
  // El cuerpo de una respuesta se navega libremente en las pruebas (es JSON de la API, no un tipo del dominio).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: { success: boolean; data?: any; error?: { code: string; message: string; diagnostics?: { problemas?: Array<{ codigo: string; campo: string; mensaje: string }> } } };
}

async function pedir(token: string | undefined, metodo: "GET" | "POST", ruta: string, cuerpo?: unknown, extra: { crudo?: string } = {}): Promise<Respuesta> {
  const headers: Record<string, string> = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo !== undefined || extra.crudo !== undefined ? { "content-type": "application/json" } : {}) };
  const request = new NextRequest(`http://localhost/api/dashboard/tienda${ruta}`, { method: metodo, headers, body: extra.crudo ?? (cuerpo === undefined ? undefined : JSON.stringify(cuerpo)) });
  const partes = ruta.split("?")[0].split("/").filter(Boolean);
  let res: Response;
  if (partes[1] === "upload-url") res = await subidaPOST(request);
  else if (partes[2] === "confirmar") res = await confirmarPOST(request, { params: Promise.resolve({ id: partes[1] }) });
  else res = await videosGET(request);
  return { status: res.status, json: (await res.json()) as Respuesta["json"] };
}

async function subirVideo(token = "t-admin-a", bytes: Uint8Array = real("portada-h.mp4")) {
  const t = await pedir(token, "POST", "/videos/upload-url", { mimeType: "video/mp4", bytes: bytes.byteLength, nombreOriginal: "portada.mp4" });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const ticket = t.json.data.subida as { id: string; path: string };
  almacen.subirComoNavegador(ticket.path, bytes, "video/mp4");
  return ticket;
}

describe("permisos y módulo en las rutas de videos", () => {
  it("sin sesión o con sesión falsa: 401, y nada llega a la base ni al almacén", async () => {
    puente.llamadas.length = 0;
    for (const [metodo, ruta, cuerpo] of [
      ["GET", "/videos"],
      ["POST", "/videos/upload-url", { mimeType: "video/mp4", bytes: 100 }],
      ["POST", `/videos/${TA}/confirmar`, { archivo: "portada.horizontal" }],
    ] as Array<["GET" | "POST", string, unknown?]>) {
      assert.equal((await pedir(undefined, metodo, ruta, cuerpo)).status, 401, ruta);
      assert.equal((await pedir("falso", metodo, ruta, cuerpo)).status, 401, ruta);
    }
    assert.deepEqual(puente.llamadas, []);
    assert.deepEqual(almacen.llamadas, []);
  });

  it("agente y lectura: consultan la lista; NO suben ni confirman (403 sin tocar el almacén)", async () => {
    for (const token of ["t-agente-a", "t-lectura-a"]) {
      assert.equal((await pedir(token, "GET", "/videos")).status, 200, token);
      puente.llamadas.length = 0;
      const subida = await pedir(token, "POST", "/videos/upload-url", { mimeType: "video/mp4", bytes: 1000 });
      assert.equal(subida.status, 403);
      assert.equal(subida.json.error?.code, "FORBIDDEN");
      assert.equal((await pedir(token, "POST", `/videos/${TA}/confirmar`, { archivo: "portada.horizontal" })).status, 403);
      assert.deepEqual(puente.llamadas, []);
      assert.deepEqual(almacen.llamadas, []);
    }
  });

  it("un negocio sin el módulo no tiene estas rutas (403 MODULE_DISABLED)", async () => {
    for (const [metodo, ruta, cuerpo] of [
      ["GET", "/videos"],
      ["POST", "/videos/upload-url", { mimeType: "video/mp4", bytes: 100 }],
    ] as Array<["GET" | "POST", string, unknown?]>) {
      const r = await pedir("t-admin-c", metodo, ruta, cuerpo);
      assert.equal(r.status, 403, ruta);
      assert.equal(r.json.error?.code, "MODULE_DISABLED");
    }
    assert.deepEqual(almacen.llamadas, []);
  });
});

describe("videos por HTTP", () => {
  it("la entrada se valida antes de tocar nada: tipo, tamaño, claves de más y JSON", async () => {
    puente.llamadas.length = 0;
    const malos: Array<[unknown, RegExp]> = [
      [{ mimeType: "video/quicktime", bytes: 100 }, /video MP4/],
      [{ mimeType: "image/png", bytes: 100 }, /video MP4/],
      [{ mimeType: "video/mp4", bytes: 0 }, /vacío/],
      [{ mimeType: "video/mp4", bytes: 4 * 1024 * 1024 }, /supera el tamaño máximo permitido \(3 MB\)/],
      [{ mimeType: "video/mp4" }, /tamaño/],
      [{ mimeType: "video/mp4", bytes: 100, path: "../../otro-negocio/robado.mp4" }, /no permitido/i],
      [{ mimeType: "video/mp4", bytes: 100, tenantId: TB }, /no permitido/i],
      [{ mimeType: "video/mp4", bytes: 100, nombreOriginal: "x".repeat(201) }, /demasiado largo/],
    ];
    for (const [cuerpo, mensaje] of malos) {
      const r = await pedir("t-admin-a", "POST", "/videos/upload-url", cuerpo);
      assert.equal(r.status, 400, JSON.stringify(cuerpo).slice(0, 80));
      assert.match(r.json.error?.message ?? "", mensaje);
    }
    assert.equal((await pedir("t-admin-a", "POST", "/videos/upload-url", undefined, { crudo: "{no" })).status, 400);
    assert.deepEqual(puente.llamadas, []);
    assert.deepEqual(almacen.llamadas, []);
  });

  it("el administrador recibe una subida firmada con la ruta bajo SU negocio; el video queda pendiente y fuera de la lista", async () => {
    const r = await pedir("t-admin-a", "POST", "/videos/upload-url", { mimeType: "video/mp4", bytes: 900_000, nombreOriginal: "portada.mp4" });
    assert.equal(r.status, 201);
    const s = r.json.data.subida;
    assert.deepEqual(Object.keys(s).sort(), ["bucket", "id", "maxBytes", "path", "token"]);
    assert.equal(s.bucket, "inventario-productos");
    assert.equal(s.path, `${TA}/cms/${s.id}/subida`);
    assert.equal(s.maxBytes, 3 * 1024 * 1024);
    assert.ok(s.token);
    const [fila] = await pg.sql<{ estado: string; mime_type: string }>("select estado, mime_type from public.dulabs_cms_assets where id = $1", [s.id]);
    assert.deepEqual([fila.estado, fila.mime_type], ["pendiente", "video/mp4"]);
    assert.deepEqual((await pedir("t-admin-a", "GET", "/videos")).json.data.items, []);
  });

  it("el flujo completo: pedir → subir → confirmar para su espacio → lista → el video guardado es un MP4 idéntico", async () => {
    const original = real("coleccion-v.mp4");
    const ticket = await subirVideo("t-admin-a", original);
    const c = await pedir("t-admin-a", "POST", `/videos/${ticket.id}/confirmar`, { archivo: "coleccion.vertical" });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.deepEqual(Object.keys(c.json.data).sort(), ["duracionSeg", "recomendaciones", "seCorrigio", "video"]);
    const v = c.json.data.video;
    assert.deepEqual([v.id, v.ancho, v.alto, v.bytes], [ticket.id, 720, 1280, original.byteLength]);
    assert.equal(v.url, `http://supabase.memoria/storage/v1/object/public/inventario-productos/${TA}/cms/${ticket.id}/video.mp4`);
    assert.deepEqual(Object.keys(v).sort(), ["alto", "ancho", "bytes", "createdAt", "id", "nombreOriginal", "url"]);
    assert.ok(c.json.data.duracionSeg > 4);

    const lista = await pedir("t-lectura-a", "GET", "/videos");
    assert.deepEqual(lista.json.data.items.map((i: { id: string }) => i.id), [ticket.id]);

    const publica = await fetch(v.url);
    assert.equal(publica.status, 200);
    assert.equal(publica.headers.get("content-type"), "video/mp4");
    assert.deepEqual(new Uint8Array(await publica.arrayBuffer()), original);
    assert.equal(almacen.objetos.has(`${TA}/cms/${ticket.id}/subida`), false, "el archivo crudo se borra");
  });

  it("confirmar dos veces es idempotente", async () => {
    const ticket = await subirVideo();
    const una = await pedir("t-admin-a", "POST", `/videos/${ticket.id}/confirmar`, { archivo: "portada.horizontal" });
    const dos = await pedir("t-admin-a", "POST", `/videos/${ticket.id}/confirmar`, { archivo: "portada.horizontal" });
    assert.equal(dos.status, 200);
    assert.deepEqual(dos.json.data.video, una.json.data.video);
  });

  it("la confirmación pide el espacio: sin él, con uno inexistente o con claves de más es 400 y no toca el almacén", async () => {
    const ticket = await subirVideo();
    const antes = almacen.llamadas.length;
    puente.llamadas.length = 0;
    for (const cuerpo of [undefined, {}, { archivo: "" }, { archivo: "pie.horizontal" }, { archivo: "marca.vertical" }, { archivo: "portada.horizontal", extra: 1 }, { archivo: ["portada.horizontal"] }]) {
      const r = await pedir("t-admin-a", "POST", `/videos/${ticket.id}/confirmar`, cuerpo);
      assert.equal(r.status, 400, JSON.stringify(cuerpo));
    }
    assert.deepEqual(puente.llamadas, []);
    assert.equal(almacen.llamadas.length, antes);
  });

  it("un video que no cumple: 400 con las reglas que falla, qué hacer, y nada guardado", async () => {
    const ticket = await subirVideo("t-admin-a", crearMp4({ audio: true, duracionSeg: 30, ancho: 640, alto: 360 }));
    const c = await pedir("t-admin-a", "POST", `/videos/${ticket.id}/confirmar`, { archivo: "portada.horizontal" });
    assert.equal(c.status, 400);
    assert.equal(c.json.error?.code, "VALIDATION_ERROR");
    assert.match(c.json.error?.message ?? "", /Este video no se puede usar/);
    const codigos = (c.json.error?.diagnostics?.problemas ?? []).map((p) => p.codigo).sort();
    assert.deepEqual(codigos, ["duracion", "medidas", "sonido"]);
    assert.ok((c.json.error?.diagnostics?.problemas ?? []).every((p) => p.campo === "portada.horizontal" && p.mensaje.length > 20));
    assert.deepEqual((await pedir("t-admin-a", "GET", "/videos")).json.data.items, []);
    assert.equal(almacen.objetos.has(`${TA}/cms/${ticket.id}/video.mp4`), false);
    assert.equal(almacen.objetos.has(`${TA}/cms/${ticket.id}/subida`), false, "lo subido se borra");
  });

  it("un archivo que no es un video: 400 con mensaje claro", async () => {
    const ticket = await subirVideo("t-admin-a", new TextEncoder().encode("<html><script>alert(1)</script></html>".repeat(30)));
    const c = await pedir("t-admin-a", "POST", `/videos/${ticket.id}/confirmar`, { archivo: "marca.horizontal" });
    assert.equal(c.status, 400);
    assert.match(c.json.error?.message ?? "", /no es un video MP4/);
  });

  it("otro negocio no puede confirmar ni ver el video; un id que no es UUID es 404 sin tocar el almacén", async () => {
    const ticket = await subirVideo();
    const ajeno = await pedir("t-admin-b", "POST", `/videos/${ticket.id}/confirmar`, { archivo: "portada.horizontal" });
    assert.equal(ajeno.status, 404);
    assert.deepEqual((await pedir("t-admin-b", "GET", "/videos")).json.data.items, []);
    const antes = almacen.llamadas.length;
    assert.equal((await pedir("t-admin-a", "POST", "/videos/no-es-uuid/confirmar", { archivo: "portada.horizontal" })).status, 404);
    assert.equal((await pedir("t-admin-a", "POST", `/videos/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}/confirmar`, { archivo: "portada.horizontal" })).status, 404);
    assert.equal(almacen.llamadas.length, antes);
  });
});
