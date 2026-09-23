import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validarServicioPresencial, registrarServicioPresencial, type BodyServicioPresencial } from "@/lib/servicio-presencial";
import { crearSupabaseEnMemoria, type TablasEnMemoria } from "@/lib/test-helpers/supabase-en-memoria";

const T = "tenant-amore";
const PNID = `whatsapp-qr:${T}`;
const AHORA = new Date("2026-09-24T15:00:00-05:00");

const base: BodyServicioPresencial = {
  servicioId: "s-dipping",
  especialistaId: 1263,
  nombreCliente: "Laura",
  idempotencyKey: "k1",
};

function validar(extra: BodyServicioPresencial) {
  return validarServicioPresencial({ ...base, ...extra }, AHORA);
}

function tablas(): TablasEnMemoria {
  return {
    dulabs_especialistas: [
      { id: 1263, id_tenant: T, nombre: "Cristal", activo: true },
      { id: 1299, id_tenant: T, nombre: "Antigua", activo: false },
      { id: 5000, id_tenant: "otro-tenant", nombre: "Ajena", activo: true },
    ],
    dulabs_servicios: [
      { id: "s-dipping", id_tenant: T, nombre: "Dipping", precio: 60000, duracion_min: 120, activo: true },
      { id: "s-sin-precio", id_tenant: T, nombre: "Diseño especial", precio: null, duracion_min: 30, activo: true },
      { id: "s-inactivo", id_tenant: T, nombre: "Viejo", precio: 10000, duracion_min: 30, activo: false },
    ],
    dulabs_clientes_conocidos: [{ id: 1, id_tenant: T, phone_number_id: PNID, telefono_cliente: "573001112233", nombre: "Ana Registrada" }],
    dulabs_citas_especialista: [],
  };
}

async function registrar(body: BodyServicioPresencial, t = tablas()) {
  const v = validarServicioPresencial({ ...base, ...body }, AHORA);
  assert.ok(v.ok, v.ok ? "" : v.error);
  const db = crearSupabaseEnMemoria(t);
  const r = await registrarServicioPresencial(db, { idTenant: T, phoneNumberIdCliente: PNID }, v.datos);
  return { r, t };
}

describe("validarServicioPresencial -- datos mínimos, sin inventar nada", () => {
  it("servicio del catálogo sin valor escrito es válido (el precio sale del catálogo después)", () => {
    const v = validar({});
    assert.ok(v.ok);
    assert.equal(v.datos.precio, null);
    assert.equal(v.datos.realizadoEn.getTime(), AHORA.getTime(), "sin hora: ahora");
  });

  it("servicio escrito a mano exige el valor", () => {
    assert.deepEqual(validar({ servicioId: undefined, servicioNombre: "Uñas acrílicas especiales" }), { ok: false, error: "Escribe el valor del servicio" });
    const v = validar({ servicioId: undefined, servicioNombre: "Uñas acrílicas especiales", precio: "95000" });
    assert.ok(v.ok);
    assert.equal(v.datos.precio, 95000);
  });

  it("rechaza lo que no tiene sentido", () => {
    assert.equal(validar({ servicioId: undefined }).ok, false, "sin servicio");
    assert.equal(validar({ precio: -1 }).ok, false);
    assert.equal(validar({ precio: 12.5 }).ok, false);
    assert.equal(validar({ especialistaId: undefined }).ok, false, "sin profesional");
    assert.equal(validar({ nombreCliente: "  " }).ok, false, "sin nombre");
    assert.equal(validar({ telefonoCliente: "123" }).ok, false, "WhatsApp inválido");
    assert.equal(validar({ idempotencyKey: undefined }).ok, false);
    assert.equal(validar({ realizadoEn: "no-es-fecha" }).ok, false);
    assert.equal(validar({ realizadoEn: "2026-09-24T18:00:00-05:00" }).ok, false, "3 horas en el futuro: eso es una cita, no un servicio presencial");
  });

  it("WhatsApp colombiano de 10 dígitos se normaliza con 57; se acepta la hora de hoy más temprano", () => {
    const v = validar({ telefonoCliente: "300 111 2233", realizadoEn: "2026-09-24T10:30:00-05:00" });
    assert.ok(v.ok);
    assert.equal(v.datos.telefonoCliente, "573001112233");
    assert.equal(v.datos.realizadoEn.toISOString(), new Date("2026-09-24T10:30:00-05:00").toISOString());
  });
});

describe("registrarServicioPresencial -- queda como cita COMPLETADA que Contabilidad ya suma", () => {
  it("servicio del catálogo: precio de lista, duración real, completada, sin bloquear agenda", async () => {
    const { r, t } = await registrar({});
    assert.ok(r.ok);
    assert.equal(r.registro.servicio, "Dipping");
    assert.equal(r.registro.precio, 60000);
    assert.equal(r.registro.profesional, "Cristal");
    const cita = t.dulabs_citas_especialista![0]!;
    assert.equal(cita.estado, "completada");
    assert.equal(cita.origen, "presencial");
    assert.equal(cita.precio_total, 60000);
    assert.equal(cita.bloquea_horario, false);
    assert.equal(cita.servicio_id, "s-dipping");
    assert.equal(cita.phone_number_id, PNID);
    assert.equal(new Date(cita.fin as string).getTime() - new Date(cita.inicio as string).getTime(), 120 * 60 * 1000);
  });

  it("valor distinto al de lista y servicio escrito a mano quedan con el valor REAL cobrado", async () => {
    const conDescuento = await registrar({ precio: 50000 });
    assert.ok(conDescuento.r.ok);
    assert.equal(conDescuento.t.dulabs_citas_especialista![0]!.precio_total, 50000);

    const manual = await registrar({ servicioId: undefined, servicioNombre: "Diseño con piedras", precio: 25000 });
    assert.ok(manual.r.ok);
    const cita = manual.t.dulabs_citas_especialista![0]!;
    assert.equal(cita.servicio, "Diseño con piedras");
    assert.equal(cita.servicio_id, null);
    assert.equal(cita.precio_total, 25000);
  });

  it("servicio del catálogo SIN precio y sin valor escrito -> se pide el valor (nunca un ingreso en $0 inventado)", async () => {
    const { r, t } = await registrar({ servicioId: "s-sin-precio" });
    assert.deepEqual(r, { ok: false, status: 400, error: "Ese servicio no tiene precio en el catálogo -- escribe el valor cobrado" });
    assert.equal(t.dulabs_citas_especialista!.length, 0);
  });

  it("profesional o servicio de otro negocio / inactivos -> rechazo, nada se escribe", async () => {
    for (const body of [{ especialistaId: 5000 }, { especialistaId: 1299 }, { servicioId: "s-inactivo" }] as BodyServicioPresencial[]) {
      const { r, t } = await registrar(body);
      assert.equal(r.ok, false);
      assert.equal(t.dulabs_citas_especialista!.length, 0);
    }
  });

  it("WhatsApp de una clienta YA registrada: se vincula con su nombre guardado, nunca se le cambia", async () => {
    const { r, t } = await registrar({ nombreCliente: "Anita", telefonoCliente: "3001112233" });
    assert.ok(r.ok);
    assert.equal(r.registro.nombreCliente, "Ana Registrada");
    assert.equal(r.registro.clienteGuardado, true);
    assert.equal(t.dulabs_clientes_conocidos!.length, 1);
    assert.equal(t.dulabs_clientes_conocidos![0]!.nombre, "Ana Registrada");
  });

  it("clienta nueva con WhatsApp: se guarda SOLO si la administradora lo pide", async () => {
    const sinGuardar = await registrar({ nombreCliente: "Sofía", telefonoCliente: "3109998877" });
    assert.ok(sinGuardar.r.ok);
    assert.equal(sinGuardar.r.registro.clienteGuardado, false);
    assert.equal(sinGuardar.t.dulabs_clientes_conocidos!.length, 1);
    assert.equal(sinGuardar.t.dulabs_citas_especialista![0]!.telefono_cliente, "573109998877");

    const guardando = await registrar({ nombreCliente: "Sofía", telefonoCliente: "3109998877", guardarCliente: true });
    assert.ok(guardando.r.ok);
    assert.equal(guardando.r.registro.clienteGuardado, true);
    const nueva = guardando.t.dulabs_clientes_conocidos!.find((c) => c.telefono_cliente === "573109998877");
    assert.equal(nueva?.nombre, "Sofía");
    assert.equal(nueva?.phone_number_id, PNID, "misma identidad que usa el bot de WhatsApp");
  });

  it("sin WhatsApp: solo el nombre en el registro, ningún cliente creado", async () => {
    const { r, t } = await registrar({ nombreCliente: "Clienta de paso", guardarCliente: true });
    assert.ok(r.ok);
    assert.equal(t.dulabs_citas_especialista![0]!.telefono_cliente, null);
    assert.equal(t.dulabs_clientes_conocidos!.length, 1);
  });
});
