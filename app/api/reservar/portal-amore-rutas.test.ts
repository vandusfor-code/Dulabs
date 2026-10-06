/**
 * AMORE — rutas HTTP del portal (/api/reservar/{tenant}) llamadas DIRECTAMENTE sobre una Supabase EN MEMORIA (nunca la real): el negocio de AMORE usa el motor real
 * con Google Calendar y FALLA CERRADO sin él; cualquier otro negocio sigue por su camino de siempre (no se toca).
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";
delete process.env.NYLAS_GRANT_ID_AMORE;
delete process.env.NYLAS_API_KEY;

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { GET as bootstrapGET, POST as reservarPOST } from "./[tenant]/route";
import { GET as disponibilidadGET } from "./[tenant]/disponibilidad/route";
import { GET as especialistasGET } from "./[tenant]/especialistas/route";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";

const OTRO_NEGOCIO = "99999999-9999-4999-8999-999999999999";
let db: SupabaseMemoria;
let fetchOriginal: typeof fetch;
let llamadasAfuera: string[];

beforeEach(() => {
  db = installSupabaseMemoria();
  // Cualquier salida a la red que NO sea la base en memoria (Nylas, Meta…) se registra: estas pruebas no deben producir ninguna.
  fetchOriginal = globalThis.fetch;
  llamadasAfuera = [];
  const sobreMemoria = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("http://supabase.memoria")) llamadasAfuera.push(url);
    return sobreMemoria(input, init);
  }) as typeof fetch;
  for (const t of [AMORE_TENANT_ID, OTRO_NEGOCIO]) db.table("dulabs_suscripciones").push({ id_tenant: t, plan: "pro", estado: "activa" });
  // Datos suficientes para que el motor GENÉRICO sí ofreciera algo en AMORE: así se prueba que el portal de AMORE NO lo usa (sin Google Calendar no ofrece nada).
  db.table("dulabs_servicios").push({ id_tenant: AMORE_TENANT_ID, id: "s-dipping", nombre: "Dipping", duracion_min: 120, categoria: "Uñas", activo: true });
  db.table("dulabs_especialistas").push({ id: 1263, id_tenant: AMORE_TENANT_ID, nombre: "Cristal", activo: true });
  db.table("dulabs_servicio_especialista").push({ id_tenant: AMORE_TENANT_ID, servicio_id: "s-dipping", especialista_id: 1263 });
  db.table("dulabs_citas_especialista", { identity: "id" });
  db.table("dulabs_idempotencia_reservas", { unique: [["id_tenant", "idempotency_key"]] });
  db.table("dulabs_cita_enlaces");
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  db.uninstall();
});

const params = (tenant: string) => ({ params: Promise.resolve({ tenant }) });
const post = (tenant: string, body: unknown) => reservarPOST(new NextRequest(`http://localhost/api/reservar/${tenant}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), params(tenant));
const CUERPO = { servicioId: "s-dipping", especialistaId: 1263, fecha: "2030-01-15", hora: "10:00", nombreCliente: "Ana", telefonoCliente: "3148127388", idempotencyKey: "clave-ruta-1" };

describe("AMORE: el portal falla CERRADO sin calendario", () => {
  it("sin la integración de Google Calendar en el entorno: la disponibilidad no ofrece ningún horario y la reserva responde 503 (no se crea nada, no se llama a ninguna API externa)", async () => {
    const disp = await disponibilidadGET(new NextRequest(`http://localhost/api/reservar/${AMORE_TENANT_ID}/disponibilidad?servicioId=s-dipping&fecha=2030-01-15`), params(AMORE_TENANT_ID));
    assert.equal(disp.status, 200);
    assert.deepEqual(await disp.json(), { especialistas: [] });
    const r = await post(AMORE_TENANT_ID, CUERPO);
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /no están disponibles en este momento/);
    assert.equal(db.rows("dulabs_citas_especialista").length, 0);
    assert.equal(db.rows("dulabs_cita_enlaces").length, 0);
    assert.deepEqual(llamadasAfuera, []);
  });

  it("los datos obligatorios se validan antes de todo (400) y un enlace de negocio inválido responde 404, igual que antes", async () => {
    assert.equal((await post(AMORE_TENANT_ID, { ...CUERPO, nombreCliente: "" })).status, 400);
    assert.equal((await post(AMORE_TENANT_ID, { ...CUERPO, idempotencyKey: "" })).status, 400);
    assert.equal((await post(AMORE_TENANT_ID, { ...CUERPO, fecha: "no-es-fecha" })).status, 400);
    assert.equal((await post("no-es-un-uuid", CUERPO)).status, 404);
  });
});

describe("Otros negocios: el portal NO cambia", () => {
  it("un negocio distinto de AMORE sigue por el motor genérico de siempre (aquí: servicio inexistente -> el mismo 409 de siempre) y nunca entra al camino de AMORE", async () => {
    const r = await post(OTRO_NEGOCIO, CUERPO);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, "El servicio seleccionado ya no está disponible.");
    assert.equal(db.rows("dulabs_cita_enlaces").length, 0, "ningún enlace «Mi cita» fuera de AMORE");
    assert.deepEqual(llamadasAfuera, []);
  });

  it("la disponibilidad de otro negocio sigue el motor genérico (sin Nylas ni enlaces)", async () => {
    const disp = await disponibilidadGET(new NextRequest(`http://localhost/api/reservar/${OTRO_NEGOCIO}/disponibilidad?servicioId=s-x&fecha=2030-01-15`), params(OTRO_NEGOCIO));
    assert.equal(disp.status, 200);
    assert.deepEqual(llamadasAfuera, []);
  });
});

// ---------------------------------------------------------------------------
// VARIOS SERVICIOS en una sola cita (manos + pies): las tres rutas aceptan `servicioIds` SOLO para AMORE; cualquier otro negocio sigue con un servicio por cita.
// ---------------------------------------------------------------------------
describe("Varios servicios por cita (AMORE): rutas", () => {
  const MARY = 1262;
  const CRISTAL = 1263;

  beforeEach(() => {
    const servicio = (id: string, nombre: string, duracion_min: number) => ({ id_tenant: AMORE_TENANT_ID, id, nombre, duracion_min, categoria: "Uñas", activo: true });
    db.table("dulabs_servicios").push(servicio("s-manos", "Manos Semi", 60), servicio("s-pies", "Pies Semi", 60), servicio("s-solo-mary", "Maquillaje Suave", 60), servicio("s-cejas", "Cejas", 30));
    db.table("dulabs_especialistas").push({ id: MARY, id_tenant: AMORE_TENANT_ID, nombre: "Mary", activo: true });
    const asociar = (servicio_id: string, ids: number[]) => ids.forEach((especialista_id) => db.table("dulabs_servicio_especialista").push({ id_tenant: AMORE_TENANT_ID, servicio_id, especialista_id }));
    asociar("s-manos", [MARY, CRISTAL]);
    asociar("s-pies", [MARY, CRISTAL]);
    asociar("s-solo-mary", [MARY]);
    asociar("s-cejas", [MARY]);
    // El otro negocio también tiene dos servicios: aun así NO puede combinarlos.
    db.table("dulabs_servicios").push({ id_tenant: OTRO_NEGOCIO, id: "o-1", nombre: "Corte", duracion_min: 30, categoria: "Cabello", activo: true }, { id_tenant: OTRO_NEGOCIO, id: "o-2", nombre: "Tinte", duracion_min: 60, categoria: "Cabello", activo: true });
  });

  const especialistas = (tenant: string, query: string) => especialistasGET(new NextRequest(`http://localhost/api/reservar/${tenant}/especialistas?${query}`), params(tenant));
  const disponibilidad = (tenant: string, query: string) => disponibilidadGET(new NextRequest(`http://localhost/api/reservar/${tenant}/disponibilidad?${query}`), params(tenant));
  const nombres = async (r: Response) => ((await r.json()).especialistas as { nombre: string }[]).map((e) => e.nombre).sort();

  it("el catálogo dice cuántos servicios caben en una cita: 3 en AMORE, 1 en cualquier otro negocio", async () => {
    const amore = await bootstrapGET(new NextRequest(`http://localhost/api/reservar/${AMORE_TENANT_ID}`), params(AMORE_TENANT_ID));
    assert.equal((await amore.json()).maxServiciosPorCita, 3);
    const otro = await bootstrapGET(new NextRequest(`http://localhost/api/reservar/${OTRO_NEGOCIO}`), params(OTRO_NEGOCIO));
    assert.equal((await otro.json()).maxServiciosPorCita, 1);
  });

  it("especialistas: con varios servicios devuelve SOLO a quienes hacen TODOS (manos + pies = Mary y Cristal; con maquillaje suave, solo Mary)", async () => {
    assert.deepEqual(await nombres(await especialistas(AMORE_TENANT_ID, "servicioIds=s-manos,s-pies")), ["Cristal", "Mary"]);
    assert.deepEqual(await nombres(await especialistas(AMORE_TENANT_ID, "servicioIds=s-manos,s-solo-mary")), ["Mary"]);
  });

  it("especialistas: una combinación que nadie hace junta avisa el motivo; un servicio inexistente da lista vacía", async () => {
    // Cejas solo lo hace Mary y el servicio de Cristal-único no existe: se arma otro servicio solo de Cristal.
    db.table("dulabs_servicios").push({ id_tenant: AMORE_TENANT_ID, id: "s-solo-cristal", nombre: "Pestañas", duracion_min: 60, categoria: "Pestañas", activo: true });
    db.table("dulabs_servicio_especialista").push({ id_tenant: AMORE_TENANT_ID, servicio_id: "s-solo-cristal", especialista_id: CRISTAL });
    const sinComun = await (await especialistas(AMORE_TENANT_ID, "servicioIds=s-cejas,s-solo-cristal")).json();
    assert.deepEqual(sinComun, { especialistas: [], motivo: "combinacion_sin_profesional" });
    const inexistente = await (await especialistas(AMORE_TENANT_ID, "servicioIds=s-manos,s-no-existe")).json();
    assert.deepEqual(inexistente, { especialistas: [] });
  });

  it("especialistas: un solo servicio (la forma de siempre: servicioId) responde igual que antes", async () => {
    assert.deepEqual(await nombres(await especialistas(AMORE_TENANT_ID, "servicioId=s-manos")), ["Cristal", "Mary"]);
    assert.deepEqual(await nombres(await especialistas(AMORE_TENANT_ID, "servicioIds=s-manos")), ["Cristal", "Mary"]);
  });

  it("más de 3 servicios -> 400; sin ningún servicio -> 400 con el mismo texto de siempre", async () => {
    const muchos = await especialistas(AMORE_TENANT_ID, "servicioIds=a,b,c,d");
    assert.equal(muchos.status, 400);
    assert.match((await muchos.json()).error, /Máximo 3 servicios/);
    const ninguno = await especialistas(AMORE_TENANT_ID, "");
    assert.equal(ninguno.status, 400);
    assert.equal((await ninguno.json()).error, "Falta servicioId");
    const dispMuchos = await disponibilidad(AMORE_TENANT_ID, "servicioIds=a,b,c,d&fecha=2030-01-15");
    assert.equal(dispMuchos.status, 400);
    assert.match((await dispMuchos.json()).error, /Máximo 3 servicios/);
  });

  it("OTRO negocio: combinar servicios se rechaza (400) en las tres rutas y nunca se llega a su motor", async () => {
    for (const r of [await especialistas(OTRO_NEGOCIO, "servicioIds=o-1,o-2"), await disponibilidad(OTRO_NEGOCIO, "servicioIds=o-1,o-2&fecha=2030-01-15")]) {
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /no permite combinar servicios/);
    }
    const reserva = await post(OTRO_NEGOCIO, { ...CUERPO, servicioId: undefined, servicioIds: ["o-1", "o-2"] });
    assert.equal(reserva.status, 400);
    assert.match((await reserva.json()).error, /no permite combinar servicios/);
    assert.equal(db.rows("dulabs_citas_especialista").length, 0);
  });

  it("OTRO negocio con un solo servicio (servicioId o servicioIds de uno) sigue por su camino de siempre", async () => {
    const r = await post(OTRO_NEGOCIO, { ...CUERPO, servicioId: undefined, servicioIds: ["s-no-existe"] });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, "El servicio seleccionado ya no está disponible.");
  });

  it("disponibilidad de AMORE con varios servicios y SIN calendario: no ofrece nada (falla cerrado), igual que con uno", async () => {
    const r = await disponibilidad(AMORE_TENANT_ID, `servicioIds=s-manos,s-pies&fecha=2030-01-15`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { especialistas: [] });
    assert.deepEqual(llamadasAfuera, []);
  });

  it("reserva de AMORE con varios servicios y SIN calendario: 503 y no se crea nada (falla cerrado)", async () => {
    const r = await post(AMORE_TENANT_ID, { ...CUERPO, servicioId: undefined, servicioIds: ["s-manos", "s-pies"], especialistaId: CRISTAL });
    assert.equal(r.status, 503);
    assert.equal(db.rows("dulabs_citas_especialista").length, 0);
    assert.deepEqual(llamadasAfuera, []);
  });

  it("reserva con servicioIds mal formado (no es lista, más de 3, ids que no son texto) -> 400 antes de tocar nada", async () => {
    for (const servicioIds of ["s-manos,s-pies", ["a", "b", "c", "d"], [123, { x: 1 }]]) {
      const r = await post(AMORE_TENANT_ID, { ...CUERPO, servicioId: undefined, servicioIds });
      assert.equal(r.status, 400, JSON.stringify(servicioIds));
    }
    assert.equal(db.rows("dulabs_citas_especialista").length, 0);
  });

  it("la forma original de la reserva (solo servicioId) sigue funcionando igual: llega al mismo camino de AMORE", async () => {
    const r = await post(AMORE_TENANT_ID, CUERPO);
    assert.equal(r.status, 503, "sin calendario en el entorno de prueba: el mismo rechazo de siempre, no un 400 por la forma del cuerpo");
  });
});
