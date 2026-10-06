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
import { POST as reservarPOST } from "./[tenant]/route";
import { GET as disponibilidadGET } from "./[tenant]/disponibilidad/route";
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
