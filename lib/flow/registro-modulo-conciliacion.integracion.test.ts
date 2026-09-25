/**
 * `registrar_en_modulo` — reintentos, respaldo y CONCILIACIÓN sobre la implementación REAL.
 *
 *   InternalActionExecutor real → barreras reales (autorizador, módulo habilitado) → registro de
 *   módulos real → manejador real del módulo → supabase-js → RPC → PostgreSQL REAL con las
 *   migraciones 20261120000000 (solicitudes) y 20261121000000 (registros de módulo).
 *   Conciliador real y ruta real del dashboard (/api/dashboard/modulos/registros).
 *
 * El mecanismo es GENÉRICO; el único módulo con manejador registrado hoy es el de solicitudes,
 * así que es el que se usa. Lo emulado: la sesión y las tablas que leen las barreras
 * (lib/testing/supabase-rest-memoria), y las fallas inyectadas en la BD.
 *
 * Requiere PB_TEST_PSQL (ver lib/publibordados/testing/postgres-real.ts); sin ella se salta.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { crearBasePrueba, HAY_POSTGRES, type BasePrueba } from "@/lib/publibordados/testing/postgres-real";
import { supabaseAdmin } from "@/lib/supabase";
import { REGISTROS_FLOW_POR_MODULO, conciliacionDeProduccion } from "@/lib/modulos/registros-flow";
import { InternalActionExecutor, type InternalActionDeps } from "@/lib/flow/executors/internal-action-executor";
import { createSupabaseInternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest } from "@/lib/flow/executor-types";
import { crearRegistrosModuloStore, conciliarRegistrosDeModulo } from "@/lib/flow/registro-modulo-conciliacion";
import { crearVerificadorNumeroEstricto } from "@/lib/flow/registro-modulo-procesador";
import { GET as registrosGET, POST as registrosPOST } from "@/app/api/dashboard/modulos/registros/route";

const T1 = "aaaaaaaa-1111-4000-8000-0000000000a1";
const T2 = "bbbbbbbb-2222-4000-8000-0000000000b2";
const PN1 = "910000000000001";
const PN2 = "910000000000002";
const TEL = "573200000001";
const MODULO = "publibordados_clientes";
const CAMPOS = { tipo_cliente: "tipo_cliente", nombre: "nombre", nombre_empresa: "nombre_empresa", producto: "producto", cantidad: "cantidad" };
const VARIABLES = { tipo_cliente: "empresa", nombre: "Ana Gómez", nombre_empresa: "Textiles SAS", producto: "gorras", cantidad: "20" };

const MIEMBROS = [
  { id: 1, tenant_id: T1, user_id: "u-admin-1", rol: "admin", estado: "activo", email: "a@t1.test", nombre: "Ana" },
  { id: 2, tenant_id: T1, user_id: "u-lectura-1", rol: "lectura", estado: "activo", email: "l@t1.test", nombre: "Luz" },
  { id: 3, tenant_id: T2, user_id: "u-admin-2", rol: "admin", estado: "activo", email: "a@t2.test", nombre: "Otro" },
];

const FUNCIONES = [
  "dulabs_pb_registrar_solicitud",
  "dulabs_registro_modulo_abrir",
  "dulabs_registro_modulo_resolver",
  "dulabs_registro_modulo_reclamar",
  "dulabs_registro_modulo_resumen",
  "dulabs_registro_modulo_reencolar",
];

let base: BasePrueba;
let db: SupabaseMemoria;
/** Fallas inyectadas en dulabs_pb_registrar_solicitud: "antes" (no guarda) o "despues" (guarda y la respuesta se pierde). */
let fallas: Array<"antes" | "despues"> = [];

/** Ejecución REAL del flow (el orquestador la guarda antes de despachar la acción). */
function ejecucion(tenant = T1, pn = PN1, tel = TEL, variables: Record<string, unknown> = VARIABLES): string {
  const id = randomUUID();
  base.sql(
    `insert into dulabs_flow_executions (tenant_id, id, flow_id, flow_version_id, execution_id, phone_number_id, telefono_cliente, status, variables)
     values ('${tenant}', '${id}', gen_random_uuid(), gen_random_uuid(), '${id}', '${pn}', '${tel}', 'waiting_effect', '${JSON.stringify(variables).replace(/'/g, "''")}')`,
  );
  return id;
}

function ejecutor() {
  const supabase = supabaseAdmin();
  return new InternalActionExecutor({
    supabase,
    authorizer: createSupabaseInternalActionAuthorizer(supabase),
    registrosDeModulo: REGISTROS_FLOW_POR_MODULO,
    registrosModuloStore: crearRegistrosModuloStore(supabase),
    verificarNumeroRegistro: crearVerificadorNumeroEstricto(supabase),
    esperarMs: async () => {},
  } as unknown as InternalActionDeps);
}

function despachar(execId: string, tenant = T1, pn = PN1, variables: Record<string, unknown> = VARIABLES) {
  const request: EffectDispatchRequest = {
    effectId: `fx-${execId}`,
    executionRowId: execId,
    tenantId: tenant,
    nodeId: "act-registrar-solicitud",
    kind: "action",
    attempt: 1,
    action: { actionType: "registrar_en_modulo", modulo: MODULO, campos: CAMPOS },
    payload: variables,
    conversation: { phoneNumberId: pn, telefonoCliente: TEL },
  } as EffectDispatchRequest;
  return ejecutor().dispatch(request, { tenantId: tenant, internal: true });
}

const conciliar = (tenantId?: string) => conciliarRegistrosDeModulo(conciliacionDeProduccion(supabaseAdmin()), { tenantId });
const solicitudesDe = (execId: string) => Number(base.sql(`select count(*) from dulabs_pb_solicitudes where flow_execution_id = '${execId}'`));
const respaldo = (execId: string) => {
  const fila = base.sql(`select estado || '|' || intentos || '|' || coalesce(ultimo_error, '') from dulabs_registros_modulo where flow_execution_id = '${execId}'`);
  const [estado, intentos, error] = fila.split("|");
  return { estado, intentos: Number(intentos), error };
};
/** El conciliador solo toma filas vencidas: se simula que pasó el tiempo de espera. */
const vencer = () => base.sql("update dulabs_registros_modulo set proximo_intento_at = now() - interval '1 second', lease_hasta = null where estado = 'pendiente'");

const req = (url: string, token: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const resumenApi = async (token = "t-admin-1", modulo = MODULO) => {
  const r = await registrosGET(req(`/api/dashboard/modulos/registros?modulo=${modulo}`, token));
  return { status: r.status, body: (await r.json()) as { pendientes: number; fallidos: number; filas: Array<{ id: number; estado: string; ultimoError: string }>; error?: string } };
};

describe("registrar_en_modulo — reintentos, respaldo y conciliación (Postgres real)", { skip: !HAY_POSTGRES && "requiere PB_TEST_PSQL (PostgreSQL local efímero)" }, () => {
  before(() => {
    base = crearBasePrueba();
    base.sql(`insert into dulabs_clientes_config (id_tenant, phone_number_id) values ('${T1}', '${PN1}'), ('${T2}', '${PN2}')`);
  });
  after(() => base?.borrar());

  beforeEach(() => {
    fallas = [];
    base.sql("delete from dulabs_registros_modulo; delete from dulabs_pb_solicitudes; delete from dulabs_clientes_conocidos; delete from dulabs_flow_executions;");
    db = installSupabaseMemoria(process.env.SUPABASE_URL);
    db.table("dulabs_miembros_equipo").push(...MIEMBROS.map((m) => ({ ...m, created_at: "2026-01-01T00:00:00Z" })));
    for (const m of MIEMBROS) db.user(`t-${m.user_id.slice(2)}`, m.user_id);
    db.table("dulabs_tenant_modulos").push({ id_tenant: T1, modulo: MODULO, habilitado: true }, { id_tenant: T2, modulo: MODULO, habilitado: true });
    db.table("dulabs_clientes_config").push({ id_tenant: T1, phone_number_id: PN1 }, { id_tenant: T2, phone_number_id: PN2 });
    for (const fn of FUNCIONES) {
      db.rpc(fn, (args) => {
        if (fn === "dulabs_pb_registrar_solicitud" && fallas.length) {
          const falla = fallas.shift();
          if (falla === "despues") base.rpc(fn, args); // se guardó de verdad; la respuesta se pierde
          return { error: { code: "08006", message: "connection failure" } };
        }
        return base.rpc(fn, args);
      });
    }
  });
  afterEach(() => db.uninstall());

  it("error transitorio → reintento en línea → UNA solicitud; respaldo 'registrado'", async () => {
    const ex = ejecucion();
    fallas = ["antes"];
    const r = await despachar(ex);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.SUCCESS);
    assert.equal(solicitudesDe(ex), 1);
    assert.equal(respaldo(ex).estado, "registrado");
  });

  it("timeout ambiguo (se guardó, la respuesta se perdió) → el reintento NO duplica (UNIQUE por ejecución)", async () => {
    const ex = ejecucion();
    fallas = ["despues"];
    const r = await despachar(ex);
    assert.deepEqual((r.data as { registroCreado: boolean }).registroCreado, false, "el reintento encontró la que ya existía");
    assert.equal(solicitudesDe(ex), 1);
  });

  it("fallo persistente → pendiente, visible en el dashboard; la conciliación lo registra después", async () => {
    const ex = ejecucion();
    fallas = ["antes", "antes", "antes"];
    const r = await despachar(ex);
    assert.deepEqual([r.classification, r.error], [EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, "registro_pendiente:error_bd"]);
    assert.equal(solicitudesDe(ex), 0);
    assert.deepEqual(respaldo(ex), { estado: "pendiente", intentos: 1, error: "error_bd" });
    const visible = await resumenApi(); // el GET concilia lo vencido; esta fila aún no vence
    assert.deepEqual([visible.status, visible.body.pendientes, visible.body.fallidos], [200, 1, 0]);

    vencer();
    const c = await conciliar();
    assert.deepEqual([c.procesados, c.registrados], [1, 1]);
    assert.equal(solicitudesDe(ex), 1);
    assert.equal(respaldo(ex).estado, "registrado");
    assert.equal((await resumenApi()).body.pendientes, 0);
  });

  it("conciliación repetida (y fila forzada a reprocesar) → idempotente: sigue habiendo UNA solicitud", async () => {
    const ex = ejecucion();
    fallas = ["despues", "antes", "antes"]; // se guardó en el 1er intento, pero el motor no lo supo
    await despachar(ex);
    assert.equal(respaldo(ex).estado, "pendiente");
    vencer();
    await conciliar();
    await conciliar();
    base.sql(`update dulabs_registros_modulo set estado = 'pendiente', proximo_intento_at = now() - interval '1 second' where flow_execution_id = '${ex}'`);
    const c = await conciliar();
    assert.equal(c.registrados, 1);
    assert.equal(solicitudesDe(ex), 1);
    assert.equal(Number(base.sql("select count(*) from dulabs_clientes_conocidos")), 1);
  });

  it("la conciliación usa los datos de la EJECUCIÓN ORIGINAL (no los del respaldo)", async () => {
    const ex = ejecucion(T1, PN1, TEL, { ...VARIABLES, producto: "uniformes", cantidad: "7" });
    fallas = ["antes", "antes", "antes"];
    await despachar(ex, T1, PN1, { ...VARIABLES, producto: "uniformes", cantidad: "7" });
    vencer();
    await conciliar();
    assert.equal(base.sql(`select producto || ':' || cantidad from dulabs_pb_solicitudes where flow_execution_id = '${ex}'`), "uniformes:7");
  });

  it("ejecución inexistente → rechazado: el respaldo no se abre y nada se registra", async () => {
    const fantasma = randomUUID();
    const r = await despachar(fantasma);
    assert.equal(r.success, false);
    assert.equal(Number(base.sql("select count(*) from dulabs_registros_modulo")), 0);
    assert.equal(Number(base.sql("select count(*) from dulabs_pb_solicitudes")), 0);
  });

  it("ejecución purgada antes de conciliar → 'fallido: ejecucion_inexistente' (no se inventa nada)", async () => {
    const ex = ejecucion();
    fallas = ["antes", "antes", "antes"];
    await despachar(ex);
    base.sql(`delete from dulabs_flow_executions where id = '${ex}'`);
    vencer();
    await conciliar();
    assert.deepEqual([respaldo(ex).estado, respaldo(ex).error], ["fallido", "ejecucion_inexistente"]);
    assert.equal(solicitudesDe(ex), 0);
  });

  it("tenant incorrecto (número de otro tenant) → rechazo: ni respaldo ni solicitud", async () => {
    const ex = ejecucion(T1, PN2); // la ejecución dice ser del T1 con el número del T2
    const r = await despachar(ex, T1, PN2);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.equal(Number(base.sql("select count(*) from dulabs_registros_modulo")), 0);
    assert.equal(solicitudesDe(ex), 0);
  });

  it("la conciliación VUELVE a validar: si el número dejó de ser del tenant, queda 'fallido' sin registrar", async () => {
    const ex = ejecucion();
    fallas = ["antes", "antes", "antes"];
    await despachar(ex);
    db.rows("dulabs_clientes_config").splice(0, db.rows("dulabs_clientes_config").length, { id_tenant: T2, phone_number_id: PN1 });
    vencer();
    await conciliar();
    assert.deepEqual([respaldo(ex).estado, respaldo(ex).error], ["fallido", "numero_ajeno"]);
    assert.equal(solicitudesDe(ex), 0);
  });

  it("módulo deshabilitado → no registra en línea; y si se deshabilita antes de conciliar, queda 'fallido' visible (reencolable)", async () => {
    db.rows("dulabs_tenant_modulos")[0].habilitado = false;
    const ex1 = ejecucion();
    const r = await despachar(ex1);
    assert.deepEqual([r.classification, r.error], [EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED, "modulo_no_habilitado"]);
    assert.equal(solicitudesDe(ex1), 0);

    db.rows("dulabs_tenant_modulos")[0].habilitado = true;
    const ex2 = ejecucion();
    fallas = ["antes", "antes", "antes"];
    await despachar(ex2);
    db.rows("dulabs_tenant_modulos")[0].habilitado = false;
    vencer();
    await conciliar();
    assert.deepEqual([respaldo(ex2).estado, respaldo(ex2).error], ["fallido", "modulo_no_habilitado"]);
    assert.equal(solicitudesDe(ex2), 0);
    // Se vuelve a habilitar: el equipo lo reencola desde el dashboard y se registra.
    db.rows("dulabs_tenant_modulos")[0].habilitado = true;
    const { body } = await resumenApi();
    assert.equal(body.fallidos, 1);
    const re = await registrosPOST(req("/api/dashboard/modulos/registros", "t-admin-1", { modulo: MODULO, accion: "reencolar", id: body.filas[0].id }));
    assert.equal(re.status, 200);
    assert.equal(solicitudesDe(ex2), 1);
    assert.equal(respaldo(ex2).estado, "registrado");
  });

  it("error permanente (datos inválidos) → 1 intento, 'fallido' visible con motivo; la conciliación no lo reintenta sola", async () => {
    const malos = { ...VARIABLES, producto: "pelotas" };
    const ex = ejecucion(T1, PN1, TEL, malos);
    const r = await despachar(ex, T1, PN1, malos);
    assert.deepEqual([r.classification, r.error], [EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, "registro_rechazado:datos_invalidos"]);
    assert.deepEqual([respaldo(ex).estado, respaldo(ex).error], ["fallido", "datos_invalidos"]);
    vencer();
    assert.equal((await conciliar()).procesados, 0);
  });

  it("tope de rondas: un transitorio que nunca se resuelve termina 'fallido: reintentos_agotados' (no infinito)", async () => {
    const ex = ejecucion();
    fallas = Array(40).fill("antes");
    await despachar(ex);
    for (let i = 0; i < 15; i++) {
      vencer();
      await conciliar();
    }
    const r = respaldo(ex);
    assert.equal(r.estado, "fallido");
    assert.match(r.error, /^reintentos_agotados:/);
    assert.equal(r.intentos, 12);
  });

  it("la BD falla al verificar el número (no es un 'no'): se trata como transitorio → respaldo pendiente, nunca un rechazo silencioso", async () => {
    const ex = ejecucion();
    db.missing("dulabs_clientes_config"); // la lectura del número falla (error de BD)
    const r = await despachar(ex);
    assert.deepEqual([r.classification, r.error], [EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, "registro_pendiente:numero_no_verificable"]);
    assert.equal(respaldo(ex).estado, "pendiente", "la BD real sí validó el número al abrir el respaldo");
    assert.equal(solicitudesDe(ex), 0);
  });

  it("presupuesto de tiempo agotado: las filas no procesadas quedan con lease y otra ronda las retoma (sin perder ni duplicar)", async () => {
    const ids = [ejecucion(), ejecucion(), ejecucion()];
    fallas = Array(9).fill("antes");
    for (const ex of ids) await despachar(ex);
    vencer();
    let t = 0;
    const r1 = await conciliarRegistrosDeModulo(conciliacionDeProduccion(supabaseAdmin()), { presupuestoMs: 15, ahoraMs: () => (t += 10) });
    assert.equal(r1.procesados, 1, "solo alcanzó para una fila");
    assert.equal(ids.filter((ex) => solicitudesDe(ex) === 1).length, 1);
    assert.equal((await conciliar()).procesados, 0, "las demás siguen con lease: nadie las toma dos veces");
    base.sql("update dulabs_registros_modulo set lease_hasta = now() - interval '1 second'"); // vence el lease
    assert.equal((await conciliar()).registrados, 2);
    assert.deepEqual(ids.map(solicitudesDe), [1, 1, 1]);
  });

  it("dashboard: aislado por tenant, lectura no reprocesa, módulo inválido/deshabilitado rechazado", async () => {
    const ex = ejecucion();
    fallas = ["antes", "antes", "antes"];
    await despachar(ex);
    assert.equal((await resumenApi("t-admin-2")).body.pendientes, 0, "el otro tenant no ve nada");
    assert.equal((await resumenApi("t-lectura-1")).status, 200, "lectura puede ver");
    const post = await registrosPOST(req("/api/dashboard/modulos/registros", "t-lectura-1", { modulo: MODULO, accion: "reprocesar" }));
    assert.equal(post.status, 403, "lectura no puede reprocesar");
    assert.equal((await resumenApi("t-admin-1", "no_existe")).status, 400);
    db.rows("dulabs_tenant_modulos")[0].habilitado = false;
    assert.equal((await resumenApi()).status, 403);
    // Reencolar un id de OTRO tenant: 404 (la función filtra por el tenant de la sesión).
    db.rows("dulabs_tenant_modulos")[0].habilitado = true;
    const id = Number(base.sql(`select id from dulabs_registros_modulo where flow_execution_id = '${ex}'`));
    const ajeno = await registrosPOST(req("/api/dashboard/modulos/registros", "t-admin-2", { modulo: MODULO, accion: "reencolar", id }));
    assert.equal(ajeno.status, 404);
  });
});
