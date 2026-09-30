/**
 * Bloque 34 — registrar, editar e importar clientes (módulo Clientes de la joyería). Repositorio en
 * memoria con la MISMA semántica que la función SQL (que tiene su prueba en PostgreSQL real y en la
 * matriz E2E) y el almacén de modalidad en memoria (la misma regla compare-and-set de la RPC). Datos
 * ficticios.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import ExcelJS from "exceljs";
import { createMemoryCustomerChannelStore, type CustomerChannelStore } from "@/lib/agente/clasificacion";
import {
  PLANTILLA_CLIENTES_CSV,
  analizarImportacion,
  claveCliente,
  esMayoristaNuevo,
  leerModalidad,
  leerSiNo,
  normalizarCelular,
  normalizarNombre,
  type ClienteFila,
  type FilaImportacion,
} from "@/lib/catalogo/clientes/modelo";
import { createMemoryClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import { aplicarImportacion, editarCliente, listarClientes, previsualizarImportacion, registrarCliente } from "@/lib/catalogo/clientes/servicio";
import { leerTablaClientes } from "@/lib/catalogo/clientes/archivo";
import { decodeCsv, parseCsv } from "@/lib/catalogo/import/csv";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const PN = "100000000000001";
const PN_2 = "100000000000003";
const PN_B = "200000000000002";
const MIEMBRO = 7;

let mem: ReturnType<typeof createMemoryClientesRepo>;
let store: ReturnType<typeof createMemoryCustomerChannelStore>;
/** El almacén de modalidad, reflejado en las filas del listado (en la BD es la MISMA tabla). */
let canales: CustomerChannelStore;

beforeEach(() => {
  mem = createMemoryClientesRepo(() => Date.parse("2026-09-29T15:00:00Z"));
  store = createMemoryCustomerChannelStore({ [PN]: A, [PN_2]: A, [PN_B]: B });
  mem.numeros[A] = [PN];
  mem.numeros[B] = [PN_B];
  const reflejar = async (key: { tenantId: string; phoneNumberId: string; waId: string }) => {
    const c = await store.get(key);
    const i = mem.canales.findIndex((x) => x.tenantId === key.tenantId && x.phoneNumberId === key.phoneNumberId && x.waId === key.waId);
    if (!c) return;
    const fila = { ...key, canal: c.channel, origen: c.origin, creado: i >= 0 ? mem.canales[i].creado : c.updatedAt, actualizado: c.updatedAt };
    if (i >= 0) mem.canales[i] = fila;
    else mem.canales.push(fila);
  };
  canales = {
    ...store,
    get: (k) => store.get(k),
    getMany: (i) => store.getMany(i),
    history: (k, l) => store.history(k, l),
    async setInitial(k, c, o) {
      const w = await store.setInitial(k, c, o);
      await reflejar(k);
      return w;
    },
    async change(k, input) {
      const w = await store.change(k, input);
      await reflejar(k);
      return w;
    },
  };
});

type Json<T> = { success: boolean; data: T; error?: { code: string; message: string; diagnostics?: unknown } };
const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as Json<T>;
const listar = async (qs = "", tenant = A) => (await json<{ filas: ClienteFila[]; total: number }>(listarClientes(mem.repo, tenant, new URLSearchParams(qs)))).data;
const fila = async (wa: string, tenant = A) => (await listar("", tenant)).filas.find((f) => f.waId === wa);
const registrar = (body: unknown, tenant = A) => registrarCliente(mem.repo, canales, tenant, body, MIEMBRO);
const CAMILA = { nombre: "  Camila   Pérez ", telefono: "300 111 2233", modalidad: "mayorista", yaCompro: true };

describe("B34 · normalización (formulario y Excel)", () => {
  it("celular: Colombia por defecto (10 dígitos que empiezan por 3), con o sin +57 / 0057; otro país solo con '+'", () => {
    for (const t of ["300 111 2233", "3001112233", "+57 300 111 2233", "573001112233", "(+57) 300-111-2233", "0057 300 111 2233"]) assert.equal(normalizarCelular(t), "573001112233", t);
    assert.equal(normalizarCelular("+1 305 555 1234"), "13055551234");
    for (const t of ["", "12345", "1305 555 1234", "601 555 1234", "57 601 555 1234", "300 111 223", "abc"]) assert.equal(normalizarCelular(t), null, t);
  });

  it("nombre: 2–60 caracteres con letras; espacios recortados; nada de etiquetas", () => {
    assert.equal(normalizarNombre("  Camila   Pérez "), "Camila Pérez");
    for (const n of ["", "A", "123", "x".repeat(61), "<b>Ana</b>", "{nombre}"]) assert.equal(normalizarNombre(n), null, n);
  });

  it("modalidad y 'ya es cliente' en palabras de la gente", () => {
    for (const m of ["detal", "Al detal", "MINORISTA", "por menor"]) assert.equal(leerModalidad(m), "detal", m);
    for (const m of ["mayorista", "Al por mayor", "Mayor", "por mayor"]) assert.equal(leerModalidad(m), "mayorista", m);
    assert.equal(leerModalidad("vip"), null);
    for (const s of ["sí", "SI", "x", "1"]) assert.equal(leerSiNo(s), true, s);
    for (const s of ["", "no", "No", "0"]) assert.equal(leerSiNo(s), false, s);
    assert.equal(leerSiNo("tal vez"), null);
  });
});

describe("B34 · registrar cliente", () => {
  it("queda como cliente: nombre (el que usa el asistente), modalidad fijada por el equipo, 'ya es cliente' y 'registrado'", async () => {
    const r = await registrar(CAMILA);
    assert.equal(r.status, 201);
    const clave = (await json<{ clave: string }>(r)).data.clave;
    assert.equal(clave, claveCliente(PN, "573001112233"));
    // El asistente lo lee de aquí (dulabs_clientes_conocidos): mismo nombre.
    assert.deepEqual(mem.conocidos.at(-1), { tenantId: A, phoneNumberId: PN, waId: "573001112233", nombre: "Camila Pérez" });
    // Modalidad por la MISMA vía que el cambio de una asesora (origen "asesora", con quién y por qué).
    const c = await store.get({ tenantId: A, phoneNumberId: PN, waId: "573001112233" });
    assert.deepEqual([c?.channel, c?.origin, c?.updatedBy], ["wholesale", "asesora", MIEMBRO]);
    const h = await store.history({ tenantId: A, phoneNumberId: PN, waId: "573001112233" });
    assert.equal(h[0].reason, "Registrado por el equipo");
    const f = (await fila("573001112233"))!;
    assert.deepEqual([f.nombre, f.canal, f.yaCompro, f.registrado, f.compras], ["Camila Pérez", "wholesale", true, true, 0]);
    assert.equal(esMayoristaNuevo(f), false, "ya es cliente: no se le exige la compra inicial");
    assert.equal(await mem.repo.yaCompro(A, PN, "573001112233"), true);
  });

  it("sin 'ya es cliente': mayorista nuevo (su primera compra debe llegar al mínimo)", async () => {
    await registrar({ ...CAMILA, yaCompro: undefined });
    const f = (await fila("573001112233"))!;
    assert.deepEqual([f.yaCompro, f.registrado], [false, true]);
    assert.equal(esMayoristaNuevo(f), true);
    assert.equal(await mem.repo.yaCompro(A, PN, "573001112233"), false);
  });

  it("el mismo celular escrito de otra forma => 409 con la clave del cliente (para abrirlo); nada se pisa", async () => {
    await registrar(CAMILA);
    const r = await registrar({ nombre: "Otra", telefono: "+57 300-111-2233", modalidad: "detal" });
    assert.equal(r.status, 409);
    const b = await json<unknown>(r);
    assert.equal(b.error?.code, "ALREADY_EXISTS");
    assert.deepEqual(b.error?.diagnostics, { clave: claveCliente(PN, "573001112233") });
    assert.equal((await fila("573001112233"))!.nombre, "Camila Pérez");
    assert.equal((await fila("573001112233"))!.canal, "wholesale");
  });

  it("un contacto que ya escribió y eligió su modalidad también es cliente => 409 (se edita desde su ficha)", async () => {
    await store.setInitial({ tenantId: A, phoneNumberId: PN, waId: "573001112299" }, "retail", "cliente");
    mem.canales.push({ tenantId: A, phoneNumberId: PN, waId: "573001112299", canal: "retail", origen: "cliente", creado: "2026-09-20T10:00:00Z", actualizado: "2026-09-20T10:00:00Z" });
    assert.equal((await registrar({ nombre: "Rosa", telefono: "3001112299", modalidad: "mayorista" })).status, 409);
    assert.equal((await store.get({ tenantId: A, phoneNumberId: PN, waId: "573001112299" }))?.channel, "retail");
  });

  it("si el cliente elige su modalidad en el chat justo mientras se registra => 409 y la del cliente queda (compare-and-set)", async () => {
    const carrera: CustomerChannelStore = {
      ...canales,
      async change(k, input) {
        await store.setInitial(k, "retail", "cliente"); // el cliente tocó "detal" un instante antes
        return store.change(k, input);
      },
    };
    const r = await registrarCliente(mem.repo, carrera, A, CAMILA, MIEMBRO);
    assert.equal(r.status, 409);
    assert.equal((await json<unknown>(r)).error?.code, "CONFLICT");
    assert.equal((await store.get({ tenantId: A, phoneNumberId: PN, waId: "573001112233" }))?.channel, "retail");
    assert.equal(mem.conocidos.length, 0, "ni nombre ni ficha a medias");
    assert.equal(mem.fichas.size, 0);
  });

  it("validación: nombre, celular, modalidad y campos desconocidos => 400 sin escribir nada", async () => {
    for (const body of [
      { ...CAMILA, nombre: "A" },
      { ...CAMILA, telefono: "12345" },
      { ...CAMILA, modalidad: "vip" },
      { ...CAMILA, tenant: B },
      { ...CAMILA, yaCompro: "si" },
      null,
    ]) {
      const r = await registrar(body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal((await listar()).total, 0);
    assert.equal(mem.conocidos.length, 0);
  });

  it("número del negocio: uno solo => ese; varios => hay que elegir (400 con la lista); uno ajeno => 400; ninguno => 409", async () => {
    mem.numeros[A] = [PN, PN_2];
    const r = await registrar(CAMILA);
    assert.equal(r.status, 400);
    assert.deepEqual((await json<unknown>(r)).error?.diagnostics, { numeros: [PN, PN_2] });
    assert.equal((await registrar({ ...CAMILA, numero: PN_B })).status, 400, "el número de OTRO negocio nunca");
    assert.equal((await registrar({ ...CAMILA, numero: PN_2 })).status, 201);
    assert.equal((await fila("573001112233"))!.phoneNumberId, PN_2);
    mem.numeros[A] = [];
    assert.equal((await registrar({ ...CAMILA, telefono: "3001119999" })).status, 409);
  });

  it("aislamiento: el mismo celular en otro negocio es otro cliente", async () => {
    await registrar(CAMILA);
    assert.equal((await registrar({ ...CAMILA, nombre: "Camila en B", modalidad: "detal" }, B)).status, 201);
    assert.equal((await fila("573001112233", B))!.canal, "retail");
    assert.equal((await fila("573001112233", A))!.canal, "wholesale");
  });
});

describe("B34 · editar cliente", () => {
  const clave = claveCliente(PN, "573001112233");
  const editar = (body: unknown) => editarCliente(mem.repo, canales, A, clave, body, MIEMBRO);

  beforeEach(async () => {
    await registrar({ nombre: "Camila Pérez", telefono: "3001112233", modalidad: "detal" });
  });

  it("nombre y 'ya es cliente' sin tocar la modalidad", async () => {
    assert.equal((await editar({ nombre: "Camila Andrea", yaCompro: true })).status, 200);
    const f = (await fila("573001112233"))!;
    assert.deepEqual([f.nombre, f.yaCompro, f.canal, f.registrado], ["Camila Andrea", true, "retail", true]);
    assert.equal((await store.history({ tenantId: A, phoneNumberId: PN, waId: "573001112233" })).length, 1, "la modalidad no se tocó");
  });

  it("cambiar la modalidad exige el motivo y queda en el historial (quién y por qué)", async () => {
    assert.equal((await editar({ modalidad: "mayorista", esperado: "retail" })).status, 400);
    assert.equal((await editar({ modalidad: "mayorista", esperado: "retail", motivo: "x" })).status, 400);
    assert.equal((await fila("573001112233"))!.canal, "retail");
    assert.equal((await editar({ modalidad: "mayorista", esperado: "retail", motivo: "Abrió su tienda" })).status, 200);
    const h = await store.history({ tenantId: A, phoneNumberId: PN, waId: "573001112233" });
    assert.deepEqual([h[0].to, h[0].reason, h[0].memberId], ["wholesale", "Abrió su tienda", MIEMBRO]);
  });

  it("dos personas a la vez: la que vio una modalidad vieja recibe 409; nada se pisa", async () => {
    assert.equal((await editar({ modalidad: "mayorista", esperado: "retail", motivo: "Tiene tienda" })).status, 200);
    const r = await editar({ modalidad: "detal", esperado: "retail", motivo: "Compra para ella" });
    // Otra persona la dejó en mayorista: "detal" ≠ guardada, pero esperaba "retail" => conflicto.
    assert.equal(r.status, 409);
    assert.equal((await fila("573001112233"))!.canal, "wholesale");
  });

  it("fijar la modalidad de un cliente que aún no tenía no pide motivo", async () => {
    mem.pedidos.push({ tenantId: A, pedido: "DL-ORD-ZZZZZ1", phoneNumberId: PN, waId: "573001118888", estado: "pending_confirmation", canal: "retail", total: 27_000, creado: "2026-09-23T10:00:00Z" });
    const r = await editarCliente(mem.repo, canales, A, claveCliente(PN, "573001118888"), { modalidad: "detal", esperado: null }, MIEMBRO);
    assert.equal(r.status, 200);
    const c = await store.get({ tenantId: A, phoneNumberId: PN, waId: "573001118888" });
    assert.deepEqual([c?.channel, c?.origin], ["retail", "asesora"], "guardada aunque el listado ya la deducía del pedido");
  });

  it("un contacto que no es cliente de ESTE negocio => 404; nombre inválido => 400", async () => {
    assert.equal((await editarCliente(mem.repo, canales, B, clave, { nombre: "Otra" }, MIEMBRO)).status, 404);
    assert.equal((await editarCliente(mem.repo, canales, A, "basura", { nombre: "Otra" }, MIEMBRO)).status, 404);
    assert.equal((await editar({ nombre: "A" })).status, 400);
    assert.equal((await editar({ otro: 1 })).status, 400);
  });
});

describe("B34 · importar desde Excel / CSV", () => {
  const tabla = (s: string) => parseCsv(decodeCsv(new TextEncoder().encode(s)));

  it("la plantilla se lee tal cual: 2 clientes válidos (Excel en español: ';' y BOM)", async () => {
    assert.ok(PLANTILLA_CLIENTES_CSV.startsWith("﻿"));
    const r = analizarImportacion(tabla(PLANTILLA_CLIENTES_CSV), new Set());
    assert.equal(r.error, null);
    assert.deepEqual(
      r.filas.map((f) => [f.nombre, f.telefono, f.modalidad, f.yaCompro, f.accion]),
      [
        ["Camila Pérez", "573001112233", "mayorista", true, "nuevo"],
        ["Luis Gómez", "573104445566", "detal", false, "nuevo"],
      ],
    );
  });

  it("vista previa: nuevo / se actualiza / errores por fila (con el motivo); repetidos una sola vez; filas vacías ignoradas", () => {
    const r = analizarImportacion(
      [
        ["Nombre completo", "WhatsApp", "Tipo de cliente", "Cliente antiguo"],
        ["Ana", "3001110001", "mayor", "x"],
        ["Beto", "300 111 0002", "detal", ""],
        ["", "", "", ""],
        ["Carla", "12345", "detal", "no"],
        ["D", "3001110004", "detal", "no"],
        ["Eva", "3001110005", "vip", "no"],
        ["Fede", "3001110006", "detal", "quizás"],
        ["Ana otra vez", "+57 300 111 0001", "detal", "no"],
      ],
      new Set(["573001110002"]),
    );
    assert.equal(r.error, null);
    assert.deepEqual(
      r.filas.map((f) => [f.fila, f.accion]),
      [
        [2, "nuevo"],
        [3, "actualizar"],
        [5, "error"],
        [6, "error"],
        [7, "error"],
        [8, "error"],
        [9, "error"],
      ],
    );
    assert.match(r.filas[2].motivo!, /Celular inválido/);
    assert.match(r.filas[3].motivo!, /nombre/);
    assert.match(r.filas[4].motivo!, /Modalidad inválida/);
    assert.match(r.filas[5].motivo!, /Ya es cliente/);
    assert.match(r.filas[6].motivo!, /repetido/);
  });

  it("sin las columnas obligatorias, vacío o más de 500 clientes => error del archivo (nada se analiza)", () => {
    assert.match(analizarImportacion([["Nombre", "Ciudad"]], new Set()).error!, /Nombre, Celular y Modalidad/);
    assert.match(analizarImportacion([], new Set()).error!, /vacío/);
    const grande = [["Nombre", "Celular", "Modalidad"], ...Array.from({ length: 501 }, (_, i) => [`Cliente ${i}`, `300${String(i).padStart(7, "0")}`, "detal"])];
    assert.match(analizarImportacion(grande, new Set()).error!, /máximo por archivo es 500/);
  });

  it("lee .xlsx (hoja 'Clientes'; celular numérico) y .csv; otro formato => null", async () => {
    const libro = new ExcelJS.Workbook();
    libro.addWorksheet("Instrucciones").addRow(["Lee esto"]);
    const hoja = libro.addWorksheet("Clientes");
    hoja.addRow(["Nombre", "Celular", "Modalidad", "Ya es cliente"]);
    hoja.addRow(["Camila Pérez", 3001112233, "mayorista", "sí"]);
    const xlsx = Buffer.from(await libro.xlsx.writeBuffer());
    const t = await leerTablaClientes("clientes.xlsx", xlsx);
    assert.deepEqual(t, [
      ["Nombre", "Celular", "Modalidad", "Ya es cliente"],
      ["Camila Pérez", "3001112233", "mayorista", "sí"],
    ]);
    assert.equal((await leerTablaClientes("clientes.csv", Buffer.from(PLANTILLA_CLIENTES_CSV)))!.length, 3);
    assert.equal(await leerTablaClientes("clientes.pdf", Buffer.from("x")), null);
  });

  it("vista previa por el servicio: marca 'se actualiza' a quien ya es cliente de ESTE número; no escribe nada", async () => {
    await registrar({ nombre: "Luis", telefono: "3104445566", modalidad: "detal" });
    const r = await json<{ filas: FilaImportacion[]; resumen: { nuevos: number; actualizar: number; errores: number } }>(previsualizarImportacion(mem.repo, A, tabla(PLANTILLA_CLIENTES_CSV)));
    assert.deepEqual(r.data.resumen, { nuevos: 1, actualizar: 1, errores: 0 });
    assert.equal((await listar()).total, 1, "la vista previa no crea a nadie");
    const mala = await previsualizarImportacion(mem.repo, A, [["Ciudad"]]);
    assert.equal(mala.status, 400);
  });

  it("aplicar: crea los nuevos, actualiza los existentes y valida OTRA VEZ cada fila en el servidor", async () => {
    await registrar({ nombre: "Luis", telefono: "3104445566", modalidad: "detal" });
    const r = await json<{ creados: number; actualizados: number; errores: Array<{ telefono: string; motivo: string }> }>(
      aplicarImportacion(
        mem.repo,
        canales,
        A,
        {
          filas: [
            { nombre: "Camila Pérez", telefono: "+573001112233", modalidad: "mayorista", yaCompro: true },
            { nombre: "Luis Gómez", telefono: "+573104445566", modalidad: "mayorista", yaCompro: false },
            { nombre: "Mala", telefono: "123", modalidad: "detal", yaCompro: false },
            { nombre: "Camila repetida", telefono: "3001112233", modalidad: "detal", yaCompro: false },
            { nombre: "Exterior", telefono: "+1 305 555 1234", modalidad: "detal", yaCompro: false },
          ],
        },
        MIEMBRO,
      ),
    );
    assert.deepEqual([r.data.creados, r.data.actualizados], [2, 1]);
    assert.deepEqual(
      r.data.errores.map((e) => e.motivo),
      ["Celular inválido", "Celular repetido"],
    );
    const camila = (await fila("573001112233"))!;
    assert.deepEqual([camila.nombre, camila.canal, camila.yaCompro, camila.registrado], ["Camila Pérez", "wholesale", true, true]);
    const luis = (await fila("573104445566"))!;
    assert.deepEqual([luis.nombre, luis.canal], ["Luis Gómez", "wholesale"], "el existente se actualiza (nombre y modalidad)");
    const h = await store.history({ tenantId: A, phoneNumberId: PN, waId: "573104445566" });
    assert.equal(h[0].reason, "Importación de clientes (actualización)");
    assert.equal((await fila("13055551234"))!.canal, "retail", "número de otro país con '+'");
  });

  it("aplicar: cuerpo inválido, vacío o > 500 filas => 400 sin escribir", async () => {
    for (const body of [null, { filas: [] }, { filas: [{ nombre: "A", telefono: "3001112233", modalidad: "vip", yaCompro: false }] }, { filas: Array.from({ length: 501 }, () => ({ nombre: "Ana", telefono: "3001112233", modalidad: "detal", yaCompro: false })) }]) {
      assert.equal((await aplicarImportacion(mem.repo, canales, A, body, MIEMBRO)).status, 400);
    }
    assert.equal((await listar()).total, 0);
  });

  it("una fila que falla al guardar no frena las demás", async () => {
    const guardar = mem.repo.guardarNombre;
    mem.repo.guardarNombre = async (t, pn, wa, n) => {
      if (wa === "573001110001") throw new Error("boom");
      return guardar(t, pn, wa, n);
    };
    const r = await json<{ creados: number; errores: Array<{ motivo: string }> }>(
      aplicarImportacion(
        mem.repo,
        canales,
        A,
        {
          filas: [
            { nombre: "Ana", telefono: "3001110001", modalidad: "detal", yaCompro: false },
            { nombre: "Beto", telefono: "3001110002", modalidad: "detal", yaCompro: false },
          ],
        },
        MIEMBRO,
      ),
    );
    assert.equal(r.data.creados, 1);
    assert.deepEqual(r.data.errores.map((e) => e.motivo), ["No se pudo guardar"]);
  });
});

describe("B34 · listado: registrados y clientes antiguos", () => {
  it("filtro 'registrados'; 'ya compraron' incluye al cliente antiguo sin pedidos; 'aún no compran' no", async () => {
    await registrar({ nombre: "Antigua", telefono: "3001110001", modalidad: "mayorista", yaCompro: true });
    await registrar({ nombre: "Nueva", telefono: "3001110002", modalidad: "detal" });
    mem.pedidos.push({ tenantId: A, pedido: "DL-ORD-CCCCC1", phoneNumberId: PN, waId: "573001110003", estado: "completed", canal: "retail", total: 50_000, nombre: "Del chat", creado: "2026-09-24T10:00:00Z", confirmado: "2026-09-24T10:00:00Z" });
    assert.deepEqual((await listar("filtro=registrados")).filas.map((f) => f.waId).sort(), ["573001110001", "573001110002"]);
    assert.deepEqual((await listar("filtro=compraron")).filas.map((f) => f.waId).sort(), ["573001110001", "573001110003"]);
    assert.deepEqual((await listar("filtro=sin_compras")).filas.map((f) => f.waId), ["573001110002"]);
  });

  it("el nombre que puso el equipo manda sobre el del pedido", async () => {
    mem.pedidos.push({ tenantId: A, pedido: "DL-ORD-CCCCC2", phoneNumberId: PN, waId: "573001110004", estado: "completed", canal: "retail", total: 50_000, nombre: "tomas p", creado: "2026-09-24T10:00:00Z", confirmado: "2026-09-24T10:00:00Z" });
    await editarCliente(mem.repo, canales, A, claveCliente(PN, "573001110004"), { nombre: "Tomás Pardo" }, MIEMBRO);
    assert.equal((await fila("573001110004"))!.nombre, "Tomás Pardo");
  });
});

describe("B34 · rutas y SQL", () => {
  it("las rutas nuevas exigen el módulo Clientes y el modo 'orders' (admin/agente); el negocio sale de la sesión", () => {
    for (const f of ["app/api/dashboard/clientes/route.ts", "app/api/dashboard/clientes/[cliente]/route.ts", "app/api/dashboard/clientes/importar/route.ts", "app/api/dashboard/clientes/importar/aplicar/route.ts"]) {
      const s = readFileSync(f, "utf8");
      // CADA handler de la ruta (GET, POST, PATCH…), no solo uno.
      const handlers = (s.match(/withCatalog\(/g) ?? []).length;
      assert.ok(handlers >= 1, f);
      // Bloque 35: eliminar (DELETE) es solo de administradores ("write"); lo demás, admin y agente ("orders").
      const eliminar = (s.match(/export async function DELETE/g) ?? []).length;
      assert.equal((s.match(/withCatalog\(\s*request,\s*"orders"/g) ?? []).length, handlers - eliminar, `${f}: modo 'orders' en cada handler`);
      assert.equal((s.match(/withCatalog\(\s*request,\s*"write"/g) ?? []).length, eliminar, `${f}: 'write' solo para eliminar`);
      assert.equal((s.match(/module: CLIENTS_MODULE/g) ?? []).length, handlers, `${f}: módulo Clientes en cada handler`);
      assert.ok(!/searchParams\.get\("tenant|body\.tenant|body\?\.tenant/.test(s), `${f}: el negocio sale de la sesión`);
    }
    assert.match(readFileSync("app/api/dashboard/clientes/importar/route.ts", "utf8"), /if \(archivo\.size > ARCHIVO_MAX_BYTES\) return apiError/);
  });

  it("migración: tabla solo para service_role, un registro por contacto y el listado con ficha y nombre conocido primero", () => {
    const sql = readFileSync("supabase/migrations/20261203000000_dulabs_catalogo_clientes_ficha.sql", "utf8");
    assert.match(sql, /create table if not exists public\.dulabs_catalogo_clientes_ficha/);
    assert.match(sql, /primary key \(id_tenant, phone_number_id, wa_id\)/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /revoke all on (table )?public\.dulabs_catalogo_clientes_ficha from (public, )?anon, authenticated/);
    assert.match(sql, /coalesce\(k\.nombre, nom\.cliente_nombre\)/);
  });
});
