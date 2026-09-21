/**
 * R3 — booking genérico Nylas con DATOS DEL CLIENTE. 100% offline: fake Supabase
 * mínimo (solo dulabs_idempotencia_reservas), store de calendario en memoria y
 * clientes Nylas fake que RECUERDAN lo que se les pidió crear. Prueba que el
 * backend (autoridad) exige los datos requeridos ANTES de tocar el calendario,
 * los normaliza, los lleva al evento y respeta la idempotencia.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearCitaNylasGenerico, type CrearCitaNylasGenericoDeps, type CrearCitaNylasGenericoParams } from "@/lib/agent-compiler/calendar/nylas-generic-booking";
import { createInMemoryCalendarStore } from "@/lib/agent-compiler/calendar/testing/in-memory-calendar-store";
import type { NylasCreateEventParams, NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";
import type { CustomerField } from "@/lib/agent-compiler/spec/types";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

type Fila = Record<string, unknown>;

/** Fake Supabase mínimo: SOLO dulabs_idempotencia_reservas (mismo patrón que nylas-generic-booking.test.ts). */
function supabaseFalso(): SupabaseClient {
  const filas: Fila[] = [];
  const from = (tabla: string) => {
    if (tabla !== "dulabs_idempotencia_reservas") throw new Error(`tabla inesperada: ${tabla}`);
    const filtros: Array<(f: Fila) => boolean> = [];
    let insert: Fila | undefined;
    let update: Fila | undefined;
    const ejecutar = (): { data: Fila[]; error: { code: string; message: string } | null } => {
      if (insert) {
        const nueva = insert;
        if (filas.some((f) => f.id_tenant === nueva.id_tenant && f.idempotency_key === nueva.idempotency_key)) return { data: [], error: { code: "23505", message: "dup" } };
        const fila = { resultado_json: null, ...nueva };
        filas.push(fila);
        return { data: [fila], error: null };
      }
      if (update) {
        for (const f of filas) if (filtros.every((fn) => fn(f))) Object.assign(f, update);
        return { data: [], error: null };
      }
      return { data: filas.filter((f) => filtros.every((fn) => fn(f))), error: null };
    };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), b),
      insert: (f: Fila) => ((insert = f), b),
      update: (c: Fila) => ((update = c), b),
      async maybeSingle() {
        const r = ejecutar();
        return { data: r.data[0] ?? null, error: r.error };
      },
      then: (resolve: (r: { data: Fila[]; error: unknown }) => unknown) => resolve(ejecutar()),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

function fakes() {
  const read: NylasEventsClient & { llamadas: number } = {
    llamadas: 0,
    async listEvents() {
      read.llamadas++;
      return [];
    },
  };
  const write: NylasEventsWriteClient & { pedidos: NylasCreateEventParams[] } = {
    pedidos: [],
    async createEvent(p) {
      write.pedidos.push(p);
      return { id: `evt-${write.pedidos.length}` };
    },
    async deleteEvent() {},
  };
  return { read, write };
}

async function armar(tenants: string[] = [TENANT_A]) {
  const store = createInMemoryCalendarStore();
  for (const t of tenants) {
    await store.saveConnection({
      tenantId: t,
      provider: "nylas",
      grantId: `grant-${t}`,
      accountEmail: "negocio@example.com",
      status: "connected",
      selectedCalendarId: `cal-${t}`,
      selectedCalendarName: "Principal",
      connectedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }
  const f = fakes();
  const supabase = supabaseFalso();
  const deps: CrearCitaNylasGenericoDeps = { supabase, calendarStore: store, nylasApiKey: "k", createNylasEventsClient: () => f.read, createNylasEventsWriteClient: () => f.write };
  return { deps, ...f };
}

const campo = (over: Partial<CustomerField> & Pick<CustomerField, "key" | "type">): CustomerField => ({ label: over.key, required: false, enabled: true, scope: "customer", ...over });
const NOMBRE = campo({ key: "nombreCliente", type: "text", label: "Nombre", required: true });
const TELEFONO = campo({ key: "telefonoCliente", type: "phone", label: "Teléfono", required: true });
const CORREO = campo({ key: "correoCliente", type: "email", label: "Correo" });
const EDAD = campo({ key: "edad", type: "number", label: "Edad", required: true });
const MOTIVO = campo({ key: "motivo", type: "select", label: "Motivo", required: true, scope: "booking", options: ["Primera vez", "Retoque"] });

function params(over: Partial<CrearCitaNylasGenericoParams> = {}): CrearCitaNylasGenericoParams {
  return {
    tenantId: TENANT_A,
    executionRowId: "exec-1",
    effectId: "effect-1",
    fecha: "2026-03-10",
    hora: "14:00",
    nombreCliente: "",
    servicio: "Corte",
    telefonoCliente: "573001112233",
    ...over,
  };
}

describe("R3 — booking genérico con datos del cliente", () => {
  it("1. requerido FALTANTE => datos_incompletos y el calendario NO se toca (ni lectura ni escritura)", async () => {
    const { deps, read, write } = await armar();
    const r = await crearCitaNylasGenerico(deps, params({ customerFields: [NOMBRE, EDAD], customerValues: { nombreCliente: "Ana" } }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.motivo, "datos_incompletos");
      assert.deepEqual(r.faltantes, ["Edad"]);
    }
    assert.equal(read.llamadas, 0);
    assert.equal(write.pedidos.length, 0);
  });

  it("2. requerido INVÁLIDO => datos_invalidos, sin tocar el calendario", async () => {
    const { deps, read, write } = await armar();
    const r = await crearCitaNylasGenerico(deps, params({ customerFields: [NOMBRE, EDAD], customerValues: { nombreCliente: "Ana", edad: "veinte" } }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "datos_invalidos");
    assert.equal(read.llamadas + write.pedidos.length, 0);
  });

  it("3. datos completos => crea el evento con título del nombre del campo y descripción con los datos normalizados", async () => {
    const { deps, write } = await armar();
    const r = await crearCitaNylasGenerico(
      deps,
      params({
        customerFields: [NOMBRE, TELEFONO, CORREO, EDAD, MOTIVO],
        customerValues: { nombreCliente: "  Ana  Pérez ", correoCliente: "ANA@Correo.com", edad: "30,5", motivo: "retoque" },
      }),
    );
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(write.pedidos.length, 1);
    const ev = write.pedidos[0]!;
    assert.equal(ev.title, "Corte -- Ana Pérez");
    assert.equal(ev.description, "Nombre: Ana Pérez\nTeléfono: 573001112233\nCorreo: ana@correo.com\nEdad: 30.5\nMotivo: Retoque");
    assert.equal(ev.calendarId, `cal-${TENANT_A}`, "calendario del tenant, nunca del payload");
    assert.equal(ev.grantId, `grant-${TENANT_A}`);
    if (r.ok) assert.equal(r.datosCliente?.length, 5, "los datos validados viajan en el resultado");
  });

  it("4. el teléfono sale del CANAL: un valor distinto en el payload (IA) se ignora", async () => {
    const { deps, write } = await armar();
    const r = await crearCitaNylasGenerico(deps, params({ customerFields: [NOMBRE, TELEFONO], customerValues: { nombreCliente: "Ana", telefonoCliente: "9999999" } }));
    assert.ok(r.ok);
    assert.match(write.pedidos[0]!.description ?? "", /Teléfono: 573001112233/);
    assert.doesNotMatch(write.pedidos[0]!.description ?? "", /9999999/);
  });

  it("5. opcional inválido NO bloquea y no viaja al evento; opcional ausente tampoco bloquea", async () => {
    const { deps, write } = await armar();
    const r = await crearCitaNylasGenerico(deps, params({ customerFields: [NOMBRE, CORREO], customerValues: { nombreCliente: "Ana", correoCliente: "no-es-correo" } }));
    assert.ok(r.ok);
    assert.equal(write.pedidos[0]!.description, "Nombre: Ana");
    const r2 = await crearCitaNylasGenerico(deps, params({ effectId: "effect-2", customerFields: [NOMBRE, CORREO], customerValues: { nombreCliente: "Eva" } }));
    assert.ok(r2.ok);
  });

  it("6. campo desactivado no se exige ni se guarda", async () => {
    const { deps, write } = await armar();
    const r = await crearCitaNylasGenerico(deps, params({ customerFields: [NOMBRE, { ...EDAD, enabled: false }], customerValues: { nombreCliente: "Ana", edad: "30" } }));
    assert.ok(r.ok);
    assert.equal(write.pedidos[0]!.description, "Nombre: Ana");
  });

  it("7. idempotencia: el MISMO effectId con los mismos datos no duplica el evento y devuelve el mismo citaId", async () => {
    const { deps, write } = await armar();
    const p = params({ customerFields: [NOMBRE], customerValues: { nombreCliente: "Ana" } });
    const a = await crearCitaNylasGenerico(deps, p);
    const b = await crearCitaNylasGenerico(deps, p);
    assert.ok(a.ok && b.ok);
    if (a.ok && b.ok) assert.equal(a.citaId, b.citaId);
    assert.equal(write.pedidos.length, 1, "un único evento en el calendario");
  });

  it("8. el MISMO effectId con datos DISTINTOS es un conflicto, no un replay (la huella incluye los datos)", async () => {
    const { deps, write } = await armar();
    const a = await crearCitaNylasGenerico(deps, params({ customerFields: [NOMBRE, EDAD], customerValues: { nombreCliente: "Ana", edad: "30" } }));
    assert.ok(a.ok);
    const b = await crearCitaNylasGenerico(deps, params({ customerFields: [NOMBRE, EDAD], customerValues: { nombreCliente: "Ana", edad: "31" } }));
    assert.equal(b.ok, false);
    if (!b.ok) assert.equal(b.motivo, "conflicto_reintento");
    assert.equal(write.pedidos.length, 1);
  });

  it("9. sin customerFields (agente previo a R3) el comportamiento es EXACTAMENTE el de antes: nombre del param y notas como descripción", async () => {
    const { deps, write } = await armar();
    const r = await crearCitaNylasGenerico(deps, params({ nombreCliente: "Luis Gómez", notas: "trae referencia" }));
    assert.ok(r.ok);
    assert.equal(write.pedidos[0]!.title, "Corte -- Luis Gómez");
    assert.equal(write.pedidos[0]!.description, "trae referencia");
    if (r.ok) assert.equal(r.datosCliente, undefined);
    // y el nombre sigue siendo obligatorio sin configuración
    const sinNombre = await crearCitaNylasGenerico(deps, params({ effectId: "e-x", nombreCliente: "" }));
    assert.equal(sinNombre.ok, false);
    if (!sinNombre.ok) assert.equal(sinNombre.motivo, "datos_incompletos");
  });

  it("10. las notas de la IA se anexan solo si no hay un campo 'notas' configurado", async () => {
    const { deps, write } = await armar();
    await crearCitaNylasGenerico(deps, params({ customerFields: [NOMBRE], customerValues: { nombreCliente: "Ana" }, notas: "pidió silla" }));
    assert.equal(write.pedidos[0]!.description, "Nombre: Ana\nNotas: pidió silla");
    const notasField = campo({ key: "notas", type: "text", label: "Notas", scope: "booking" });
    await crearCitaNylasGenerico(deps, params({ effectId: "e-2", customerFields: [NOMBRE, notasField], customerValues: { nombreCliente: "Eva", notas: "alergia" }, notas: "ignorada" }));
    assert.equal(write.pedidos[1]!.description, "Nombre: Eva\nNotas: alergia");
  });

  it("11. tenant isolation: cada tenant reserva SOLO en su propio calendario/grant, con sus propios datos", async () => {
    const { deps, write } = await armar([TENANT_A, TENANT_B]);
    await crearCitaNylasGenerico(deps, params({ tenantId: TENANT_A, customerFields: [NOMBRE], customerValues: { nombreCliente: "Ana A" } }));
    await crearCitaNylasGenerico(deps, params({ tenantId: TENANT_B, customerFields: [NOMBRE], customerValues: { nombreCliente: "Beto B" } }));
    assert.equal(write.pedidos[0]!.grantId, `grant-${TENANT_A}`);
    assert.equal(write.pedidos[1]!.grantId, `grant-${TENANT_B}`);
    assert.equal(write.pedidos[0]!.title, "Corte -- Ana A");
    assert.equal(write.pedidos[1]!.title, "Corte -- Beto B");
  });

  it("12. datos inyectados (<script>, saltos de línea) se sanean antes de llegar al calendario", async () => {
    const { deps, write } = await armar();
    // Texto libre (notas): se sanea. (Un NOMBRE con esa forma directamente se rechaza, ver 12b.)
    const NOTAS = campo({ key: "notas", type: "text", label: "Notas", scope: "booking" });
    await crearCitaNylasGenerico(deps, params({ nombreCliente: "Ana", customerFields: [NOMBRE, NOTAS], customerValues: { nombreCliente: "Ana", notas: "Ana\n<script>alert(1)</script>" } }));
    const d = write.pedidos[0]!.description ?? "";
    assert.doesNotMatch(d, /[<>]/);
    assert.equal(d.split("\n").length, 2, "una línea por dato (Nombre + Notas): los saltos inyectados no crean líneas nuevas");
  });

  it("12b. un NOMBRE con forma de inyección/ruido se rechaza (datos_invalidos) y el calendario NO se toca", async () => {
    const { deps, write } = await armar();
    const r = await crearCitaNylasGenerico(deps, params({ customerFields: [NOMBRE], customerValues: { nombreCliente: "Ana\n<script>alert(1)</script>" } }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "datos_invalidos");
    assert.equal(write.pedidos.length, 0);
  });
});
