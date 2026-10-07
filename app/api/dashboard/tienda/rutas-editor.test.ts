/**
 * Administración de tienda — las rutas que alimentan al EDITOR: imágenes (subir y confirmar), productos para los selectores y contexto (categorías y variables).
 * De punta a punta con sesión, rol, módulo, el SQL real (Postgres embebido), Storage emulado y sharp real. El negocio sale SIEMPRE de la sesión.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { formatoPorFirma } from "@/lib/cms-comercial/imagen-servidor";
import { crearAlmacenMemoria, type AlmacenMemoria } from "@/lib/cms-comercial/testing/almacen-memoria";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { GET as contextoGET } from "./contexto/route";
import { GET as imagenesGET } from "./imagenes/route";
import { POST as confirmarPOST } from "./imagenes/[id]/confirmar/route";
import { POST as subidaPOST } from "./imagenes/upload-url/route";
import { GET as productosGET } from "./productos/route";

const TA = "aaaaaaaa-0000-4000-8000-00000000000a";
const TB = "bbbbbbbb-0000-4000-8000-00000000000b";
const TC = "cccccccc-0000-4000-8000-00000000000c"; // sin el módulo
const CAT_A = "c0000000-0000-4000-8000-0000000000a1";
const CAT_B = "c0000000-0000-4000-8000-0000000000b1";

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
  const producto = (referencia: string, nombre: string, tenant: string, over: Record<string, unknown> = {}) => ({
    id: `p-${tenant.slice(0, 2)}-${referencia}`,
    id_tenant: tenant,
    referencia,
    nombre,
    descripcion: "descripción interna",
    precio: 100000,
    precio_mayor: 70000,
    material: null,
    color: null,
    categoria: "Aretes",
    categoria_id: tenant === TA ? CAT_A : CAT_B,
    activo: true,
    controla_stock: true,
    stock: 10,
    foto_url: `https://cdn.test/${referencia}.webp`,
    created_at: `2026-09-0${referencia.endsWith("1") ? 1 : 2}T00:00:00Z`,
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  });
  db.table("dulabs_inventario_productos").push(
    producto("DL-000001", "Aretes dorados de corazón", TA),
    producto("DL-000002", "Cadena plateada fina", TA, { precio: 50000, precio_mayor: null, foto_url: null, controla_stock: false }),
    producto("DL-000003", "Aretes inactivos", TA, { activo: false }),
    producto("DL-000004", "Dije de 100% oro, edición (limitada)", TA),
    producto("DL-000001", "Producto del otro negocio", TB),
    producto("DL-000009", "Solo del negocio B", TB),
  );
  db.table("dulabs_catalogo_categorias").push({ id: CAT_A, id_tenant: TA, nombre: "Aretes" }, { id: "c0000000-0000-4000-8000-0000000000a2", id_tenant: TA, nombre: "Dijes" }, { id: CAT_B, id_tenant: TB, nombre: "Solo B" });
  db.table("dulabs_agente_runtime_config").push({ id_tenant: TA, habilitado: true, created_at: "2026-09-01T00:00:00Z", negocio: { nombre_negocio: "Tienda A", pedido: { minimo_mayorista: 750000 } } });
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
  json: { success: boolean; data?: any; error?: { code: string; message: string } };
}

async function pedir(token: string | undefined, metodo: "GET" | "POST", ruta: string, cuerpo?: unknown, extra: { crudo?: string } = {}): Promise<Respuesta> {
  const headers: Record<string, string> = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo !== undefined || extra.crudo !== undefined ? { "content-type": "application/json" } : {}) };
  const request = new NextRequest(`http://localhost/api/dashboard/tienda${ruta}`, { method: metodo, headers, body: extra.crudo ?? (cuerpo === undefined ? undefined : JSON.stringify(cuerpo)) });
  const [camino] = ruta.split("?");
  const partes = camino.split("/").filter(Boolean);
  let res: Response;
  if (partes[0] === "contexto") res = await contextoGET(request);
  else if (partes[0] === "productos") res = await productosGET(request);
  else if (partes[1] === "upload-url") res = await subidaPOST(request);
  else if (partes[2] === "confirmar") res = await confirmarPOST(request, { params: Promise.resolve({ id: partes[1] }) });
  else res = await imagenesGET(request);
  return { status: res.status, json: (await res.json()) as Respuesta["json"] };
}

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();

async function subirImagen(token = "t-admin-a", bytes?: Uint8Array) {
  const contenido = bytes ?? (await png(800, 400));
  const t = await pedir(token, "POST", "/imagenes/upload-url", { mimeType: "image/png", bytes: contenido.byteLength, nombreOriginal: "portada.png" });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const ticket = t.json.data.subida as { id: string; path: string };
  almacen.subirComoNavegador(ticket.path, contenido, "image/png");
  return ticket;
}

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

describe("permisos y módulo en las rutas del editor", () => {
  it("sin sesión o con sesión falsa: 401, y nada llega a la base ni al almacén", async () => {
    puente.llamadas.length = 0;
    for (const [metodo, ruta, cuerpo] of [
      ["GET", "/imagenes"],
      ["POST", "/imagenes/upload-url", { mimeType: "image/png", bytes: 100 }],
      ["POST", `/imagenes/${TA}/confirmar`],
      ["GET", "/productos"],
      ["GET", "/contexto"],
    ] as Array<["GET" | "POST", string, unknown?]>) {
      assert.equal((await pedir(undefined, metodo, ruta, cuerpo)).status, 401, ruta);
      assert.equal((await pedir("falso", metodo, ruta, cuerpo)).status, 401, ruta);
    }
    assert.deepEqual(puente.llamadas, []);
    assert.deepEqual(almacen.llamadas, []);
  });

  it("agente y lectura: consultan galería, productos y contexto; NO suben ni confirman (403 sin tocar el almacén)", async () => {
    for (const token of ["t-agente-a", "t-lectura-a"]) {
      for (const ruta of ["/imagenes", "/productos", "/contexto"]) assert.equal((await pedir(token, "GET", ruta)).status, 200, `${token} ${ruta}`);
      puente.llamadas.length = 0;
      const subida = await pedir(token, "POST", "/imagenes/upload-url", { mimeType: "image/png", bytes: 1000 });
      assert.equal(subida.status, 403);
      assert.equal(subida.json.error?.code, "FORBIDDEN");
      assert.equal((await pedir(token, "POST", `/imagenes/${TA}/confirmar`)).status, 403);
      assert.deepEqual(puente.llamadas, []);
      assert.deepEqual(almacen.llamadas, []);
    }
  });

  it("un negocio sin el módulo no tiene estas rutas (403 MODULE_DISABLED)", async () => {
    for (const [metodo, ruta, cuerpo] of [
      ["GET", "/imagenes"],
      ["POST", "/imagenes/upload-url", { mimeType: "image/png", bytes: 100 }],
      ["GET", "/productos"],
      ["GET", "/contexto"],
    ] as Array<["GET" | "POST", string, unknown?]>) {
      const r = await pedir("t-admin-c", metodo, ruta, cuerpo);
      assert.equal(r.status, 403, ruta);
      assert.equal(r.json.error?.code, "MODULE_DISABLED");
    }
    assert.deepEqual(almacen.llamadas, []);
  });
});

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

describe("imágenes por HTTP", () => {
  it("la entrada se valida antes de tocar nada: tipo, tamaño, claves de más y JSON", async () => {
    puente.llamadas.length = 0;
    const malos: Array<[unknown, RegExp]> = [
      [{ mimeType: "image/gif", bytes: 100 }, /JPG, PNG o WebP/],
      [{ mimeType: "image/png", bytes: 0 }, /vacía/],
      [{ mimeType: "image/png", bytes: 7 * 1024 * 1024 }, /6 MB/],
      [{ mimeType: "image/png" }, /tamaño/],
      [{ mimeType: "image/png", bytes: 100, path: "../../otro-negocio/robada.png" }, /no permitido/i],
      [{ mimeType: "image/png", bytes: 100, tenantId: TB }, /no permitido/i],
      [{ mimeType: "image/png", bytes: 100, nombreOriginal: "x".repeat(201) }, /demasiado largo/],
    ];
    for (const [cuerpo, mensaje] of malos) {
      const r = await pedir("t-admin-a", "POST", "/imagenes/upload-url", cuerpo);
      assert.equal(r.status, 400, JSON.stringify(cuerpo).slice(0, 80));
      assert.match(r.json.error?.message ?? "", mensaje);
    }
    assert.equal((await pedir("t-admin-a", "POST", "/imagenes/upload-url", undefined, { crudo: "{no" })).status, 400);
    assert.deepEqual(puente.llamadas, []);
    assert.deepEqual(almacen.llamadas, []);
  });

  it("el administrador recibe una subida firmada con la ruta bajo SU negocio; la imagen queda pendiente", async () => {
    const r = await pedir("t-admin-a", "POST", "/imagenes/upload-url", { mimeType: "image/png", bytes: 5000, nombreOriginal: "portada.png" });
    assert.equal(r.status, 201);
    const s = r.json.data.subida;
    assert.deepEqual(Object.keys(s).sort(), ["bucket", "id", "maxBytes", "path", "token"]);
    assert.equal(s.bucket, "inventario-productos");
    assert.equal(s.path, `${TA}/cms/${s.id}/subida`);
    assert.equal(s.maxBytes, 6 * 1024 * 1024);
    assert.ok(s.token);
    assert.equal((await pg.sql<{ estado: string }>("select estado from public.dulabs_cms_assets where id = $1", [s.id]))[0].estado, "pendiente");
    assert.deepEqual((await pedir("t-admin-a", "GET", "/imagenes")).json.data.items, []);
  });

  it("el flujo completo: pedir → subir → confirmar → galería → la imagen pública es un WebP", async () => {
    const ticket = await subirImagen();
    const c = await pedir("t-admin-a", "POST", `/imagenes/${ticket.id}/confirmar`);
    assert.equal(c.status, 200, JSON.stringify(c.json));
    const img = c.json.data.imagen;
    assert.deepEqual([img.id, img.ancho, img.alto], [ticket.id, 800, 400]);
    assert.equal(img.url, `http://supabase.memoria/storage/v1/object/public/inventario-productos/${TA}/cms/${ticket.id}/imagen.webp`);
    assert.deepEqual(Object.keys(img).sort(), ["alto", "ancho", "bytes", "createdAt", "id", "nombreOriginal", "url"]);

    const galeria = await pedir("t-lectura-a", "GET", "/imagenes");
    assert.deepEqual(galeria.json.data.items.map((i: { id: string }) => i.id), [ticket.id]);

    const publica = await fetch(img.url);
    assert.equal(publica.status, 200);
    assert.equal(publica.headers.get("content-type"), "image/webp");
    assert.equal(formatoPorFirma(new Uint8Array(await publica.arrayBuffer())), "webp");
    assert.equal(almacen.objetos.has(`${TA}/cms/${ticket.id}/subida`), false, "el archivo crudo se borra");
  });

  it("confirmar dos veces es idempotente", async () => {
    const ticket = await subirImagen();
    const una = await pedir("t-admin-a", "POST", `/imagenes/${ticket.id}/confirmar`);
    const dos = await pedir("t-admin-a", "POST", `/imagenes/${ticket.id}/confirmar`);
    assert.equal(dos.status, 200);
    assert.deepEqual(dos.json.data, una.json.data);
  });

  it("un archivo que no es una imagen: 400 con mensaje claro y nada publicado", async () => {
    const ticket = await subirImagen("t-admin-a", new TextEncoder().encode("<html><script>alert(1)</script></html>"));
    const c = await pedir("t-admin-a", "POST", `/imagenes/${ticket.id}/confirmar`);
    assert.equal(c.status, 400);
    assert.equal(c.json.error?.code, "VALIDATION_ERROR");
    assert.match(c.json.error?.message ?? "", /no es una imagen válida/);
    assert.deepEqual((await pedir("t-admin-a", "GET", "/imagenes")).json.data.items, []);
    assert.equal(almacen.objetos.has(`${TA}/cms/${ticket.id}/imagen.webp`), false);
  });

  it("otro negocio no puede confirmar ni ver la imagen; un id que no es UUID es 404 sin tocar el almacén", async () => {
    const ticket = await subirImagen();
    const ajeno = await pedir("t-admin-b", "POST", `/imagenes/${ticket.id}/confirmar`);
    assert.equal(ajeno.status, 404);
    assert.equal(almacen.objetos.has(ticket.path), true, "lo subido por A sigue intacto");
    await pedir("t-admin-a", "POST", `/imagenes/${ticket.id}/confirmar`);
    assert.deepEqual((await pedir("t-admin-b", "GET", "/imagenes")).json.data.items, []);
    almacen.llamadas.length = 0;
    for (const id of ["no-es-uuid", "123", "..%2F..%2Fetc"]) assert.equal((await pedir("t-admin-a", "POST", `/imagenes/${id}/confirmar`)).status, 404, id);
    assert.deepEqual(almacen.llamadas, []);
  });

  it("todo lo que queda en Storage está bajo el negocio de la sesión", async () => {
    const a = await subirImagen("t-admin-a");
    const b = await subirImagen("t-admin-b");
    await pedir("t-admin-a", "POST", `/imagenes/${a.id}/confirmar`);
    await pedir("t-admin-b", "POST", `/imagenes/${b.id}/confirmar`);
    const rutas = [...almacen.objetos.keys()];
    assert.deepEqual(rutas.filter((r) => r.startsWith(`${TA}/cms/`)), [`${TA}/cms/${a.id}/imagen.webp`]);
    assert.deepEqual(rutas.filter((r) => r.startsWith(`${TB}/cms/`)), [`${TB}/cms/${b.id}/imagen.webp`]);
    assert.equal(rutas.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

describe("GET /productos — para los selectores", () => {
  const nombres = (r: Respuesta) => r.json.data.items.map((p: { referencia: string }) => p.referencia);

  it("devuelve la vista del producto SIN ids internos", async () => {
    const r = await pedir("t-admin-a", "GET", "/productos?referencias=DL-000001");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.items, [
      { referencia: "DL-000001", nombre: "Aretes dorados de corazón", categoriaId: CAT_A, categoriaNombre: "Aretes", activo: true, agotado: false, precioDetal: 100000, precioMayor: 70000, miniatura: "https://cdn.test/DL-000001.webp" },
    ]);
    const texto = JSON.stringify(r.json);
    assert.equal(texto.includes("p-aa-"), false, "ningún id interno");
    assert.equal(texto.includes("id_tenant"), false);
    assert.equal(texto.includes("descripción interna"), false);
  });

  it("busca por nombre o referencia (sin distinguir mayúsculas) y solo trae productos ACTIVOS; sin texto, los más recientes", async () => {
    assert.deepEqual(nombres(await pedir("t-admin-a", "GET", "/productos?q=aretes")).sort(), ["DL-000001"]);
    assert.deepEqual(nombres(await pedir("t-admin-a", "GET", "/productos?q=CADENA")), ["DL-000002"]);
    assert.deepEqual(nombres(await pedir("t-admin-a", "GET", "/productos?q=dl-000004")), ["DL-000004"]);
    assert.deepEqual(nombres(await pedir("t-admin-a", "GET", "/productos?q=inactivos")), [], "los inactivos no se ofrecen");
    assert.deepEqual(nombres(await pedir("t-admin-a", "GET", "/productos")).sort(), ["DL-000001", "DL-000002", "DL-000004"]);
    assert.deepEqual(nombres(await pedir("t-admin-a", "GET", "/productos?q=nada-que-coincida")), []);
  });

  it("los símbolos de la búsqueda no rompen el filtro ni cuelan condiciones", async () => {
    const r = await pedir("t-admin-a", "GET", `/productos?q=${encodeURIComponent('100%, nombre.eq.x") or (id_tenant.neq.0')}`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.data.items, [], "el texto se tomó como texto, no como un filtro");
    // Los símbolos se quitan del texto buscado (misma regla del catálogo): la palabra sola sí encuentra el producto cuyo nombre los trae.
    assert.deepEqual(nombres(await pedir("t-admin-a", "GET", `/productos?q=${encodeURIComponent("(edición)")}`)), ["DL-000004"]);
    assert.deepEqual(nombres(await pedir("t-admin-a", "GET", `/productos?q=${encodeURIComponent("oro,")}`)), ["DL-000004"]);
    assert.equal((await pedir("t-admin-a", "GET", `/productos?q=${"x".repeat(81)}`)).status, 400);
  });

  it("las referencias: exactas, sin repetir, en cualquier mayúscula; las que no existen no vienen; mal escritas: 400", async () => {
    assert.deepEqual(nombres(await pedir("t-admin-a", "GET", "/productos?referencias=dl-000001, DL-000002,DL-000001,DL-000777")).sort(), ["DL-000001", "DL-000002"]);
    assert.deepEqual((await pedir("t-admin-a", "GET", "/productos?referencias=DL-000002")).json.data.items[0], {
      referencia: "DL-000002",
      nombre: "Cadena plateada fina",
      categoriaId: CAT_A,
      categoriaNombre: "Aretes",
      activo: true,
      agotado: false,
      precioDetal: 50000,
      precioMayor: null,
      miniatura: null,
    });
    for (const malo of ["x", "DL-1", "DL-000001;drop", "DL-000001,,algo"]) assert.equal((await pedir("t-admin-a", "GET", `/productos?referencias=${encodeURIComponent(malo)}`)).status, 400, malo);
    const muchas = Array.from({ length: 61 }, (_, i) => `DL-${String(i + 1).padStart(6, "0")}`).join(",");
    assert.equal((await pedir("t-admin-a", "GET", `/productos?referencias=${muchas}`)).status, 400);
  });

  it("un precio en cero o negativo es «a consultar» (null): ninguna oferta puede apoyarse en él", async () => {
    db.table("dulabs_inventario_productos").push({
      id: "p-aa-DL-000005",
      id_tenant: TA,
      referencia: "DL-000005",
      nombre: "Sin precio todavía",
      descripcion: null,
      precio: 0,
      precio_mayor: -5,
      material: null,
      color: null,
      categoria: "Aretes",
      categoria_id: CAT_A,
      activo: true,
      controla_stock: false,
      stock: 0,
      foto_url: null,
      created_at: "2026-09-05T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    });
    const [item] = (await pedir("t-admin-a", "GET", "/productos?referencias=DL-000005")).json.data.items;
    assert.equal(item.precioDetal, null);
    assert.equal(item.precioMayor, null);
  });

  it("un producto inactivo se informa como inactivo cuando se consulta por referencia (ya elegido), aunque no se ofrezca al buscar", async () => {
    const [inactivo] = (await pedir("t-admin-a", "GET", "/productos?referencias=DL-000003")).json.data.items;
    assert.equal(inactivo.referencia, "DL-000003");
    assert.equal(inactivo.activo, false);
    assert.deepEqual(nombres(await pedir("t-admin-a", "GET", "/productos?q=inactivos")), []);
  });

  it("cada negocio ve SOLO su catálogo (mismas referencias, productos distintos)", async () => {
    assert.equal((await pedir("t-admin-a", "GET", "/productos?referencias=DL-000001")).json.data.items[0].nombre, "Aretes dorados de corazón");
    assert.equal((await pedir("t-admin-b", "GET", "/productos?referencias=DL-000001")).json.data.items[0].nombre, "Producto del otro negocio");
    assert.deepEqual(nombres(await pedir("t-admin-a", "GET", "/productos?referencias=DL-000009")), []);
    assert.deepEqual(nombres(await pedir("t-admin-b", "GET", "/productos?q=aretes")), []);
    assert.deepEqual(nombres(await pedir("t-admin-b", "GET", "/productos")).sort(), ["DL-000001", "DL-000009"]);
    // el negocio de la consulta o del encabezado se ignora
    assert.deepEqual(nombres(await pedir("t-admin-b", "GET", `/productos?q=aretes&tenant=${TA}&id_tenant=${TA}`)), []);
  });
});

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

describe("GET /contexto — categorías y variables", () => {
  it("las categorías y las variables del negocio de la sesión, con su valor ya formateado", async () => {
    const r = await pedir("t-admin-a", "GET", "/contexto");
    assert.equal(r.status, 200);
    const d = r.json.data;
    assert.deepEqual(d.categorias.map((c: { nombre: string }) => c.nombre).sort(), ["Aretes", "Dijes"]);
    assert.deepEqual(Object.keys(d.categorias[0]).sort(), ["id", "nombre"]);
    assert.deepEqual(d.variables, [
      { id: "minimo_mayorista", etiqueta: "Mínimo de la compra inicial mayorista", valor: "$750.000" },
      { id: "direccion_tienda", etiqueta: "Dirección de la tienda", valor: null },
      { id: "nombre_negocio", etiqueta: "Nombre del negocio", valor: "Tienda A" },
    ]);
    assert.equal(d.minimoMayorista, 750000);
    assert.equal(d.zona, "America/Bogota");
    assert.ok(!Number.isNaN(Date.parse(d.ahora)));
  });

  it("un negocio sin configuración: ninguna variable tiene valor (nunca se inventa) y solo ve sus categorías", async () => {
    const r = await pedir("t-admin-b", "GET", "/contexto");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.variables.map((v: { valor: string | null }) => v.valor), [null, null, null]);
    assert.equal(r.json.data.minimoMayorista, null);
    assert.deepEqual(r.json.data.categorias.map((c: { nombre: string }) => c.nombre), ["Solo B"]);
  });

  it("si la configuración no se puede leer, no se inventa nada", async () => {
    db.missing("dulabs_agente_runtime_config");
    const original = console.error;
    console.error = () => {};
    try {
      const r = await pedir("t-admin-a", "GET", "/contexto");
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.data.variables.map((v: { valor: string | null }) => v.valor), [null, null, null]);
    } finally {
      console.error = original;
    }
  });
});
