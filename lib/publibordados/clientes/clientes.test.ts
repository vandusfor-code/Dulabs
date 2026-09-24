/**
 * Publi Bordados · módulo Clientes — modelo, autorización, repositorio y servicio.
 *
 * El repositorio REAL (crearRepositorioClientes) corre contra un Supabase en
 * memoria que aplica de verdad los filtros de supabase-js que usa
 * (eq/in/not is null con ruta JSON/order/limit/maybeSingle/update...select):
 * así el aislamiento por tenant se prueba en la consulta, no en un mock que
 * devuelve lo que uno quiere.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  aCliente,
  aplicarCambio,
  filtrarClientes,
  leerFiltro,
  parsearCantidad,
  TAMANO_PAGINA,
  validarCambio,
  type FilaContacto,
} from "@/lib/publibordados/clientes/modelo";
import { decidirAccesoClientes, requireClientes } from "@/lib/publibordados/clientes/auth";
import { crearRepositorioClientes } from "@/lib/publibordados/clientes/repositorio";
import { actualizarCliente, listarClientes, obtenerCliente } from "@/lib/publibordados/clientes/servicio";
import type { Miembro } from "@/lib/team";

// ---------------------------------------------------------------------------
// Supabase en memoria
// ---------------------------------------------------------------------------

type Fila = Record<string, unknown>;
type Consulta = { tabla: string; filtros: Array<[string, string, unknown]> };

function valor(fila: Fila, col: string): unknown {
  const m = /^(\w+)->>(\w+)$/.exec(col);
  if (!m) return fila[col];
  const json = fila[m[1]] as Record<string, unknown> | null;
  const v = json?.[m[2]];
  return v === undefined || v === null ? null : String(v);
}

function supabaseEnMemoria(tablas: Record<string, Fila[]>, hooks: { antesDeActualizar?: () => void } = {}) {
  const consultas: Consulta[] = [];
  const supabase = {
    from(tabla: string) {
      const filas = (tablas[tabla] ??= []);
      const filtros: Array<[string, string, unknown]> = [];
      let orden: { col: string; asc: boolean } | null = null;
      let limite = Infinity;
      let cambios: Fila | null = null;
      consultas.push({ tabla, filtros });
      const coincide = (f: Fila) =>
        filtros.every(([op, col, v]) => {
          const actual = valor(f, col);
          if (op === "eq") return actual === v;
          if (op === "in") return (v as unknown[]).includes(actual);
          if (op === "notnull") return actual !== null && actual !== undefined;
          return false;
        });
      const resolver = () => {
        if (cambios) {
          hooks.antesDeActualizar?.();
          const afectadas = filas.filter(coincide);
          for (const f of afectadas) Object.assign(f, structuredClone(cambios));
          return { data: structuredClone(afectadas), error: null };
        }
        let r = filas.filter(coincide);
        if (orden) {
          const { col, asc } = orden;
          r = [...r].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
        }
        return { data: structuredClone(r.slice(0, limite)), error: null };
      };
      const q = {
        select: () => q,
        eq(col: string, v: unknown) {
          filtros.push(["eq", col, v]);
          return q;
        },
        in(col: string, v: unknown[]) {
          filtros.push(["in", col, v]);
          return q;
        },
        not(col: string, op: string, v: unknown) {
          assert.equal(op, "is");
          assert.equal(v, null);
          filtros.push(["notnull", col, null]);
          return q;
        },
        order(col: string, opts: { ascending: boolean }) {
          orden = { col, asc: opts.ascending };
          return q;
        },
        limit(n: number) {
          limite = n;
          return q;
        },
        update(v: Fila) {
          cambios = v;
          return q;
        },
        async maybeSingle() {
          const { data } = resolver();
          return { data: data[0] ?? null, error: null };
        },
        then(ok: (v: { data: Fila[]; error: null }) => void, ko?: (e: unknown) => void) {
          try {
            ok(resolver());
          } catch (e) {
            ko?.(e);
          }
        },
      };
      return q;
    },
  };
  return { supabase: supabase as unknown as SupabaseClient, consultas, tablas };
}

// ---------------------------------------------------------------------------
// Datos: Publi Bordados (T1) y otro negocio (T2) con el MISMO teléfono de cliente.
// ---------------------------------------------------------------------------

const T1 = "f46242e0-e05e-4225-bc45-9539615f26df";
const T2 = "00000000-0000-4000-8000-000000000002";
const N1 = "1337486632773969";
const N2 = "999000111222333";
const N_VIEJO = "555000111222333"; // número que fue de T1 y ahora es de T2

const pb = (extra: Record<string, unknown> = {}) => ({
  pb_tipo_cliente: "empresa",
  pb_nombre: "Ana Gómez",
  pb_nombre_empresa: "Textiles SAS",
  pb_producto: "gorras",
  pb_cantidad: "20",
  ...extra,
});

function mundo() {
  const contactos: Fila[] = [
    { id: 1, id_tenant: T1, phone_number_id: N1, telefono_cliente: "573148127388", nombre: "573148127388", custom_fields: pb(), created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-20T10:00:00Z" },
    { id: 2, id_tenant: T1, phone_number_id: N1, telefono_cliente: "573001112233", nombre: "573001112233", custom_fields: pb({ pb_tipo_cliente: "persona_natural", pb_nombre: "José Pérez", pb_nombre_empresa: "", pb_producto: "uniformes", pb_cantidad: "5", pb_estado: "atendido", pb_asesor: "11" }), created_at: "2026-09-02T10:00:00Z", updated_at: "2026-09-21T10:00:00Z" },
    // Escribió pero no completó el flow: no es cliente del módulo.
    { id: 3, id_tenant: T1, phone_number_id: N1, telefono_cliente: "573009998877", nombre: "573009998877", custom_fields: {}, created_at: "2026-09-03T10:00:00Z", updated_at: "2026-09-03T10:00:00Z" },
    // Otro negocio, MISMO teléfono de cliente que el id 1.
    { id: 4, id_tenant: T2, phone_number_id: N2, telefono_cliente: "573148127388", nombre: "Cliente de T2", custom_fields: pb({ pb_nombre: "Secreto T2" }), created_at: "2026-09-04T10:00:00Z", updated_at: "2026-09-22T10:00:00Z" },
    // Fila vieja con id_tenant de T1 pero de un número que ya NO es de T1.
    { id: 5, id_tenant: T1, phone_number_id: N_VIEJO, telefono_cliente: "573112223344", nombre: "x", custom_fields: pb({ pb_nombre: "Número ajeno" }), created_at: "2026-09-05T10:00:00Z", updated_at: "2026-09-23T10:00:00Z" },
  ];
  return supabaseEnMemoria({
    dulabs_clientes_conocidos: contactos,
    dulabs_clientes_config: [
      { id_tenant: T1, phone_number_id: N1 },
      { id_tenant: T2, phone_number_id: N2 },
      { id_tenant: T2, phone_number_id: N_VIEJO },
    ],
    dulabs_miembros_equipo: [
      { id: 10, tenant_id: T1, nombre: "Laura", email: "laura@pb.co", estado: "activo", created_at: "1" },
      { id: 11, tenant_id: T1, nombre: "Marta", email: "marta@pb.co", estado: "suspendido", created_at: "2" },
      { id: 20, tenant_id: T2, nombre: "Asesor T2", email: "a@t2.co", estado: "activo", created_at: "3" },
    ],
    dulabs_mensajes_log: [
      { phone_number_id: N1, telefono_cliente: "573148127388", created_at: "2026-09-23T15:00:00Z" },
      { phone_number_id: N1, telefono_cliente: "573148127388", created_at: "2026-09-23T16:30:00Z" },
      { phone_number_id: N2, telefono_cliente: "573148127388", created_at: "2026-09-24T09:00:00Z" },
    ],
    dulabs_flow_executions: [
      { tenant_id: T1, phone_number_id: N1, telefono_cliente: "573148127388", current_node_id: "end-transferido", last_activity_at: "2026-09-20T10:00:00Z" },
      { tenant_id: T1, phone_number_id: N1, telefono_cliente: "573148127388", current_node_id: "btn-tipo-cliente", last_activity_at: "2026-09-23T16:30:00Z" },
      { tenant_id: T2, phone_number_id: N2, telefono_cliente: "573148127388", current_node_id: "end-transferido", last_activity_at: "2026-09-24T09:00:00Z" },
    ],
  });
}

// ---------------------------------------------------------------------------

describe("modelo", () => {
  it("parsearCantidad: solo enteros 1–999999 guardados por el Flow", () => {
    assert.equal(parsearCantidad("06"), 6);
    assert.equal(parsearCantidad("20"), 20);
    assert.equal(parsearCantidad(12), 12);
    for (const malo of ["0", "-3", "1.5", "abc", "", null, undefined, "1000000", "Infinity"]) assert.equal(parsearCantidad(malo), null, String(malo));
  });

  it("aCliente: nombre del Flow, empresa solo si es empresa, etiqueta de producto y asesor", () => {
    const fila = { id: 9, id_tenant: T1, phone_number_id: N1, telefono_cliente: "573148127388", nombre: "573148127388", custom_fields: pb({ pb_asesor: "10" }), created_at: "c", updated_at: "u" } as FilaContacto;
    const c = aCliente(fila, { asesores: new Map([[10, "Laura"]]) });
    assert.equal(c.nombre, "Ana Gómez");
    assert.equal(c.nombreEmpresa, "Textiles SAS");
    assert.equal(c.productoEtiqueta, "Gorras");
    assert.equal(c.cantidad, 20);
    assert.deepEqual(c.asesor, { id: 10, nombre: "Laura" });
    const persona = aCliente({ ...fila, custom_fields: pb({ pb_tipo_cliente: "persona_natural" }) }, { asesores: new Map() });
    assert.equal(persona.nombreEmpresa, null, "una persona natural nunca muestra empresa");
    assert.equal(persona.asesor, null);
  });

  it("filtrar: búsqueda sin tildes por nombre/empresa/teléfono y filtros de tipo y estado", () => {
    const lista = [
      { nombre: "José Pérez", nombreEmpresa: null, telefono: "573001112233", tipo: "persona_natural" as const, estado: "atendido" as const },
      { nombre: "Ana Gómez", nombreEmpresa: "Textiles SAS", telefono: "573148127388", tipo: "empresa" as const, estado: "nuevo" as const },
    ];
    assert.deepEqual(filtrarClientes(lista, { q: "jose" }).map((c) => c.nombre), ["José Pérez"]);
    assert.deepEqual(filtrarClientes(lista, { q: "TEXTILES" }).map((c) => c.nombre), ["Ana Gómez"]);
    assert.deepEqual(filtrarClientes(lista, { q: "314 812" }).map((c) => c.nombre), ["Ana Gómez"]);
    assert.deepEqual(filtrarClientes(lista, { tipo: "persona_natural" }).map((c) => c.nombre), ["José Pérez"]);
    assert.deepEqual(filtrarClientes(lista, { tipo: "empresa", estado: "atendido" }), []);
    assert.equal(filtrarClientes(lista, { tipo: "todos", estado: "todos" }).length, 2);
  });

  it("leerFiltro ignora valores desconocidos", () => {
    assert.deepEqual(leerFiltro(new URLSearchParams("tipo=admin&estado=borrado&q=ana")), { q: "ana", tipo: "todos", estado: "todos" });
  });

  it("validarCambio: solo estado y asesor; rechaza cualquier otro campo (tenant, datos del Flow)", () => {
    assert.deepEqual(validarCambio({ estado: "en_atencion" }), { ok: true, cambio: { estado: "en_atencion" } });
    assert.deepEqual(validarCambio({ asesorId: null }), { ok: true, cambio: { asesorId: null } });
    for (const malo of [{}, null, [], { estado: "cerrado" }, { asesorId: "10" }, { asesorId: -1 }, { asesorId: 1.5 }, { id_tenant: T2 }, { estado: "nuevo", pb_nombre: "x" }]) {
      assert.equal(validarCambio(malo).ok, false, JSON.stringify(malo));
    }
  });

  it("aplicarCambio hace merge: nunca borra los datos que guardó el Flow", () => {
    const r = aplicarCambio(pb({ pb_asesor: "10" }), { estado: "atendido", asesorId: null });
    assert.equal(r.pb_estado, "atendido");
    assert.equal(r.pb_asesor, undefined);
    assert.equal(r.pb_nombre, "Ana Gómez");
    assert.equal(r.pb_cantidad, "20");
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

  it("sin sesión → 401; módulo apagado → 403; error verificando el módulo → 500 (nunca permitido)", async () => {
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
    const ok = await requireClientes(req, "write", deps(miembro("agente", T2), true));
    assert.ok(ok.ok && ok.tenantId === T2);
  });
});

describe("servicio + repositorio — aislamiento multi-tenant", () => {
  it("T1 ve SOLO sus clientes del módulo: ni los de T2 (mismo teléfono), ni contactos sin Flow, ni filas de un número que ya no es suyo", async () => {
    const { supabase } = mundo();
    const r = await listarClientes(crearRepositorioClientes(supabase), T1, {});
    assert.deepEqual(r.clientes.map((c) => c.id).sort(), [1, 2]);
    assert.ok(!JSON.stringify(r).includes("Secreto T2"));
    assert.ok(!JSON.stringify(r).includes("Número ajeno"));
    assert.equal(r.total, 2);
  });

  it("T2 ve SOLO lo suyo", async () => {
    const { supabase } = mundo();
    const r = await listarClientes(crearRepositorioClientes(supabase), T2, {});
    assert.deepEqual(r.clientes.map((c) => c.nombre), ["Secreto T2"]);
    assert.deepEqual(r.asesores, [{ id: 20, nombre: "Asesor T2" }]);
  });

  it("cada consulta a contactos, equipo y ejecuciones lleva el tenant de la sesión; las de contactos además los números del tenant", async () => {
    const { supabase, consultas } = mundo();
    await listarClientes(crearRepositorioClientes(supabase), T1, {});
    for (const c of consultas) {
      if (c.tabla === "dulabs_clientes_conocidos") {
        assert.ok(c.filtros.some(([op, col, v]) => op === "eq" && col === "id_tenant" && v === T1));
        assert.ok(c.filtros.some(([op, col, v]) => op === "in" && col === "phone_number_id" && JSON.stringify(v) === JSON.stringify([N1])));
      }
      if (c.tabla === "dulabs_miembros_equipo") assert.ok(c.filtros.some(([op, col, v]) => op === "eq" && col === "tenant_id" && v === T1));
      if (c.tabla === "dulabs_flow_executions") assert.ok(c.filtros.some(([op, col, v]) => op === "eq" && col === "tenant_id" && v === T1));
      if (c.tabla === "dulabs_mensajes_log") assert.ok(c.filtros.some(([op, col, v]) => op === "eq" && col === "phone_number_id" && v === N1));
    }
  });

  it("un tenant sin números no ve nada", async () => {
    const { supabase } = mundo();
    const r = await listarClientes(crearRepositorioClientes(supabase), "11111111-1111-4111-8111-111111111111", {});
    assert.equal(r.total, 0);
  });

  it("un cliente que el Flow guardó sin estado se muestra como Nuevo", async () => {
    const { supabase } = mundo();
    const r = await obtenerCliente(crearRepositorioClientes(supabase), T1, 1);
    assert.ok(r.ok);
    assert.equal(r.data.cliente.estado, "nuevo");
  });

  it("ficha: T1 abre la suya; la de T2, la vieja y la sin Flow responden 404", async () => {
    const { supabase } = mundo();
    const repo = crearRepositorioClientes(supabase);
    const propia = await obtenerCliente(repo, T1, 1);
    assert.ok(propia.ok);
    for (const id of [4, 5, 3, 999]) {
      const r = await obtenerCliente(repo, T1, id);
      assert.deepEqual(r, { ok: false, status: 404, error: "Cliente no encontrado" }, `id ${id}`);
    }
  });

  it("último contacto (último mensaje) y última solicitud (último traspaso), solo de SU número", async () => {
    const { supabase } = mundo();
    const r = await obtenerCliente(crearRepositorioClientes(supabase), T1, 1);
    assert.ok(r.ok);
    assert.equal(r.data.cliente.ultimoContactoEn, "2026-09-23T16:30:00Z");
    assert.equal(r.data.cliente.ultimaSolicitudEn, "2026-09-20T10:00:00Z");
    assert.equal(r.data.cliente.registradoEn, "2026-09-01T10:00:00Z");
  });

  it("asesor suspendido se sigue mostrando por nombre; solo los activos se ofrecen para asignar", async () => {
    const { supabase } = mundo();
    const r = await obtenerCliente(crearRepositorioClientes(supabase), T1, 2);
    assert.ok(r.ok);
    assert.deepEqual(r.data.cliente.asesor, { id: 11, nombre: "Marta" });
    assert.deepEqual(r.data.asesores, [{ id: 10, nombre: "Laura" }]);
  });
});

describe("servicio — cambiar estado y asesor", () => {
  it("cambia estado y asesor sin tocar los datos del Flow", async () => {
    const { supabase, tablas } = mundo();
    const r = await actualizarCliente(crearRepositorioClientes(supabase), T1, 1, { estado: "en_atencion", asesorId: 10 });
    assert.ok(r.ok);
    assert.equal(r.data.cliente.estado, "en_atencion");
    assert.deepEqual(r.data.cliente.asesor, { id: 10, nombre: "Laura" });
    assert.deepEqual(tablas.dulabs_clientes_conocidos[0].custom_fields, pb({ pb_estado: "en_atencion", pb_asesor: "10" }));
  });

  it("T1 NO puede modificar el cliente de T2 (404) y la fila de T2 queda intacta", async () => {
    const { supabase, tablas } = mundo();
    const antes = structuredClone(tablas.dulabs_clientes_conocidos[3]);
    const r = await actualizarCliente(crearRepositorioClientes(supabase), T1, 4, { estado: "atendido" });
    assert.equal(!r.ok && r.status, 404);
    assert.deepEqual(tablas.dulabs_clientes_conocidos[3], antes);
  });

  it("no se puede asignar un asesor de otro tenant ni uno suspendido", async () => {
    const { supabase } = mundo();
    const repo = crearRepositorioClientes(supabase);
    assert.equal((await actualizarCliente(repo, T1, 1, { asesorId: 20 })).ok, false);
    assert.equal((await actualizarCliente(repo, T1, 1, { asesorId: 11 })).ok, false);
  });

  it("si el Flow guarda justo entre la lectura y la escritura, se relee y NO se pierde lo que guardó el Flow", async () => {
    const base = mundo();
    const fila = base.tablas.dulabs_clientes_conocidos[0];
    let una = true;
    const m = supabaseEnMemoria(base.tablas, {
      antesDeActualizar() {
        if (!una) return;
        una = false;
        // El cliente completó otra solicitud en ese instante.
        fila.custom_fields = pb({ pb_producto: "uniformes", pb_cantidad: "50" });
        fila.updated_at = "2026-09-24T12:00:00Z";
      },
    });
    const r = await actualizarCliente(crearRepositorioClientes(m.supabase), T1, 1, { estado: "en_atencion" });
    assert.ok(r.ok);
    const cf = fila.custom_fields as Record<string, unknown>;
    assert.equal(cf.pb_estado, "en_atencion");
    assert.equal(cf.pb_producto, "uniformes", "el dato nuevo del Flow se conserva");
    assert.equal(cf.pb_cantidad, "50");
  });

  it("conflicto persistente → 409, nunca escribe a ciegas", async () => {
    const base = mundo();
    const fila = base.tablas.dulabs_clientes_conocidos[0];
    let n = 0;
    const m = supabaseEnMemoria(base.tablas, { antesDeActualizar: () => void (fila.updated_at = `2026-09-24T12:00:0${n++}Z`) });
    const r = await actualizarCliente(crearRepositorioClientes(m.supabase), T1, 1, { estado: "atendido" });
    assert.equal(!r.ok && r.status, 409);
    assert.equal((fila.custom_fields as Record<string, unknown>).pb_estado, undefined, "no se escribió nada");
  });
});

describe("servicio — búsqueda, filtros y paginación", () => {
  it("filtros por tipo y búsqueda llegan al listado", async () => {
    const { supabase } = mundo();
    const repo = crearRepositorioClientes(supabase);
    assert.deepEqual((await listarClientes(repo, T1, { tipo: "empresa" })).clientes.map((c) => c.id), [1]);
    assert.deepEqual((await listarClientes(repo, T1, { tipo: "persona_natural" })).clientes.map((c) => c.id), [2]);
    assert.deepEqual((await listarClientes(repo, T1, { q: "perez" })).clientes.map((c) => c.id), [2]);
    assert.deepEqual((await listarClientes(repo, T1, { estado: "atendido" })).clientes.map((c) => c.id), [2]);
  });

  it(`pagina de a ${TAMANO_PAGINA}, ordenado por el más reciente; página fuera de rango se ajusta`, async () => {
    const filas: Fila[] = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      id_tenant: T1,
      phone_number_id: N1,
      telefono_cliente: `5730000000${String(i).padStart(2, "0")}`,
      nombre: "x",
      custom_fields: pb({ pb_nombre: `Cliente ${i + 1}` }),
      created_at: "2026-09-01T00:00:00Z",
      updated_at: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const { supabase } = supabaseEnMemoria({ dulabs_clientes_conocidos: filas, dulabs_clientes_config: [{ id_tenant: T1, phone_number_id: N1 }] });
    const repo = crearRepositorioClientes(supabase);
    const p1 = await listarClientes(repo, T1, {}, 1);
    assert.equal(p1.clientes.length, TAMANO_PAGINA);
    assert.equal(p1.clientes[0].nombre, "Cliente 30");
    assert.equal(p1.paginas, 2);
    const p9 = await listarClientes(repo, T1, {}, 9);
    assert.equal(p9.pagina, 2);
    assert.equal(p9.clientes.length, 30 - TAMANO_PAGINA);
  });
});

describe("menú del dashboard", () => {
  it("'Clientes' solo aparece para tenants con el módulo publibordados_clientes habilitado", async () => {
    const { navSections, navItemVisible } = await import("@/components/dashboard/shell/nav");
    const item = navSections.flatMap((s) => s.items).find((i) => i.href === "/dashboard/publibordados/clientes");
    assert.ok(item);
    assert.equal(navItemVisible(item, "agente", []), false);
    assert.equal(navItemVisible(item, "agente", ["catalogo"]), false);
    assert.equal(navItemVisible(item, "lectura", ["publibordados_clientes"]), true);
  });
});
