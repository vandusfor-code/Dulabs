/**
 * Publi Bordados — Cliente → Solicitudes, de punta a punta sobre la implementación REAL.
 *
 *   Rutas reales (/api/dashboard/publibordados/...) → requireClientes → servicio → repositorio
 *   → supabase-js → RPC → PostgreSQL REAL con la migración 20261120000000 (triggers, constraints,
 *   funciones). El registro desde el Flow usa el InternalActionExecutor real con el registro de
 *   módulos real y el manejador real de Publi Bordados.
 *
 * Lo único emulado es lo que no es de este módulo: la sesión (Auth) y las tablas de equipo /
 * módulos / números que lee la autorización (lib/testing/supabase-rest-memoria). Los mismos
 * miembros existen en Postgres para que el trigger valide al asesor de verdad.
 *
 * Requiere PB_TEST_PSQL (ver lib/publibordados/testing/postgres-real.ts); sin ella se salta.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { after, before, beforeEach, afterEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { crearBasePrueba, HAY_POSTGRES, type BasePrueba } from "@/lib/publibordados/testing/postgres-real";
import { supabaseAdmin } from "@/lib/supabase";
import { registrarSolicitudPublibordados } from "@/lib/publibordados/solicitudes/registrar";
import { REGISTROS_FLOW_POR_MODULO } from "@/lib/modulos/registros-flow";
import { InternalActionExecutor, type InternalActionDeps } from "@/lib/flow/executors/internal-action-executor";
import { createSupabaseInternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest } from "@/lib/flow/executor-types";
import { publibordadosFlow } from "@/lib/flows/publibordados.flow";
import type { Cliente, ClienteDetalle, Solicitud } from "@/lib/publibordados/clientes/modelo";
import { GET as clientesGET } from "@/app/api/dashboard/publibordados/clientes/route";
import { GET as clienteGET } from "@/app/api/dashboard/publibordados/clientes/[id]/route";
import { GET as solicitudesGET } from "@/app/api/dashboard/publibordados/solicitudes/route";
import { GET as solicitudGET, PATCH as solicitudPATCH } from "@/app/api/dashboard/publibordados/solicitudes/[id]/route";

const T1 = "aaaaaaaa-1111-4000-8000-000000000001";
const T2 = "bbbbbbbb-2222-4000-8000-000000000002";
const T3 = "cccccccc-3333-4000-8000-000000000003"; // sin el módulo habilitado
const PN1 = "900000000000001";
const PN2 = "900000000000002";
const PN3 = "900000000000003";
const JUAN = "573000000001";
const ANA = "573000000002";

const MIEMBROS = [
  { id: 1, tenant_id: T1, user_id: "u-admin-1", rol: "admin", estado: "activo", email: "ana@pb.test", nombre: "Ana" },
  { id: 2, tenant_id: T1, user_id: "u-agente-1", rol: "agente", estado: "activo", email: "carlos@pb.test", nombre: "Carlos" },
  { id: 3, tenant_id: T1, user_id: "u-lectura-1", rol: "lectura", estado: "activo", email: "luz@pb.test", nombre: "Luz" },
  { id: 4, tenant_id: T2, user_id: "u-agente-2", rol: "agente", estado: "activo", email: "otro@b.test", nombre: "Ajeno" },
  { id: 5, tenant_id: T1, user_id: "u-sus-1", rol: "agente", estado: "suspendido", email: "sus@pb.test", nombre: "Suspendida" },
  { id: 6, tenant_id: T3, user_id: "u-admin-3", rol: "admin", estado: "activo", email: "c@c.test", nombre: "Tercero" },
];

let base: BasePrueba;
let db: SupabaseMemoria;

const FUNCIONES = [
  "dulabs_pb_registrar_solicitud",
  "dulabs_pb_listar_solicitudes",
  "dulabs_pb_listar_clientes",
  "dulabs_pb_obtener_cliente",
  "dulabs_pb_obtener_solicitud",
  "dulabs_pb_actualizar_solicitud",
];

/** Ejecución REAL del Flow en Postgres (lo que el orquestador guarda antes de despachar la acción). */
function ejecucion(tenant: string, pn: string, tel: string, wamid?: string): string {
  const id = randomUUID();
  base.sql(
    `insert into dulabs_flow_executions (tenant_id, id, flow_id, flow_version_id, execution_id, phone_number_id, telefono_cliente, status, current_node_id, metadata)
     values ('${tenant}', '${id}', gen_random_uuid(), gen_random_uuid(), '${id}', '${pn}', '${tel}', 'waiting_effect', 'act-registrar-solicitud', '${wamid ? JSON.stringify({ lastEventId: wamid }) : "{}"}')`,
  );
  return id;
}

const DATOS = {
  juanGorras: { tipo_cliente: "persona_natural", nombre: "Juan Pérez", nombre_empresa: "", producto: "gorras", cantidad: "20" },
  juanUniformes: { tipo_cliente: "persona_natural", nombre: "Juan Pérez", nombre_empresa: "", producto: "uniformes", cantidad: "50" },
  juanEmpresa: { tipo_cliente: "empresa", nombre: "Juan Pérez", nombre_empresa: "Textiles SAS", producto: "otros", cantidad: "06" },
  anaEmpresa: { tipo_cliente: "empresa", nombre: "Ana Gómez", nombre_empresa: "Bordados Ana", producto: "prendas_de_vestir", cantidad: "12" },
};

async function registrar(tenant: string, pn: string, tel: string, campos: Record<string, string>, wamid?: string, execId?: string) {
  const flowExecutionId = execId ?? ejecucion(tenant, pn, tel, wamid);
  const r = await registrarSolicitudPublibordados({ supabase: supabaseAdmin(), tenantId: tenant, phoneNumberId: pn, telefonoCliente: tel, flowExecutionId, campos });
  return { ...r, flowExecutionId };
}

const req = (url: string, token?: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? "GET",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.body ? { "content-type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });
/** Unión de las formas de respuesta de las rutas (listas, ficha de cliente, solicitud, error). */
type Cuerpo = { total: number; paginas: number; filas: Array<Cliente & Solicitud>; solicitud: Solicitud; error?: string } & ClienteDetalle;
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Cuerpo });

const solicitudes = async (qs = "", token = "t-admin-1") => json(await solicitudesGET(req(`/api/dashboard/publibordados/solicitudes${qs}`, token)));
const solicitud = async (id: number | string, token = "t-admin-1") => json(await solicitudGET(req(`/x`, token), params(id)));
const patch = async (id: number | string, body: unknown, token = "t-admin-1") => json(await solicitudPATCH(req(`/x`, token, { method: "PATCH", body }), params(id)));
const clientes = async (qs = "", token = "t-admin-1") => json(await clientesGET(req(`/api/dashboard/publibordados/clientes${qs}`, token)));
const cliente = async (id: number | string, token = "t-admin-1") => json(await clienteGET(req(`/x`, token), params(id)));

describe("Publi Bordados — Cliente → Solicitudes (Postgres real)", { skip: !HAY_POSTGRES && "requiere PB_TEST_PSQL (PostgreSQL local efímero)" }, () => {
  before(() => {
    base = crearBasePrueba();
    base.sql(`insert into dulabs_clientes_config (id_tenant, phone_number_id) values ('${T1}', '${PN1}'), ('${T2}', '${PN2}'), ('${T3}', '${PN3}')`);
    for (const m of MIEMBROS) {
      base.sql(`insert into dulabs_miembros_equipo (id, tenant_id, email, nombre, rol, estado) overriding system value values (${m.id}, '${m.tenant_id}', '${m.email}', '${m.nombre}', '${m.rol}', '${m.estado}')`);
    }
  });
  after(() => base?.borrar());

  beforeEach(() => {
    base.sql("delete from dulabs_pb_solicitudes; delete from dulabs_clientes_conocidos; delete from dulabs_flow_executions; delete from dulabs_mensajes_log;");
    db = installSupabaseMemoria(process.env.SUPABASE_URL);
    db.table("dulabs_miembros_equipo").push(...MIEMBROS.map((m) => ({ ...m, created_at: `2026-01-0${m.id}T00:00:00Z` })));
    for (const m of MIEMBROS) db.user(`t-${m.user_id.slice(2)}`, m.user_id);
    db.user("t-sin-equipo", "u-nadie");
    db.table("dulabs_tenant_modulos").push(
      { id_tenant: T1, modulo: "publibordados_clientes", habilitado: true },
      { id_tenant: T2, modulo: "publibordados_clientes", habilitado: true },
    );
    db.table("dulabs_clientes_config").push({ id_tenant: T1, phone_number_id: PN1 }, { id_tenant: T2, phone_number_id: PN2 }, { id_tenant: T3, phone_number_id: PN3 });
    for (const fn of FUNCIONES) db.rpc(fn, (args) => base.rpc(fn, args));
  });
  afterEach(() => db.uninstall());

  // ---------------------------------------------------------------------------
  describe("creación desde el Flow", () => {
    it("1/5. cliente nuevo + solicitud nueva (persona natural), estado Nuevo, sin empresa", async () => {
      const r = await registrar(T1, PN1, JUAN, DATOS.juanGorras, "wamid.J1");
      assert.ok(r.ok && r.creado);
      const { status, body } = await solicitudes();
      assert.equal(status, 200);
      assert.equal(body.total, 1);
      const s = body.filas[0];
      assert.equal(s.nombre, "Juan Pérez");
      assert.equal(s.tipoCliente, "persona_natural");
      assert.equal(s.nombreEmpresa, null);
      assert.equal(s.producto, "gorras");
      assert.equal(s.productoEtiqueta, "Gorras");
      assert.equal(s.cantidad, 20);
      assert.equal(s.estado, "nuevo");
      assert.equal(s.asesor, null);
      assert.equal(s.telefono, JUAN);
    });

    it("2/3/19. mismo cliente: 2ª y 3ª solicitud SIN crear otro cliente; historial más reciente primero", async () => {
      const a = await registrar(T1, PN1, JUAN, DATOS.juanGorras);
      const b = await registrar(T1, PN1, JUAN, DATOS.juanUniformes);
      const c = await registrar(T1, PN1, JUAN, DATOS.juanEmpresa);
      assert.ok(a.ok && b.ok && c.ok);
      assert.equal(base.sql(`select count(*) from dulabs_clientes_conocidos where telefono_cliente = '${JUAN}'`), "1");
      const lista = await clientes();
      assert.equal(lista.body.total, 1);
      assert.equal(lista.body.filas[0].totalSolicitudes, 3);
      const ficha = await cliente(lista.body.filas[0].id);
      assert.equal(ficha.status, 200);
      // 17. Más reciente → más antigua.
      assert.deepEqual(ficha.body.solicitudes.map((s: { producto: string }) => s.producto), ["otros", "uniformes", "gorras"]);
      assert.deepEqual(ficha.body.solicitudes.map((s: { cantidad: number }) => s.cantidad), [6, 50, 20]);
      // 6. El perfil es el de la última solicitud (declaró empresa).
      assert.equal(ficha.body.cliente.tipoCliente, "empresa");
      assert.equal(ficha.body.cliente.nombreEmpresa, "Textiles SAS");
    });

    it("4/6. dos clientes distintos; empresa guarda su nombre de empresa", async () => {
      await registrar(T1, PN1, JUAN, DATOS.juanGorras);
      await registrar(T1, PN1, ANA, DATOS.anaEmpresa);
      const lista = await clientes();
      assert.equal(lista.body.total, 2);
      const ana = lista.body.filas.find((c) => c.telefono === ANA)!;
      assert.equal(ana.tipoCliente, "empresa");
      assert.equal(ana.nombreEmpresa, "Bordados Ana");
      assert.equal(ana.ultimaSolicitud?.productoEtiqueta, "Prendas de vestir");
    });

    it("9/10/22. idempotencia: la MISMA ejecución (reintento de Meta / efecto repetido) no duplica", async () => {
      const r1 = await registrar(T1, PN1, JUAN, DATOS.juanGorras, "wamid.J1");
      const r2 = await registrar(T1, PN1, JUAN, DATOS.juanGorras, "wamid.J1", r1.flowExecutionId);
      assert.ok(r1.ok && r2.ok);
      assert.equal(r1.registroId, r2.registroId);
      assert.equal(r1.creado, true);
      assert.equal(r2.creado, false);
      assert.equal((await solicitudes()).body.total, 1);
    });

    it("23. trazabilidad: la solicitud apunta a la ejecución REAL y al wamid que la completó", async () => {
      const r = await registrar(T1, PN1, JUAN, DATOS.juanGorras, "wamid.HBgMNTczMDAwMDAwMDAx");
      assert.ok(r.ok);
      const s = await solicitud(r.registroId);
      assert.equal(s.body.solicitud.flowExecutionId, r.flowExecutionId);
      assert.equal(s.body.solicitud.eventoId, "wamid.HBgMNTczMDAwMDAwMDAx");
    });

    it("23b. sin ejecución real (o de otra conversación) no se registra nada", async () => {
      const r = await registrarSolicitudPublibordados({
        supabase: supabaseAdmin(), tenantId: T1, phoneNumberId: PN1, telefonoCliente: JUAN, flowExecutionId: randomUUID(), campos: DATOS.juanGorras,
      });
      assert.deepEqual(r, { ok: false, motivo: "pb_ejecucion_inexistente", reintentable: false });
      const deAna = ejecucion(T1, PN1, ANA);
      const r2 = await registrarSolicitudPublibordados({ supabase: supabaseAdmin(), tenantId: T1, phoneNumberId: PN1, telefonoCliente: JUAN, flowExecutionId: deAna, campos: DATOS.juanGorras });
      assert.equal(r2.ok, false);
      assert.equal((await solicitudes()).body.total, 0);
    });

    it("20. datos incompletos o inválidos: se rechazan sin guardar nada (no reintentable)", async () => {
      const invalidos: Array<Record<string, string>> = [
        { tipo_cliente: "empresa", nombre: "Ana", nombre_empresa: "", producto: "gorras", cantidad: "5" },
        { tipo_cliente: "persona_natural", nombre: "Ana", producto: "gorras", cantidad: "0" },
        { tipo_cliente: "persona_natural", nombre: "Ana", producto: "sombreros", cantidad: "5" },
        { tipo_cliente: "persona_natural", nombre: "   ", producto: "gorras", cantidad: "5" },
      ];
      for (const campos of invalidos) {
        const r = await registrar(T1, PN1, ANA, campos);
        assert.equal(r.ok, false, JSON.stringify(campos));
        assert.equal(!r.ok && r.reintentable, false);
      }
      const faltantes = await registrarSolicitudPublibordados({
        supabase: supabaseAdmin(), tenantId: T1, phoneNumberId: PN1, telefonoCliente: ANA, flowExecutionId: ejecucion(T1, PN1, ANA), campos: { nombre: "Ana" },
      });
      assert.deepEqual(faltantes, { ok: false, motivo: "datos_incompletos", reintentable: false });
      assert.equal((await solicitudes()).body.total, 0);
    });

    it("21. fallo al crear (migración ausente): se informa como no reintentable, nunca como éxito", async () => {
      db.rpc("dulabs_pb_registrar_solicitud", () => ({ error: { code: "PGRST202", message: "Could not find the function" } }));
      const r = await registrar(T1, PN1, JUAN, DATOS.juanGorras);
      assert.deepEqual({ ok: r.ok, motivo: !r.ok && r.motivo }, { ok: false, motivo: "migracion_pendiente" });
    });
  });

  // ---------------------------------------------------------------------------
  describe("acción genérica registrar_en_modulo (InternalActionExecutor real)", () => {
    const accion = publibordadosFlow().nodes.find((n) => n.id === "act-registrar-solicitud")!;
    const ejecutor = () =>
      new InternalActionExecutor({
        supabase: supabaseAdmin(),
        authorizer: createSupabaseInternalActionAuthorizer(supabaseAdmin()),
        registrosDeModulo: REGISTROS_FLOW_POR_MODULO,
      } as unknown as InternalActionDeps);
    const despacho = (tenant: string, pn: string, tel: string, execId: string, variables: Record<string, unknown>): EffectDispatchRequest => ({
      effectId: randomUUID(), executionRowId: execId, tenantId: tenant, nodeId: accion.id, kind: "action", attempt: 1,
      action: accion.type === "action" ? accion.config : undefined, payload: variables, conversation: { phoneNumberId: pn, telefonoCliente: tel },
    });
    const variablesJuan = { tipo_cliente: "persona_natural", nombre: "Juan Pérez", nombre_empresa: "", producto: "gorras", cantidad: "20", otra: "no se envía" };

    it("el flow real registra la solicitud; el reintento del mismo efecto no duplica (10/22)", async () => {
      const exec = ejecucion(T1, PN1, JUAN, "wamid.X");
      const r1 = await ejecutor().dispatch(despacho(T1, PN1, JUAN, exec, variablesJuan), { tenantId: T1, internal: true });
      const r2 = await ejecutor().dispatch(despacho(T1, PN1, JUAN, exec, variablesJuan), { tenantId: T1, internal: true });
      assert.equal(r1.classification, EFFECT_RESULT_CLASSIFICATIONS.SUCCESS);
      assert.equal(r2.classification, EFFECT_RESULT_CLASSIFICATIONS.SUCCESS);
      assert.equal(r1.data?.registroId, r2.data?.registroId);
      assert.deepEqual([r1.data?.registroCreado, r2.data?.registroCreado], [true, false]);
      assert.equal((await solicitudes()).body.total, 1);
    });

    it("12. número de otro tenant → SECURITY_REJECTED; módulo no habilitado (T3) → SECURITY_REJECTED; nada se guarda", async () => {
      const r = await ejecutor().dispatch(despacho(T1, PN2, JUAN, ejecucion(T1, PN2, JUAN), variablesJuan), { tenantId: T1, internal: true });
      assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
      const r3 = await ejecutor().dispatch(despacho(T3, PN3, JUAN, ejecucion(T3, PN3, JUAN), variablesJuan), { tenantId: T3, internal: true });
      assert.equal(r3.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
      assert.equal(r3.error, "modulo_no_habilitado");
      assert.equal(base.sql("select count(*) from dulabs_pb_solicitudes"), "0");
    });

    it("21. datos inválidos → NON_RETRYABLE (el flow sigue por la rama de fallo al traspaso)", async () => {
      const r = await ejecutor().dispatch(despacho(T1, PN1, JUAN, ejecucion(T1, PN1, JUAN), { ...variablesJuan, cantidad: "0" }), { tenantId: T1, internal: true });
      assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
      assert.equal(r.success, false);
    });
  });

  // ---------------------------------------------------------------------------
  describe("estado y asesor por solicitud", () => {
    it("7/8. estados y asesores independientes: cambiar la #2 no toca la #1", async () => {
      const a = await registrar(T1, PN1, JUAN, DATOS.juanGorras);
      const b = await registrar(T1, PN1, JUAN, DATOS.juanUniformes);
      assert.ok(a.ok && b.ok);
      const r1 = await patch(a.registroId, { version: 1, estado: "atendido", asesorId: 1 });
      const r2 = await patch(b.registroId, { version: 1, estado: "en_atencion", asesorId: 2 }, "t-agente-1");
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      assert.deepEqual([r1.body.solicitud.estado, r1.body.solicitud.asesor], ["atendido", { id: 1, nombre: "Ana" }]);
      assert.deepEqual([r2.body.solicitud.estado, r2.body.solicitud.asesor], ["en_atencion", { id: 2, nombre: "Carlos" }]);
      const ficha = await cliente(r1.body.solicitud.clienteId);
      const porId = new Map(ficha.body.solicitudes.map((s) => [s.id, s]));
      assert.equal(porId.get(Number(a.registroId))?.estado, "atendido");
      assert.equal(porId.get(Number(b.registroId))?.estado, "en_atencion");
      // Una solicitud nueva del mismo cliente nace Nuevo y sin asesor.
      const c = await registrar(T1, PN1, JUAN, DATOS.juanEmpresa);
      const nueva = await solicitud(c.ok ? c.registroId : 0);
      assert.deepEqual([nueva.body.solicitud.estado, nueva.body.solicitud.asesor], ["nuevo", null]);
      assert.equal((await solicitud(a.registroId)).body.solicitud.estado, "atendido", "la #1 sigue igual");
    });

    it("11. concurrencia: dos asesoras con la misma versión → la segunda recibe 409 y nada se pisa", async () => {
      const a = await registrar(T1, PN1, JUAN, DATOS.juanGorras);
      assert.ok(a.ok);
      const ana = await patch(a.registroId, { version: 1, estado: "en_atencion", asesorId: 1 });
      const carlos = await patch(a.registroId, { version: 1, estado: "atendido", asesorId: 2 }, "t-agente-1");
      assert.equal(ana.status, 200);
      assert.equal(carlos.status, 409);
      const actual = (await solicitud(a.registroId)).body.solicitud;
      assert.deepEqual([actual.estado, actual.asesor?.id, actual.version], ["en_atencion", 1, 2]);
    });

    it("11b. una nueva solicitud del Flow mientras la asesora edita otra: ninguna operación pisa a la otra", async () => {
      const a = await registrar(T1, PN1, JUAN, DATOS.juanGorras);
      assert.ok(a.ok);
      const [edicion, nueva] = await Promise.all([patch(a.registroId, { version: 1, estado: "en_atencion", asesorId: 2 }), registrar(T1, PN1, JUAN, DATOS.juanUniformes)]);
      assert.equal(edicion.status, 200);
      assert.ok(nueva.ok && nueva.creado);
      assert.equal((await solicitud(a.registroId)).body.solicitud.estado, "en_atencion");
      assert.equal((await solicitud(nueva.ok ? nueva.registroId : 0)).body.solicitud.estado, "nuevo");
    });

    it("asesor de otro tenant o suspendido → 400; valores fuera del contrato → 400", async () => {
      const a = await registrar(T1, PN1, JUAN, DATOS.juanGorras);
      assert.ok(a.ok);
      assert.equal((await patch(a.registroId, { version: 1, asesorId: 4 })).status, 400);
      assert.equal((await patch(a.registroId, { version: 1, asesorId: 5 })).status, 400);
      assert.equal((await patch(a.registroId, { version: 1, estado: "cerrado" })).status, 400);
      assert.equal((await patch(a.registroId, { estado: "atendido" })).status, 400, "sin versión");
      assert.equal((await patch(a.registroId, { version: 1, cantidad: 99 })).status, 400, "cantidad no es editable");
      assert.equal((await patch(a.registroId, { version: 1, id_tenant: T2 })).status, 400, "el tenant nunca viene del request");
      assert.equal((await solicitud(a.registroId)).body.solicitud.version, 1, "nada cambió");
    });

    it("quitar el asesor", async () => {
      const a = await registrar(T1, PN1, JUAN, DATOS.juanGorras);
      assert.ok(a.ok);
      await patch(a.registroId, { version: 1, asesorId: 2 });
      const r = await patch(a.registroId, { version: 2, asesorId: null });
      assert.equal(r.status, 200);
      assert.equal(r.body.solicitud.asesor, null);
      assert.equal(r.body.solicitud.asignadoAt, null);
    });
  });

  // ---------------------------------------------------------------------------
  describe("seguridad multi-tenant y permisos", () => {
    it("12/13/14. otro tenant no lista, no ve, no modifica; el cliente de T1 no existe para T2", async () => {
      const a = await registrar(T1, PN1, JUAN, DATOS.juanGorras);
      await registrar(T2, PN2, JUAN, { ...DATOS.juanGorras, nombre: "Juan de T2" });
      assert.ok(a.ok);
      const deT2 = await solicitudes("", "t-agente-2");
      assert.equal(deT2.body.total, 1);
      assert.ok(!JSON.stringify(deT2.body).includes("Juan Pérez"));
      assert.equal((await solicitud(a.registroId, "t-agente-2")).status, 404);
      assert.equal((await patch(a.registroId, { version: 1, estado: "atendido" }, "t-agente-2")).status, 404);
      assert.equal((await solicitud(a.registroId)).body.solicitud.estado, "nuevo", "T2 no cambió nada");
      const idCliente = (await solicitud(a.registroId)).body.solicitud.clienteId;
      assert.equal((await cliente(idCliente, "t-agente-2")).status, 404);
      assert.equal((await clientes("", "t-agente-2")).body.total, 1);
    });

    it("sin sesión 401; sin equipo 403; módulo no habilitado 403; lectura no edita 403; id manipulado 404", async () => {
      const a = await registrar(T1, PN1, JUAN, DATOS.juanGorras);
      assert.ok(a.ok);
      assert.equal((await solicitudesGET(req("/api/dashboard/publibordados/solicitudes"))).status, 401);
      assert.equal((await solicitudes("", "t-sin-equipo")).status, 403);
      assert.equal((await solicitudes("", "t-admin-3")).status, 403);
      assert.equal((await clientes("", "t-admin-3")).status, 403);
      assert.equal((await solicitud(a.registroId, "t-lectura-1")).status, 200, "lectura sí ve");
      assert.equal((await patch(a.registroId, { version: 1, estado: "atendido" }, "t-lectura-1")).status, 403);
      for (const id of ["abc", "0", "-1", "1e3", "999999999", "1;drop"]) assert.equal((await solicitud(id)).status, 404, id);
      assert.equal((await cliente("abc")).status, 404);
    });
  });

  // ---------------------------------------------------------------------------
  describe("listados", () => {
    it("15. paginación de 25 en la base de datos (total real en cualquier página)", async () => {
      for (let i = 0; i < 30; i++) await registrar(T1, PN1, `57310000${String(i).padStart(4, "0")}`, { ...DATOS.juanGorras, nombre: `Cliente ${i}` });
      const p1 = await solicitudes("?pagina=1");
      const p2 = await solicitudes("?pagina=2");
      const p9 = await solicitudes("?pagina=9");
      assert.deepEqual([p1.body.total, p1.body.filas.length, p1.body.paginas], [30, 25, 2]);
      assert.deepEqual([p2.body.filas.length, p9.body.filas.length, p9.body.total], [5, 0, 30]);
      assert.equal(p1.body.filas[0].nombre, "Cliente 29", "más reciente primero");
      const c1 = await clientes("?pagina=2");
      assert.deepEqual([c1.body.total, c1.body.filas.length], [30, 5]);
    });

    it("16. filtros: estado, tipo, producto, asesor, sin asesor, búsqueda por nombre/empresa/teléfono y fechas", async () => {
      const a = await registrar(T1, PN1, JUAN, DATOS.juanGorras);
      const b = await registrar(T1, PN1, JUAN, DATOS.juanUniformes);
      await registrar(T1, PN1, ANA, DATOS.anaEmpresa);
      assert.ok(a.ok && b.ok);
      await patch(b.registroId, { version: 1, estado: "en_atencion", asesorId: 2 });
      const total = async (qs: string) => (await solicitudes(qs)).body.total;
      assert.equal(await total("?estado=nuevo"), 2);
      assert.equal(await total("?estado=en_atencion"), 1);
      assert.equal(await total("?tipo=empresa"), 1);
      assert.equal(await total("?tipo=persona_natural"), 2);
      assert.equal(await total("?producto=uniformes"), 1);
      assert.equal(await total("?asesor=2"), 1);
      assert.equal(await total("?asesor=ninguno"), 2);
      assert.equal(await total("?q=bordados"), 1);
      assert.equal(await total("?q=JUAN"), 2);
      assert.equal(await total("?q=000 0002"), 1);
      assert.equal(await total("?q=%25"), 0, "el comodín se escapa");
      const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
      assert.equal(await total(`?desde=${hoy}&hasta=${hoy}`), 3);
      assert.equal(await total("?desde=2099-01-01"), 0);
      assert.equal(await total("?estado=cualquiera&tipo=x&asesor=abc"), 3, "valores desconocidos se ignoran");
      assert.equal((await clientes("?tipo=empresa")).body.total, 1);
      assert.equal((await clientes("?q=ana")).body.total, 1);
    });

    it("18. cliente del flujo anterior SIN solicitudes: se muestra con sus datos, sin inventar solicitudes", async () => {
      base.sql(
        `insert into dulabs_clientes_conocidos (id_tenant, phone_number_id, telefono_cliente, nombre, custom_fields)
         values ('${T1}', '${PN1}', '573000000099', '573000000099', '{"pb_tipo_cliente":"empresa","pb_nombre":"Legado","pb_nombre_empresa":"Vieja SAS","pb_producto":"gorras","pb_cantidad":"30"}')`,
      );
      // Un contacto que solo escribió (sin flow completo) NO es cliente del módulo.
      base.sql(`insert into dulabs_clientes_conocidos (id_tenant, phone_number_id, telefono_cliente, nombre) values ('${T1}', '${PN1}', '573000000098', '573000000098')`);
      const lista = await clientes();
      assert.equal(lista.body.total, 1);
      const legado = lista.body.filas[0];
      assert.deepEqual([legado.nombre, legado.nombreEmpresa, legado.totalSolicitudes, legado.ultimaSolicitud], ["Legado", "Vieja SAS", 0, null]);
      const ficha = await cliente(legado.id);
      assert.deepEqual(ficha.body.solicitudes, []);
      assert.deepEqual(ficha.body.cliente.datosAnteriores, { producto: "Gorras", cantidad: "30" });
      assert.equal((await solicitudes()).body.total, 0);
    });

    it("último contacto: último mensaje de la conversación de ESE cliente", async () => {
      const a = await registrar(T1, PN1, JUAN, DATOS.juanGorras);
      assert.ok(a.ok);
      base.sql(`insert into dulabs_mensajes_log (phone_number_id, telefono_cliente, direccion, contenido, created_at) values
        ('${PN1}', '${JUAN}', 'entrante', 'hola', '2026-09-20T10:00:00Z'), ('${PN1}', '${JUAN}', 'saliente', 'ok', '2026-09-21T10:00:00Z'),
        ('${PN2}', '${JUAN}', 'entrante', 'otro negocio', '2026-09-25T10:00:00Z')`);
      const c = (await clientes()).body.filas[0];
      assert.equal(new Date(c.ultimoContactoAt ?? "").toISOString(), "2026-09-21T10:00:00.000Z");
    });
  });
});
