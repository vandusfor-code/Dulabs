/**
 * Publi Bordados · módulo Clientes — pruebas unitarias (sin base de datos).
 * La lógica de datos (SQL) se prueba contra Postgres real en solicitudes.integracion.test.ts y
 * en supabase/tests/20261120000000_dulabs_pb_solicitudes.test.sql.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  aCliente,
  aClienteDetalle,
  aSolicitud,
  filtroSolicitudesSql,
  leerFiltroClientes,
  leerFiltroSolicitudes,
  leerId,
  leerPagina,
  TAMANO_PAGINA,
  validarCambioSolicitud,
  type SolicitudDb,
} from "@/lib/publibordados/clientes/modelo";
import { decidirAccesoClientes, requireClientes } from "@/lib/publibordados/clientes/auth";
import { actualizarSolicitud, listarSolicitudes, obtenerCliente } from "@/lib/publibordados/clientes/servicio";
import type { ClientesRepositorio, ResultadoActualizacion } from "@/lib/publibordados/clientes/repositorio";
import type { Miembro } from "@/lib/team";

const T1 = "aaaaaaaa-0000-4000-8000-000000000001";

const fila = (over: Partial<SolicitudDb> = {}): SolicitudDb => ({
  id: 10,
  clienteId: 3,
  telefono: "573148127388",
  tipoCliente: "empresa",
  nombre: "Ana",
  nombreEmpresa: "Textiles SAS",
  producto: "gorras",
  cantidad: 20,
  estado: "nuevo",
  asesorId: null,
  asignadoAt: null,
  atendidoAt: null,
  version: 1,
  flowExecutionId: "exec-1",
  eventoId: "wamid.1",
  createdAt: "2026-09-25T10:00:00Z",
  updatedAt: "2026-09-25T10:00:00Z",
  ...over,
});
const nombres = new Map([
  [1, "Ana"],
  [2, "Carlos"],
]);

describe("modelo — mapeos", () => {
  it("solicitud: etiqueta de producto y asesor por nombre; asesor desconocido → null", () => {
    const s = aSolicitud(fila({ asesorId: 2 }), nombres);
    assert.equal(s.productoEtiqueta, "Gorras");
    assert.deepEqual(s.asesor, { id: 2, nombre: "Carlos" });
    assert.equal(aSolicitud(fila({ asesorId: 99 }), nombres).asesor, null);
    assert.ok(!("asesorId" in s));
  });

  it("cliente: resumen de la última solicitud; cliente sin solicitudes → null", () => {
    const base = { id: 3, telefono: "57", tipoCliente: "empresa" as const, nombre: "Ana", nombreEmpresa: "X", registradoAt: "r", totalSolicitudes: 2, ultimaSolicitudAt: "u", ultimoContactoAt: null };
    const c = aCliente({ ...base, ultimaSolicitud: { id: 10, producto: "uniformes", cantidad: 50, estado: "en_atencion", asesorId: 1 } }, nombres);
    assert.deepEqual(c.ultimaSolicitud, { id: 10, producto: "uniformes", productoEtiqueta: "Uniformes", cantidad: 50, estado: "en_atencion", asesor: { id: 1, nombre: "Ana" } });
    assert.equal(aCliente({ ...base, totalSolicitudes: 0, ultimaSolicitud: null }, nombres).ultimaSolicitud, null);
  });

  it("detalle: datos del flujo anterior con etiqueta legible", () => {
    const d = aClienteDetalle(
      {
        cliente: { id: 3, telefono: "57", registradoAt: "r", tipoCliente: "empresa", nombre: "Legado", nombreEmpresa: "V", totalSolicitudes: 0, ultimoContactoAt: null, datosAnteriores: { producto: "prendas_de_vestir", cantidad: "30" } },
        solicitudes: [],
      },
      nombres,
    );
    assert.deepEqual(d.cliente.datosAnteriores, { producto: "Prendas de vestir", cantidad: "30" });
  });
});

describe("modelo — entrada del navegador (nunca se confía)", () => {
  it("filtros de solicitudes: solo valores conocidos; asesor 'ninguno' = sin asignar", () => {
    const f = leerFiltroSolicitudes(new URLSearchParams("estado=en_atencion&tipo=empresa&producto=gorras&asesor=2&desde=2026-09-01&hasta=2026-09-30&q=%20ana%20"));
    assert.deepEqual(f, { q: "ana", estado: "en_atencion", tipo: "empresa", producto: "gorras", asesorId: 2, sinAsesor: undefined, desde: "2026-09-01", hasta: "2026-09-30" });
    const malo = leerFiltroSolicitudes(new URLSearchParams("estado=borrado&tipo=x&producto=sombreros&asesor=abc&desde=ayer&hasta=2026-13-45"));
    assert.deepEqual(malo, { q: undefined, estado: undefined, tipo: undefined, producto: undefined, asesorId: undefined, sinAsesor: undefined, desde: undefined, hasta: undefined });
    assert.equal(leerFiltroSolicitudes(new URLSearchParams("asesor=ninguno")).sinAsesor, true);
    assert.deepEqual(leerFiltroClientes(new URLSearchParams("tipo=admin&q=x")), { q: "x", tipo: undefined });
  });

  it("fechas de Colombia → instantes; 'hasta' incluye el día completo", () => {
    const sql = filtroSolicitudesSql({ desde: "2026-09-25", hasta: "2026-09-25" }, 2);
    assert.equal(sql.desde, "2026-09-25T00:00:00-05:00");
    assert.equal(sql.hasta, "2026-09-26T05:00:00.000Z");
    assert.deepEqual([sql.limite, sql.offset], [TAMANO_PAGINA, TAMANO_PAGINA]);
  });

  it("página e id: solo enteros positivos", () => {
    assert.equal(leerPagina(new URLSearchParams("pagina=3")), 3);
    for (const p of ["0", "-1", "abc", "1.5", ""]) assert.equal(leerPagina(new URLSearchParams(`pagina=${p}`)), 1, p);
    assert.equal(leerId("12"), 12);
    for (const id of ["abc", "0", "-1", "1e3", "1;drop", "", "9999999999999999"]) assert.equal(leerId(id), null, id);
  });

  it("cambio de solicitud: solo estado y asesor, con versión; cualquier otro campo se rechaza", () => {
    assert.deepEqual(validarCambioSolicitud({ version: 3, estado: "atendido" }), { ok: true, cambio: { version: 3, estado: "atendido" } });
    assert.deepEqual(validarCambioSolicitud({ version: 1, asesorId: null }), { ok: true, cambio: { version: 1, asesorId: null } });
    for (const malo of [
      {},
      null,
      [],
      { estado: "atendido" },
      { version: 0, estado: "atendido" },
      { version: 1 },
      { version: 1, estado: "cerrado" },
      { version: 1, asesorId: "2" },
      { version: 1, asesorId: -1 },
      { version: 1, cantidad: 5 },
      { version: 1, id_tenant: T1 },
      { version: 1, estado: "nuevo", producto: "otros" },
    ]) {
      assert.equal(validarCambioSolicitud(malo).ok, false, JSON.stringify(malo));
    }
  });
});

describe("servicio — traducción de resultados", () => {
  const repo = (resultado: ResultadoActualizacion, miembros = [{ id: 1, nombre: "Ana", email: null, estado: "activo" }, { id: 5, nombre: "Sus", email: null, estado: "suspendido" }]) => {
    const llamadas: unknown[] = [];
    const r: ClientesRepositorio = {
      listarClientes: async () => ({ total: 0, filas: [] }),
      obtenerCliente: async () => null,
      listarSolicitudes: async (_t, f) => {
        llamadas.push(f);
        return { total: 26, filas: [fila()] };
      },
      obtenerSolicitud: async () => null,
      actualizarSolicitud: async (_t, id, version, cambio) => {
        llamadas.push({ id, version, cambio });
        return resultado;
      },
      miembrosDelTenant: async () => miembros,
    };
    return { r, llamadas };
  };

  it("ok / no_encontrada / conflicto / asesor_invalido → 200 / 404 / 409 / 400", async () => {
    assert.ok((await actualizarSolicitud(repo({ resultado: "ok", solicitud: fila({ estado: "atendido" }) }).r, T1, 10, { version: 1, estado: "atendido" })).ok);
    const casos: Array<[ResultadoActualizacion["resultado"], number]> = [["no_encontrada", 404], ["conflicto", 409], ["asesor_invalido", 400]];
    for (const [resultado, status] of casos) {
      const r = await actualizarSolicitud(repo({ resultado } as ResultadoActualizacion).r, T1, 10, { version: 1, estado: "atendido" });
      assert.equal(!r.ok && r.status, status, resultado);
    }
  });

  it("asesor suspendido o de fuera del equipo: se rechaza antes de ir a la BD", async () => {
    for (const asesorId of [5, 99]) {
      const { r, llamadas } = repo({ resultado: "ok", solicitud: fila() });
      const res = await actualizarSolicitud(r, T1, 10, { version: 1, asesorId });
      assert.equal(!res.ok && res.status, 400);
      assert.equal(llamadas.length, 0);
    }
  });

  it("solo manda a la BD los campos cambiados (la versión va aparte)", async () => {
    const { r, llamadas } = repo({ resultado: "ok", solicitud: fila() });
    await actualizarSolicitud(r, T1, 10, { version: 4, asesorId: null });
    assert.deepEqual(llamadas[0], { id: 10, version: 4, cambio: { asesorId: null } });
  });

  it("listado: paginación calculada con el total real; cliente inexistente → 404", async () => {
    const { r } = repo({ resultado: "conflicto" });
    const l = await listarSolicitudes(r, T1, {}, 2);
    assert.deepEqual([l.total, l.pagina, l.paginas], [26, 2, 2]);
    assert.deepEqual(l.asesores, [{ id: 1, nombre: "Ana" }], "solo asesores activos para asignar");
    const c = await obtenerCliente(r, T1, 1);
    assert.equal(!c.ok && c.status, 404);
  });
});

describe("autorización", () => {
  it("matriz rol × modo × módulo", () => {
    assert.deepEqual(decidirAccesoClientes({ rol: "lectura", modo: "read", moduloHabilitado: true }), { allowed: true });
    assert.equal(decidirAccesoClientes({ rol: "lectura", modo: "write", moduloHabilitado: true }).allowed, false);
    assert.deepEqual(decidirAccesoClientes({ rol: "agente", modo: "write", moduloHabilitado: true }), { allowed: true });
    assert.equal(decidirAccesoClientes({ rol: "admin", modo: "read", moduloHabilitado: false }).allowed, false);
  });

  const miembro = (rol: Miembro["rol"], tenantId = T1): Miembro => ({ miembroId: 1, tenantId, userId: "u", rol, estado: "activo" });
  const req = {} as NextRequest;
  const deps = (m: Miembro | null, modulo: boolean | Error) => ({
    authenticate: async () =>
      m ? { ok: true as const, supabase: {} as SupabaseClient, member: m } : { ok: false as const, response: Response.json({ error: "Sesión inválida" }, { status: 401 }) },
    isModuleEnabled: async () => {
      if (modulo instanceof Error) throw modulo;
      return modulo;
    },
  });

  it("sin sesión 401; módulo apagado 403; error verificando el módulo 500 (nunca permitido)", async () => {
    const sinSesion = await requireClientes(req, "read", deps(null, true));
    assert.equal(!sinSesion.ok && sinSesion.response.status, 401);
    const apagado = await requireClientes(req, "read", deps(miembro("admin"), false));
    assert.equal(!apagado.ok && apagado.response.status, 403);
    const roto = await requireClientes(req, "read", deps(miembro("admin"), new Error("db")));
    assert.equal(!roto.ok && roto.response.status, 500);
  });

  it("lectura no puede modificar; el tenant sale SIEMPRE de la membresía", async () => {
    const lectura = await requireClientes(req, "write", deps(miembro("lectura"), true));
    assert.equal(!lectura.ok && lectura.response.status, 403);
    const ok = await requireClientes(req, "write", deps(miembro("agente", "otro-tenant"), true));
    assert.ok(ok.ok && ok.tenantId === "otro-tenant");
  });
});

describe("menú del dashboard", () => {
  it("'Solicitudes' y 'Clientes' solo aparecen con el módulo publibordados_clientes habilitado", async () => {
    const { navSections, navItemVisible } = await import("@/components/dashboard/shell/nav");
    const items = navSections.flatMap((s) => s.items).filter((i) => i.href.startsWith("/dashboard/publibordados/"));
    assert.deepEqual(items.map((i) => i.href).sort(), ["/dashboard/publibordados/clientes", "/dashboard/publibordados/solicitudes"]);
    for (const item of items) {
      assert.equal(navItemVisible(item, "agente", []), false);
      assert.equal(navItemVisible(item, "agente", ["catalogo"]), false);
      assert.equal(navItemVisible(item, "lectura", ["publibordados_clientes"]), true);
    }
  });
});
