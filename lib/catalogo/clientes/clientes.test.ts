/**
 * Bloque 33 — módulo Clientes (catálogo / joyería). Repositorio en memoria con la MISMA semántica que
 * la función SQL (que tiene su prueba en PostgreSQL real y en la matriz E2E). Datos ficticios.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import { CLIENTS_MODULE, decideCatalogAccess } from "@/lib/catalogo/auth";
import { createMemoryCustomerChannelStore } from "@/lib/agente/clasificacion";
import { MODULOS } from "@/lib/tenant-modulos";
import { celdaCsv, claveCliente, clientesCsv, esMayoristaNuevo, leerClave, leerConsulta, telefonoCsv, type ClienteDetalle, type ClienteFila } from "@/lib/catalogo/clientes/modelo";
import { createMemoryClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import { detalleCliente, exportarClientes, guardarNotaCliente, listarClientes } from "@/lib/catalogo/clientes/servicio";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const PN = "100000000000001";
const PN_B = "200000000000002";
const ANA = "573001110001"; // mayorista con compra
const LUIS = "573001110002"; // detal sin pedidos (nombre conocido)
const ZOE = "573001110003"; // solicitud de la tienda sin clasificar
const SALUDO = "573001110009"; // solo saludó
const MIEMBRO = 7;

let mem: ReturnType<typeof createMemoryClientesRepo>;
let canales: ReturnType<typeof createMemoryCustomerChannelStore>;

beforeEach(async () => {
  mem = createMemoryClientesRepo(() => Date.parse("2026-09-29T15:00:00Z"));
  canales = createMemoryCustomerChannelStore({ [PN]: A, [PN_B]: B });
  const canal = (tenantId: string, pn: string, waId: string, c: "retail" | "wholesale", actualizado: string) =>
    mem.canales.push({ tenantId, phoneNumberId: pn, waId, canal: c, origen: "cliente", creado: actualizado, actualizado });
  canal(A, PN, ANA, "wholesale", "2026-09-20T10:00:00Z");
  canal(A, PN, LUIS, "retail", "2026-09-25T10:00:00Z");
  canal(B, PN_B, ANA, "retail", "2026-09-26T10:00:00Z"); // mismo teléfono en OTRO negocio
  await canales.setInitial({ tenantId: A, phoneNumberId: PN, waId: ANA }, "retail", "cliente");
  await canales.change({ tenantId: A, phoneNumberId: PN, waId: ANA }, { channel: "wholesale", expected: "retail", memberId: MIEMBRO, reason: "Tiene tienda" });
  mem.pedidos.push(
    { tenantId: A, pedido: "DL-ORD-AAAAA1", phoneNumberId: PN, waId: ANA, estado: "confirmed", etapa: "en_preparacion", estadoPago: "recibido", canal: "wholesale", total: 800_000, nombre: "Ana Mayorista", ciudad: "Pasto", entrega: "domicilio", creado: "2026-09-21T10:00:00Z", confirmado: "2026-09-21T10:05:00Z" },
    { tenantId: A, pedido: "DL-ORD-AAAAA2", phoneNumberId: PN, waId: ANA, estado: "draft", canal: "wholesale", total: 5_000, creado: "2026-09-22T10:00:00Z" },
    { tenantId: A, pedido: "DL-ORD-AAAAA3", phoneNumberId: PN, waId: ZOE, estado: "pending_confirmation", canal: "retail", total: 27_000, creado: "2026-09-23T10:00:00Z" },
    { tenantId: B, pedido: "DL-ORD-BBBBB1", phoneNumberId: PN_B, waId: ANA, estado: "completed", canal: "retail", total: 99_000, nombre: "Ana en B", creado: "2026-09-24T10:00:00Z", confirmado: "2026-09-24T10:00:00Z" },
  );
  mem.conocidos.push({ tenantId: A, phoneNumberId: PN, waId: LUIS, nombre: "Luis Detal" });
  mem.mensajes.push({ phoneNumberId: PN, waId: SALUDO, at: "2026-09-28T10:00:00Z" }, { phoneNumberId: PN, waId: LUIS, at: "2026-09-28T12:00:00Z" });
});

type Listado = { data: { filas: ClienteFila[]; total: number; pagina: number; paginas: number } };
const listar = async (qs: string, tenant = A) => ((await (await listarClientes(mem.repo, tenant, new URLSearchParams(qs))).json()) as Listado).data;
const fila = async (wa: string, tenant = A) => (await listar("", tenant)).filas.find((f) => f.waId === wa);

describe("B33 · listado de clientes", () => {
  it("un cliente por contacto: los que eligieron modalidad o hicieron pedidos; quien solo saludó NO aparece", async () => {
    const r = await listar("");
    assert.equal(r.total, 3);
    assert.deepEqual(r.filas.map((f) => f.waId).sort(), [ANA, LUIS, ZOE].sort());
    assert.ok(!r.filas.some((f) => f.waId === SALUDO));
  });

  it("resumen: nombre del último pedido, compras reales (confirmado/completado), total, ciudad y último pedido (sin borradores)", async () => {
    const ana = (await fila(ANA))!;
    assert.deepEqual(
      [ana.nombre, ana.canal, ana.pedidos, ana.compras, ana.totalComprado, ana.ciudad, ana.ultimoPedido, ana.ultimaEtapa],
      ["Ana Mayorista", "wholesale", 1, 1, 800_000, "Pasto", "DL-ORD-AAAAA1", "en_preparacion"],
    );
    const luis = (await fila(LUIS))!;
    assert.deepEqual([luis.nombre, luis.compras, luis.totalComprado, luis.ultimoPedido], ["Luis Detal", 0, 0, null], "nombre de los contactos conocidos");
    const zoe = (await fila(ZOE))!;
    assert.deepEqual([zoe.canal, zoe.origen, zoe.pedidos], ["retail", null, 0], "modalidad del pedido de la tienda; nunca confirmado");
  });

  it("filtros: detal, mayorista, ya compraron, aún no compran", async () => {
    assert.equal((await listar("filtro=mayorista")).total, 1);
    assert.equal((await listar("filtro=detal")).total, 2);
    assert.deepEqual((await listar("filtro=compraron")).filas.map((f) => f.waId), [ANA]);
    assert.equal((await listar("filtro=sin_compras")).total, 2);
    assert.equal((await listar("filtro=inventado")).total, 3, "un filtro inválido cae a 'todos'");
  });

  it("búsqueda por nombre (sin mayúsculas) y por teléfono (con espacios o '+')", async () => {
    assert.deepEqual((await listar("q=ana%20MAY")).filas.map((f) => f.waId), [ANA]);
    assert.deepEqual((await listar(`q=${encodeURIComponent("+57 300 111 0002")}`)).filas.map((f) => f.waId), [LUIS]);
    assert.equal((await listar("q=zzz")).total, 0);
  });

  it("aislamiento: el mismo teléfono en otro negocio es otro cliente; nunca se mezclan datos", async () => {
    const b = await listar("", B);
    assert.equal(b.total, 1);
    assert.deepEqual([b.filas[0].nombre, b.filas[0].totalComprado], ["Ana en B", 99_000]);
    assert.equal((await fila(ANA))!.totalComprado, 800_000);
  });

  it("paginación: 25 por página, total y páginas", async () => {
    for (let i = 0; i < 30; i++) mem.canales.push({ tenantId: A, phoneNumberId: PN, waId: `57300200${String(i).padStart(4, "0")}`, canal: "retail", origen: "cliente", creado: "2026-09-01T00:00:00Z", actualizado: "2026-09-01T00:00:00Z" });
    const p1 = await listar("");
    assert.deepEqual([p1.total, p1.pagina, p1.paginas, p1.filas.length], [33, 1, 2, 25]);
    const p2 = await listar("pagina=2");
    assert.equal(p2.filas.length, 8);
    assert.equal(leerConsulta(new URLSearchParams("pagina=-3")).pagina, 1);
  });

  it("mayorista nuevo = mayorista sin compras (la primera compra debe llegar al mínimo)", () => {
    assert.equal(esMayoristaNuevo({ canal: "wholesale", compras: 0 }), true);
    assert.equal(esMayoristaNuevo({ canal: "wholesale", compras: 1 }), false);
    assert.equal(esMayoristaNuevo({ canal: "retail", compras: 0 }), false);
  });
});

describe("B33 · ficha del cliente", () => {
  it("datos, pedidos (sin borradores), modalidad con su historial (quién y por qué) y nota", async () => {
    await mem.repo.guardarNota(A, PN, ANA, "Paga por Nequi", 0, MIEMBRO);
    const r = await detalleCliente(mem.repo, canales, A, claveCliente(PN, ANA));
    assert.equal(r.status, 200);
    const d = ((await r.json()) as { data: ClienteDetalle }).data;
    assert.equal(d.cliente.nombre, "Ana Mayorista");
    assert.deepEqual(d.pedidos.map((p) => p.pedido), ["DL-ORD-AAAAA1"]);
    assert.equal(d.modalidad?.canal, "wholesale");
    assert.deepEqual(d.modalidad?.historial.map((h) => [h.from, h.to, h.origin, h.reason]), [["retail", "wholesale", "asesora", "Tiene tienda"], [null, "retail", "cliente", null]]);
    assert.equal(d.nota?.texto, "Paga por Nequi");
  });

  it("un contacto que no es cliente de ESTE negocio (u otra clave) => 404", async () => {
    for (const clave of [claveCliente(PN, SALUDO), claveCliente(PN_B, ANA), "basura", `${PN}_12`]) {
      assert.equal((await detalleCliente(mem.repo, canales, A, clave)).status, 404, clave);
    }
  });
});

describe("B33 · nota interna (compare-and-set)", () => {
  const guardar = (nota: unknown, version: unknown, wa = ANA, tenant = A) => guardarNotaCliente(mem.repo, tenant, claveCliente(PN, wa), { nota, version }, MIEMBRO);

  it("crear (versión 0) → editar con la versión vista → versión 2; se recorta el texto", async () => {
    const r1 = await guardar("  Cliente VIP  ", 0);
    assert.equal(r1.status, 200);
    assert.deepEqual(((await r1.json()) as { data: { nota: { texto: string; version: number; actualizadoPor: number } } }).data.nota, { texto: "Cliente VIP", version: 1, actualizadoPor: MIEMBRO, actualizadoAt: "2026-09-29T15:00:00.000Z" });
    const r2 = await guardar("Cliente VIP, paga por Nequi", 1);
    assert.equal(r2.status, 200);
    assert.equal((await mem.repo.nota(A, PN, ANA))?.version, 2);
    assert.equal((await fila(ANA))!.tieneNota, true);
  });

  it("dos personas a la vez: la segunda (versión vieja) recibe 409 con la nota actual; nada se pisa", async () => {
    await guardar("De Laura", 0);
    const r = await guardar("De Pedro", 0);
    assert.equal(r.status, 409);
    const body = (await r.json()) as { error: { code: string; diagnostics: { nota: { texto: string } } } };
    assert.equal(body.error.code, "CONFLICT");
    assert.equal(body.error.diagnostics.nota.texto, "De Laura");
    assert.equal((await mem.repo.nota(A, PN, ANA))?.texto, "De Laura");
  });

  it("validación: > 1000 caracteres, cuerpo inválido, contacto que no es cliente => sin escribir", async () => {
    assert.equal((await guardar("x".repeat(1001), 0)).status, 400);
    assert.equal((await guarNotaSinVersion()).status, 400);
    assert.equal((await guardar("hola", 0, SALUDO)).status, 404);
    assert.equal((await guardar("hola", 0, ANA, B)).status, 404, "otro negocio: su cliente es otro (PN_B)");
    assert.equal(await mem.repo.nota(A, PN, ANA), null);
  });
  const guarNotaSinVersion = () => guardarNotaCliente(mem.repo, A, claveCliente(PN, ANA), { nota: "x" }, MIEMBRO);
});

describe("B33 · exportar a Excel (CSV)", () => {
  it("la lista FILTRADA con la nota; separador ';', BOM y teléfono como texto", async () => {
    await mem.repo.guardarNota(A, PN, ANA, "VIP; paga por Nequi", 0, MIEMBRO);
    const r = await exportarClientes(mem.repo, A, new URLSearchParams("filtro=mayorista"), new Date("2026-09-29T12:00:00Z"));
    assert.equal(r.headers.get("Content-Type"), "text/csv; charset=utf-8");
    assert.equal(r.headers.get("Content-Disposition"), 'attachment; filename="clientes-2026-09-29.csv"');
    const bytes = new Uint8Array(await r.clone().arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "BOM: Excel lee bien las tildes");
    const csv = await r.text(); // text() quita el BOM
    assert.ok(csv.startsWith("Nombre;Teléfono;Modalidad"));
    const lineas = csv.trim().split("\r\n");
    assert.equal(lineas.length, 2, "solo el mayorista");
    assert.equal(lineas[1], 'Ana Mayorista;57 300 111 0001;Mayorista;1;1;800000;DL-ORD-AAAAA1;confirmed;Pasto;2026-09-20;2026-09-22;"VIP; paga por Nequi"');
  });

  it("nunca una fórmula de Excel en una celda (=, +, -, @)", () => {
    for (const peligrosa of ["=HYPERLINK(\"x\")", "+1+1", "-2", "@SUM(A1)"]) assert.ok(celdaCsv(peligrosa).replace(/^"/, "").startsWith("'"), peligrosa);
    assert.equal(celdaCsv('dice "hola"'), '"dice ""hola"""');
    assert.equal(celdaCsv(800000), "800000");
    assert.equal(telefonoCsv("573148127388"), "57 314 812 7388");
    const csv = clientesCsv([{ ...({} as ClienteFila), phoneNumberId: PN, waId: ANA, nombre: "=cmd", canal: null, pedidos: 0, compras: 0, totalComprado: 0 } as ClienteFila]);
    assert.ok(csv.includes("'=cmd"));
  });
});

describe("B33 · permisos y módulo", () => {
  it("solo admin y agente (datos personales); 'lectura' no; sin el módulo, mensaje propio", () => {
    assert.deepEqual(decideCatalogAccess({ role: "admin", mode: "orders", moduleEnabled: true, module: CLIENTS_MODULE }), { allowed: true });
    assert.deepEqual(decideCatalogAccess({ role: "agente", mode: "orders", moduleEnabled: true, module: CLIENTS_MODULE }), { allowed: true });
    assert.equal(decideCatalogAccess({ role: "lectura", mode: "orders", moduleEnabled: true, module: CLIENTS_MODULE }).allowed, false);
    const off = decideCatalogAccess({ role: "admin", mode: "orders", moduleEnabled: false, module: CLIENTS_MODULE });
    assert.deepEqual(off, { allowed: false, status: 403, code: "MODULE_DISABLED", message: "El módulo Clientes no está habilitado para tu cuenta." });
    assert.ok((MODULOS as readonly string[]).includes("clientes_joyeria"));
  });

  it("todas las rutas exigen el módulo Clientes y el modo 'orders' (admin/agente)", () => {
    for (const f of ["app/api/dashboard/clientes/route.ts", "app/api/dashboard/clientes/[cliente]/route.ts", "app/api/dashboard/clientes/[cliente]/nota/route.ts", "app/api/dashboard/clientes/exportar/route.ts"]) {
      const s = readFileSync(f, "utf8");
      // CADA handler de la ruta (GET, POST, PATCH…), no solo uno.
      const handlers = (s.match(/withCatalog\(/g) ?? []).length;
      assert.ok(handlers >= 1, f);
      // Bloque 35: eliminar (DELETE) es solo de administradores ("write"); lo demás, admin y agente ("orders").
      const eliminar = (s.match(/export async function DELETE/g) ?? []).length;
      assert.equal((s.match(/withCatalog\(\s*request,\s*"orders"/g) ?? []).length, handlers - eliminar, `${f}: modo 'orders' en cada handler`);
      assert.equal((s.match(/withCatalog\(\s*request,\s*"write"/g) ?? []).length, eliminar, `${f}: 'write' solo para eliminar`);
      assert.equal((s.match(/module: CLIENTS_MODULE/g) ?? []).length, handlers, `${f}: módulo Clientes en cada handler`);
      assert.ok(!/searchParams\.get\("tenant|body\.tenant/.test(s), `${f}: el negocio sale de la sesión`);
    }
  });

  it("claves de URL: <número>_<teléfono>; nada más", () => {
    assert.deepEqual(leerClave(claveCliente(PN, ANA)), { phoneNumberId: PN, waId: ANA });
    for (const mala of ["", "x", `${PN}_abc`, `${PN}_${ANA}_1`, `../${PN}_${ANA}`]) assert.equal(leerClave(mala), null, mala);
  });
});
