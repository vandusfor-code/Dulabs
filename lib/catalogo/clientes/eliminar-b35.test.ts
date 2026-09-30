/**
 * Bloque 35 — eliminar un cliente desde el módulo Clientes (solo administradores): se borra todo lo
 * suyo en el negocio (pedidos cerrados, modalidad, nombre, ficha y nota; en la BD también la
 * conversación del asistente) y el chat del Inbox se conserva. Con un pedido activo no se toca nada.
 * Repositorio en memoria con la MISMA regla que la función SQL (que tiene su prueba en PostgreSQL
 * real). Datos ficticios.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import { CLIENTS_MODULE, decideCatalogAccess } from "@/lib/catalogo/auth";
import { claveCliente, type ClienteFila } from "@/lib/catalogo/clientes/modelo";
import { createMemoryClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import { eliminarCliente, listarClientes } from "@/lib/catalogo/clientes/servicio";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const PN = "100000000000001";
const PN_B = "200000000000002";
const ANA = "573001110001";
const LUIS = "573001110002";
const ADMIN = 3;

let mem: ReturnType<typeof createMemoryClientesRepo>;

beforeEach(() => {
  mem = createMemoryClientesRepo(() => Date.parse("2026-09-30T15:00:00Z"));
  mem.numeros[A] = [PN];
  mem.numeros[B] = [PN_B];
  const canal = (tenantId: string, pn: string, waId: string) =>
    mem.canales.push({ tenantId, phoneNumberId: pn, waId, canal: "retail", origen: "cliente", creado: "2026-09-20T10:00:00Z", actualizado: "2026-09-20T10:00:00Z" });
  canal(A, PN, ANA);
  canal(A, PN, LUIS);
  canal(B, PN_B, ANA);
  mem.pedidos.push(
    { tenantId: A, pedido: "DL-ORD-AAAAA1", phoneNumberId: PN, waId: ANA, estado: "completed", canal: "retail", total: 80_000, nombre: "Ana", creado: "2026-09-21T10:00:00Z", confirmado: "2026-09-21T10:05:00Z" },
    { tenantId: A, pedido: "DL-ORD-AAAAA2", phoneNumberId: PN, waId: ANA, estado: "cancelled", canal: "retail", total: 5_000, creado: "2026-09-22T10:00:00Z", confirmado: "2026-09-22T10:05:00Z" },
    { tenantId: A, pedido: "DL-ORD-LLLLL1", phoneNumberId: PN, waId: LUIS, estado: "confirmed", etapa: "en_preparacion", canal: "retail", total: 30_000, creado: "2026-09-23T10:00:00Z", confirmado: "2026-09-23T10:05:00Z" },
    { tenantId: B, pedido: "DL-ORD-BBBBB1", phoneNumberId: PN_B, waId: ANA, estado: "completed", canal: "retail", total: 99_000, creado: "2026-09-24T10:00:00Z", confirmado: "2026-09-24T10:00:00Z" },
  );
  mem.conocidos.push({ tenantId: A, phoneNumberId: PN, waId: ANA, nombre: "Ana Pérez" }, { tenantId: B, phoneNumberId: PN_B, waId: ANA, nombre: "Ana en B" });
  mem.fichas.set(`${A}|${PN}|${ANA}`, { yaCompro: true, registrado: true, actualizadoPor: ADMIN });
  mem.notas.set(`${A}|${PN}|${ANA}`, { tenantId: A, nota: "VIP", version: 1, actualizado_por: ADMIN, updated_at: "2026-09-25T10:00:00Z" });
});

type Json<T> = { success: boolean; data: T; error?: { code: string; message: string; diagnostics?: unknown } };
const json = async <T>(r: Response | Promise<Response>) => ({ status: (await r).status, body: (await (await r).json()) as Json<T> });
const eliminar = (wa: string, tenant = A, pn = tenant === A ? PN : PN_B) => json<{ eliminado: string; pedidos: number }>(eliminarCliente(mem.repo, tenant, claveCliente(pn, wa), ADMIN));
const filas = async (tenant = A) => ((await (await listarClientes(mem.repo, tenant, new URLSearchParams())).json()) as Json<{ filas: ClienteFila[] }>).data.filas;

describe("B35 · eliminar cliente", () => {
  it("se borra todo lo suyo en el negocio (pedidos cerrados, modalidad, nombre, ficha y nota) y sale del listado", async () => {
    const r = await eliminar(ANA);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { eliminado: claveCliente(PN, ANA), pedidos: 2 });
    assert.deepEqual((await filas()).map((f) => f.waId), [LUIS]);
    assert.ok(!mem.pedidos.some((p) => p.tenantId === A && p.waId === ANA));
    assert.ok(!mem.canales.some((c) => c.tenantId === A && c.waId === ANA));
    assert.ok(!mem.conocidos.some((c) => c.tenantId === A && c.waId === ANA));
    assert.equal(mem.fichas.has(`${A}|${PN}|${ANA}`), false);
    assert.equal(mem.notas.has(`${A}|${PN}|${ANA}`), false);
    assert.deepEqual(mem.eliminados, [{ tenantId: A, clave: claveCliente(PN, ANA), miembroId: ADMIN, pedidos: 2 }], "auditoría: quién y cuántos pedidos");
  });

  it("el mismo teléfono en OTRO negocio no se toca", async () => {
    await eliminar(ANA);
    const b = await filas(B);
    assert.deepEqual([b.length, b[0].nombre, b[0].compras], [1, "Ana en B", 1]);
  });

  it("con un pedido ACTIVO: 409 (cancelarlo primero para que el stock vuelva) y nada se borra", async () => {
    const r = await eliminar(LUIS);
    assert.equal(r.status, 409);
    assert.equal(r.body.error?.code, "ACTIVE_ORDERS");
    assert.match(r.body.error!.message, /pedido activo. Cancélalo primero/);
    assert.deepEqual(r.body.error?.diagnostics, { activos: 1 });
    assert.ok(mem.pedidos.some((p) => p.waId === LUIS));
    assert.ok((await filas()).some((f) => f.waId === LUIS));
    assert.equal(mem.eliminados.length, 0);
  });

  it("cliente que no es de ESTE negocio, clave inválida o ya eliminado => 404", async () => {
    assert.equal((await eliminar(ANA, A, PN_B)).status, 404);
    assert.equal((await json(eliminarCliente(mem.repo, A, "basura", ADMIN))).status, 404);
    assert.equal((await eliminar("573009999999")).status, 404);
    await eliminar(ANA);
    assert.equal((await eliminar(ANA)).status, 404);
  });

  it("el repositorio (como la función SQL) tampoco borra con un número que no es del negocio", async () => {
    assert.deepEqual(await mem.repo.eliminar(A, PN_B, ANA, ADMIN), { resultado: "no_encontrado" });
    assert.ok(mem.pedidos.some((p) => p.tenantId === B && p.waId === ANA));
    assert.ok(mem.conocidos.some((c) => c.tenantId === B && c.waId === ANA));
    assert.equal(mem.eliminados.length, 0);
  });

  it("solo administradores: la ruta DELETE exige 'write' y el módulo Clientes; una asesora (agente) no puede", () => {
    const s = readFileSync("app/api/dashboard/clientes/[cliente]/route.ts", "utf8");
    assert.match(s, /export async function DELETE[\s\S]*withCatalog\(\s*request,\s*"write",[\s\S]*eliminarCliente[\s\S]*module: CLIENTS_MODULE/);
    assert.equal(decideCatalogAccess({ role: "agente", mode: "write", moduleEnabled: true, module: CLIENTS_MODULE }).allowed, false);
    assert.equal(decideCatalogAccess({ role: "admin", mode: "write", moduleEnabled: true, module: CLIENTS_MODULE }).allowed, true);
  });

  it("la migración: copia en la auditoría antes de borrar, historiales con borrado solo autorizado y el chat del Inbox intacto", () => {
    const sql = readFileSync("supabase/migrations/20261204000000_dulabs_catalogo_eliminar.sql", "utf8");
    assert.match(sql, /insert into public\.dulabs_catalogo_eliminados[\s\S]*perform set_config\('dulabs\.eliminacion_autorizada', 'on', true\)/);
    assert.match(sql, /estado in \('confirmed', 'handoff'\)/);
    assert.ok(!/delete from public\.dulabs_mensajes_log/.test(sql), "nunca borra el chat");
    assert.match(sql, /if v\.estado not in \('completed', 'cancelled', 'rejected', 'expired'\)/);
  });
});
