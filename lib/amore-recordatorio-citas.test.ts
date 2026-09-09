/**
 * AMORE (autorizado) -- recordatorio real "1 hora antes". FASE 3 (autorizado,
 * multi-servicio) agregó la lista real de servicios vía
 * obtenerNombresServiciosDeCita: este archivo prueba EXCLUSIVAMENTE esa
 * extensión (construirTextoRecordatorioAmore ya existía sin cambios de
 * comportamiento para 1 servicio). NUNCA WhatsApp/Supabase reales -- todo
 * inyectado con fakes en memoria.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { construirTextoRecordatorioAmore, enviarRecordatorioAmore, type CitaParaRecordatorioAmore } from "@/lib/amore-recordatorio-citas";
import type { Especialista } from "@/lib/especialistas";

const FAKE_SUPABASE = {} as SupabaseClient;

const MARY: Especialista = {
  id: 1262,
  id_tenant: "amore-test",
  phone_number_id: "whatsapp-qr:amore-test",
  nombre: "Mary",
  numero_whatsapp: "",
  servicio: "",
  duracion_min: 0,
  token: "",
  activo: true,
  bloquea_horario: true,
  es_general: false,
  requiere_aprobacion: false,
};

const CITA_BASE: CitaParaRecordatorioAmore = {
  id: 4312,
  especialista_id: 1262,
  telefono_cliente: "573148127388",
  nombre_cliente: "Ana Pérez",
  servicio: "Sombreado de Cejas",
  inicio: "2026-09-09T16:00:00.000Z", // 11:00 a.m. Colombia
};

describe("construirTextoRecordatorioAmore -- lista de servicios", () => {
  it("con UN solo servicio produce EXACTAMENTE el texto de siempre ('Servicio: X'), nunca la lista", () => {
    const texto = construirTextoRecordatorioAmore({
      nombreCliente: "Ana",
      servicios: ["Sombreado de Cejas"],
      profesionalNombre: "Mary",
      fechaEtiqueta: "Miércoles 9 de septiembre",
      horaTexto: "11:00 a. m.",
    });
    assert.match(texto, /Servicio: Sombreado de Cejas\n/);
    assert.doesNotMatch(texto, /Servicios:/);
  });

  it("con 2+ servicios pasa a una lista con viñetas, el resto del mensaje no cambia", () => {
    const texto = construirTextoRecordatorioAmore({
      nombreCliente: "Ana",
      servicios: ["Dipping", "Press On"],
      profesionalNombre: "Mary",
      fechaEtiqueta: "Miércoles 9 de septiembre",
      horaTexto: "11:00 a. m.",
    });
    assert.match(texto, /Servicios:\n- Dipping\n- Press On/);
    assert.match(texto, /Profesional: Mary/);
    assert.match(texto, /Fecha: Miércoles 9 de septiembre/);
    assert.match(texto, /Hora: 11:00 a\. m\./);
  });
});

describe("enviarRecordatorioAmore -- integra obtenerNombresServiciosDeCita", () => {
  it("cita multi-servicio (2+ nombres reales) -- el mensaje enviado lista TODOS, nunca solo cita.servicio", async () => {
    let mensajeEnviado = "";
    const ok = await enviarRecordatorioAmore(FAKE_SUPABASE, "amore-test", CITA_BASE, {
      especialistaPorId: async () => MARY,
      obtenerNombresServiciosDeCita: async () => ["Dipping", "Press On"],
      enviarMensajeWhatsApp: async (params) => {
        mensajeEnviado = params.mensaje;
        return { ok: true, data: { ok: true } } as const;
      },
    });
    assert.equal(ok, true);
    assert.match(mensajeEnviado, /Servicios:\n- Dipping\n- Press On/);
    assert.doesNotMatch(mensajeEnviado, /Sombreado de Cejas/, "nunca mezcla el servicio único de la fila con la lista real del puente");
  });

  it("cita de un solo servicio (obtenerNombresServiciosDeCita devuelve []) -- usa cita.servicio TAL CUAL, comportamiento 100% idéntico al de antes de esta fase", async () => {
    let mensajeEnviado = "";
    const ok = await enviarRecordatorioAmore(FAKE_SUPABASE, "amore-test", CITA_BASE, {
      especialistaPorId: async () => MARY,
      obtenerNombresServiciosDeCita: async () => [],
      enviarMensajeWhatsApp: async (params) => {
        mensajeEnviado = params.mensaje;
        return { ok: true, data: { ok: true } } as const;
      },
    });
    assert.equal(ok, true);
    assert.match(mensajeEnviado, /Servicio: Sombreado de Cejas\n/);
  });

  it("si obtenerNombresServiciosDeCita falla (tabla no disponible aún) -- NUNCA bloquea el recordatorio, cae a cita.servicio", async () => {
    let mensajeEnviado = "";
    const ok = await enviarRecordatorioAmore(FAKE_SUPABASE, "amore-test", CITA_BASE, {
      especialistaPorId: async () => MARY,
      obtenerNombresServiciosDeCita: async () => {
        throw new Error("relation dulabs_cita_servicios does not exist");
      },
      enviarMensajeWhatsApp: async (params) => {
        mensajeEnviado = params.mensaje;
        return { ok: true, data: { ok: true } } as const;
      },
    });
    assert.equal(ok, true, "un error leyendo servicios múltiples NUNCA debe impedir el recordatorio");
    assert.match(mensajeEnviado, /Servicio: Sombreado de Cejas\n/);
  });

  it("sin teléfono real -- nunca envía nada (comportamiento preexistente, sin cambios)", async () => {
    let llamado = false;
    const ok = await enviarRecordatorioAmore(FAKE_SUPABASE, "amore-test", { ...CITA_BASE, telefono_cliente: null }, {
      especialistaPorId: async () => MARY,
      obtenerNombresServiciosDeCita: async () => ["Dipping", "Press On"],
      enviarMensajeWhatsApp: async () => {
        llamado = true;
        return { ok: true, data: { ok: true } } as const;
      },
    });
    assert.equal(ok, false);
    assert.equal(llamado, false);
  });
});

// ---------------------------------------------------------------------------
// CORRECCIÓN (autorizada) -- nombre REAL y ACTUAL del cliente en el
// recordatorio, nunca el valor congelado en nombre_cliente si ese valor
// resulta ser un teléfono (caso real observado en producción: cita 4307,
// nombre_cliente="573148127388", recordatorio mostró "¡Hola 573148127388!").
// ---------------------------------------------------------------------------
describe("CORRECCIÓN (autorizada) -- nombre actual desde dulabs_clientes_conocidos, nunca un teléfono como nombre", () => {
  const CITA_CON_TELEFONO_CONGELADO: CitaParaRecordatorioAmore = { ...CITA_BASE, nombre_cliente: "573148127388" };

  it("Test 5 (obligatorio) -- nombre ACTUAL disponible ('Camila') -- se usa SIEMPRE, aunque nombre_cliente sea el teléfono congelado", async () => {
    let mensajeEnviado = "";
    let llamadaBuscarNombre: { phoneNumberId: string; telefono: string } | undefined;
    const ok = await enviarRecordatorioAmore(FAKE_SUPABASE, "amore-test", CITA_CON_TELEFONO_CONGELADO, {
      especialistaPorId: async () => MARY,
      obtenerNombresServiciosDeCita: async () => [],
      buscarNombreConocido: async (_s, phoneNumberId, telefono) => {
        llamadaBuscarNombre = { phoneNumberId, telefono };
        return "Camila";
      },
      enviarMensajeWhatsApp: async (params) => {
        mensajeEnviado = params.mensaje;
        return { ok: true, data: { ok: true } } as const;
      },
    });
    assert.equal(ok, true);
    assert.match(mensajeEnviado, /¡Hola Camila! 💗/);
    assert.doesNotMatch(mensajeEnviado, /573148127388/, "NUNCA debe mostrar el teléfono como si fuera el nombre");
    assert.deepEqual(llamadaBuscarNombre, { phoneNumberId: "whatsapp-qr:amore-test", telefono: "573148127388" }, "consulta con la MISMA clave sintética real que usa el resto del canal WhatsApp-QR");
  });

  it("Test 6 (obligatorio) -- sin nombre actual (null), pero nombre_cliente YA es un nombre real ('Camila') -- se usa tal cual", async () => {
    let mensajeEnviado = "";
    const ok = await enviarRecordatorioAmore(FAKE_SUPABASE, "amore-test", { ...CITA_BASE, nombre_cliente: "Camila" }, {
      especialistaPorId: async () => MARY,
      obtenerNombresServiciosDeCita: async () => [],
      buscarNombreConocido: async () => null,
      enviarMensajeWhatsApp: async (params) => {
        mensajeEnviado = params.mensaje;
        return { ok: true, data: { ok: true } } as const;
      },
    });
    assert.equal(ok, true);
    assert.match(mensajeEnviado, /¡Hola Camila! 💗/);
  });

  it("Test 7 (obligatorio) -- sin nombre actual Y nombre_cliente es un teléfono -- saludo genérico, NUNCA muestra el número", async () => {
    let mensajeEnviado = "";
    const ok = await enviarRecordatorioAmore(FAKE_SUPABASE, "amore-test", CITA_CON_TELEFONO_CONGELADO, {
      especialistaPorId: async () => MARY,
      obtenerNombresServiciosDeCita: async () => [],
      buscarNombreConocido: async () => null,
      enviarMensajeWhatsApp: async (params) => {
        mensajeEnviado = params.mensaje;
        return { ok: true, data: { ok: true } } as const;
      },
    });
    assert.equal(ok, true);
    assert.match(mensajeEnviado, /^¡Hola! 💗/, "saludo genérico, sin ningún nombre insertado");
    assert.doesNotMatch(mensajeEnviado, /573148127388/, "NUNCA muestra el teléfono como nombre");
  });

  it("Test 8 (regresión) -- nombre actual y nombre_cliente coinciden ('Camila' en ambos) -- sigue funcionando normal", async () => {
    let mensajeEnviado = "";
    const ok = await enviarRecordatorioAmore(FAKE_SUPABASE, "amore-test", { ...CITA_BASE, nombre_cliente: "Camila" }, {
      especialistaPorId: async () => MARY,
      obtenerNombresServiciosDeCita: async () => [],
      buscarNombreConocido: async () => "Camila",
      enviarMensajeWhatsApp: async (params) => {
        mensajeEnviado = params.mensaje;
        return { ok: true, data: { ok: true } } as const;
      },
    });
    assert.equal(ok, true);
    assert.match(mensajeEnviado, /¡Hola Camila! 💗/);
  });

  it("Test 9 (obligatorio) -- si falla la consulta del nombre actual, el recordatorio SIGUE enviándose (fallback a nombre_cliente), nunca falla por completo", async () => {
    let mensajeEnviado = "";
    const ok = await enviarRecordatorioAmore(FAKE_SUPABASE, "amore-test", { ...CITA_BASE, nombre_cliente: "Camila" }, {
      especialistaPorId: async () => MARY,
      obtenerNombresServiciosDeCita: async () => [],
      buscarNombreConocido: async () => {
        throw new Error("error técnico simulado consultando dulabs_clientes_conocidos");
      },
      enviarMensajeWhatsApp: async (params) => {
        mensajeEnviado = params.mensaje;
        return { ok: true, data: { ok: true } } as const;
      },
    });
    assert.equal(ok, true, "un error consultando el nombre actual NUNCA debe impedir el envío del recordatorio");
    assert.match(mensajeEnviado, /¡Hola Camila! 💗/, "cae al fallback disponible (nombre_cliente, que en este caso ya es un nombre real)");
  });

  it("regresión -- sin inyectar buscarNombreConocido (Supabase real no disponible en este fake), cae a nombre_cliente cuando NO parece un teléfono", async () => {
    let mensajeEnviado = "";
    const ok = await enviarRecordatorioAmore(FAKE_SUPABASE, "amore-test", CITA_BASE, {
      especialistaPorId: async () => MARY,
      obtenerNombresServiciosDeCita: async () => [],
      enviarMensajeWhatsApp: async (params) => {
        mensajeEnviado = params.mensaje;
        return { ok: true, data: { ok: true } } as const;
      },
    });
    assert.equal(ok, true);
    assert.match(mensajeEnviado, /¡Hola Ana Pérez! 💗/);
  });
});
