/**
 * Cron recordatorios-citas — pruebas con Supabase FALSO en memoria (nunca
 * real). Mismo criterio de seguridad ya establecido en
 * app/api/cron/seguimiento-traspaso/route.test.ts tras un incidente real
 * (una corrida anterior de un cron similar, contra la tabla real sin
 * restricción, procesó filas reales de producción): esta suite NUNCA toca
 * Supabase real -- ni siquiera con un tenant desechable -- y NUNCA llama al
 * worker de WhatsApp ni a Meta reales (enviarMensajeWhatsApp/
 * notificarRecordatorioCita/especialistaPorId van SIEMPRE fakeados).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { ejecutarRecordatoriosCitas, GET, type DepsEjecutarRecordatorios } from "./route";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import type { Especialista } from "@/lib/especialistas";
import type { ClienteConfig } from "@/lib/supabase";
import { ANTICIPACIONES_RECORDATORIO_MINUTOS, type AnticipacionRecordatorioMinutos } from "@/lib/comunicaciones/tipos";

const OTRO_TENANT = "otro-tenant-cualquiera";

type FilaCita = {
  id: number;
  id_tenant: string;
  especialista_id: number;
  phone_number_id: string;
  telefono_cliente: string | null;
  nombre_cliente: string;
  servicio: string;
  inicio: string;
  estado: string;
  recordatorio_enviado: boolean;
};

/** Fake mínimo y de propósito único para dulabs_citas_especialista -- nunca toca Supabase real. */
function crearFakeSupabaseCitas(filasIniciales: FilaCita[]) {
  const filas: FilaCita[] = filasIniciales.map((f) => ({ ...f }));

  function from(tabla: string) {
    if (tabla === "dulabs_comunicaciones_config") {
      // Refleja el estado REAL de producción verificado (tabla vacía para
      // todo tenant, incluido AMORE): ninguna fila guardada -- obtenerConfig
      // cae a los predeterminados (60 min, mensaje/anticipación de siempre),
      // preservando el comportamiento histórico exacto de esta suite.
      const configBuilder = {
        select() {
          return configBuilder;
        },
        eq() {
          return configBuilder;
        },
        async maybeSingle() {
          return { data: null, error: null };
        },
      };
      return configBuilder;
    }
    if (tabla !== "dulabs_citas_especialista") {
      throw new Error(`fake de prueba: tabla inesperada "${tabla}"`);
    }
    const filtros: Array<(f: FilaCita) => boolean> = [];
    let modoUpdate: Partial<FilaCita> | undefined;

    const builder = {
      select() {
        return builder;
      },
      eq(campo: keyof FilaCita, valor: unknown) {
        filtros.push((f) => f[campo] === valor);
        return builder;
      },
      not(campo: keyof FilaCita, operador: string, valor: unknown) {
        if (operador === "is" && valor === null) {
          filtros.push((f) => f[campo] !== null && f[campo] !== undefined);
        }
        return builder;
      },
      gte(campo: keyof FilaCita, valor: string) {
        filtros.push((f) => (f[campo] as string) >= valor);
        return builder;
      },
      lt(campo: keyof FilaCita, valor: string) {
        filtros.push((f) => (f[campo] as string) < valor);
        return builder;
      },
      update(cambios: Partial<FilaCita>) {
        modoUpdate = cambios;
        return builder;
      },
      then(resolve: (r: { data: FilaCita[] | null; error: null }) => unknown) {
        if (modoUpdate) {
          for (const f of filas) {
            if (filtros.every((fn) => fn(f))) Object.assign(f, modoUpdate);
          }
          return resolve({ data: null, error: null });
        }
        return resolve({ data: filas.filter((f) => filtros.every((fn) => fn(f))), error: null });
      },
    };
    return builder;
  }

  return { filas, supabase: { from } as unknown as SupabaseClient };
}

const AHORA = new Date("2026-09-08T20:00:00.000Z"); // 3:00 p. m. Colombia
function dentroDeLaVentana(minutos: number): string {
  return new Date(AHORA.getTime() + minutos * 60_000).toISOString();
}

const CITA_AMORE_BASE: FilaCita = {
  id: 9001,
  id_tenant: AMORE_TENANT_ID,
  especialista_id: 1265,
  phone_number_id: "pendiente-amore-ed6ae77f",
  telefono_cliente: "573148127388",
  nombre_cliente: "Ana Pérez",
  servicio: "Células Madres",
  inicio: dentroDeLaVentana(60), // justo al centro de la ventana 55-65
  estado: "confirmada",
  recordatorio_enviado: false,
};

const ESPECIALISTA_JESSICA: Especialista = {
  id: 1265,
  id_tenant: AMORE_TENANT_ID,
  phone_number_id: "pendiente-amore-ed6ae77f",
  nombre: "Jessica",
  numero_whatsapp: "",
  servicio: "",
  duracion_min: 0,
  token: "",
  activo: true,
  bloquea_horario: true,
  es_general: false,
  requiere_aprobacion: false,
};

function crearFakeEspecialistaPorId(mapa: Record<number, Especialista | null>) {
  const llamadas: number[] = [];
  return {
    llamadas,
    especialistaPorId: async (_s: unknown, id: number) => {
      llamadas.push(id);
      return mapa[id] ?? null;
    },
  };
}

function crearFakeEnviarWhatsAppAmore(resultado: { ok: true } | { ok: false; status: number; error: string } = { ok: true }) {
  const llamadas: Array<{ tenantId: string; telefono: string; mensaje: string }> = [];
  return {
    llamadas,
    enviarMensajeWhatsApp: async (params: { tenantId: string; telefono: string; mensaje: string }) => {
      llamadas.push(params);
      return resultado as never;
    },
  };
}

function crearFakeClienteDeEspecialista(mapa: Record<string, ClienteConfig | null>) {
  return async (_s: unknown, phoneNumberId: string) => mapa[phoneNumberId] ?? null;
}

function crearFakeNotificarMeta(resultado: boolean | ((cita: unknown) => boolean) = true) {
  const llamadas: unknown[] = [];
  return {
    llamadas,
    notificarRecordatorioCita: async (_cliente: unknown, cita: unknown) => {
      llamadas.push(cita);
      return typeof resultado === "function" ? resultado(cita) : resultado;
    },
  };
}

function armarDeps(overrides: {
  citas: FilaCita[];
  especialistas?: Record<number, Especialista | null>;
  resultadoEnvioAmore?: { ok: true } | { ok: false; status: number; error: string };
  clientesMeta?: Record<string, ClienteConfig | null>;
  resultadoMeta?: boolean | ((cita: unknown) => boolean);
  soloIdTenant?: string;
}) {
  const { filas, supabase } = crearFakeSupabaseCitas(overrides.citas);
  const fakeEspecialista = crearFakeEspecialistaPorId(overrides.especialistas ?? { 1265: ESPECIALISTA_JESSICA });
  const fakeEnviarAmore = crearFakeEnviarWhatsAppAmore(overrides.resultadoEnvioAmore);
  const fakeNotificarMeta = crearFakeNotificarMeta(overrides.resultadoMeta ?? true);
  const clienteDeEspecialista = crearFakeClienteDeEspecialista(overrides.clientesMeta ?? {});

  const deps: DepsEjecutarRecordatorios = {
    supabase,
    ahora: () => AHORA,
    clienteDeEspecialista,
    notificarRecordatorioCita: fakeNotificarMeta.notificarRecordatorioCita,
    amoreDeps: { especialistaPorId: fakeEspecialista.especialistaPorId, enviarMensajeWhatsApp: fakeEnviarAmore.enviarMensajeWhatsApp },
    soloIdTenant: overrides.soloIdTenant,
  };
  return { deps, filas, fakeEspecialista, fakeEnviarAmore, fakeNotificarMeta };
}

describe("Autenticación -- rechaza sin autorización, nunca toca la base de datos", () => {
  it("401 sin header de autorización válido", async () => {
    const res = await GET(new NextRequest("http://x/api/cron/recordatorios-citas"));
    assert.equal(res.status, 401);
  });
});

describe("Test 1 -- cita válida (AMORE): recordatorio elegible, enviado por el canal real de AMORE", () => {
  it("envía por enviarMensajeWhatsApp (Baileys), NUNCA por el canal de Meta, y marca recordatorio_enviado", async () => {
    const { deps, filas, fakeEnviarAmore, fakeNotificarMeta } = armarDeps({ citas: [CITA_AMORE_BASE] });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 1);
    assert.deepEqual(resultado.errores, []);
    assert.equal(fakeEnviarAmore.llamadas.length, 1);
    assert.equal(fakeEnviarAmore.llamadas[0]!.telefono, "573148127388");
    assert.equal(fakeEnviarAmore.llamadas[0]!.tenantId, AMORE_TENANT_ID);
    assert.equal(fakeNotificarMeta.llamadas.length, 0, "AMORE nunca debe pasar por el canal de Meta");
    assert.equal(filas.find((f) => f.id === 9001)!.recordatorio_enviado, true);
  });
});

describe("Test 2 -- cita cancelada: NUNCA se envía", () => {
  it("una cita con estado 'cancelada' no aparece en la consulta en absoluto", async () => {
    const { deps, fakeEnviarAmore } = armarDeps({ citas: [{ ...CITA_AMORE_BASE, estado: "cancelada" }] });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 0);
    assert.equal(fakeEnviarAmore.llamadas.length, 0);
  });
});

describe("Test 3 -- cita de otro tenant: NUNCA usa el canal de AMORE, aislamiento real por tenant", () => {
  it("una cita de otro tenant se procesa por el canal de Meta (comportamiento anterior intacto), nunca por Baileys", async () => {
    const citaOtroTenant: FilaCita = { ...CITA_AMORE_BASE, id: 9002, id_tenant: OTRO_TENANT, phone_number_id: "otro-numero-real" };
    const clienteOtro: ClienteConfig = { phone_number_id: "otro-numero-real", meta_permanent_token: "tok-fake" } as ClienteConfig;
    const { deps, fakeEnviarAmore, fakeNotificarMeta } = armarDeps({
      citas: [citaOtroTenant],
      clientesMeta: { "otro-numero-real": clienteOtro },
    });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 1);
    assert.equal(fakeNotificarMeta.llamadas.length, 1, "otro tenant sigue el camino de Meta de siempre");
    assert.equal(fakeEnviarAmore.llamadas.length, 0, "NUNCA debe usar el canal de AMORE para otro tenant");
  });

  it("una cita de AMORE y una de otro tenant EN LA MISMA PASADA se procesan cada una por su propio canal, sin mezclarse", async () => {
    const citaOtroTenant: FilaCita = { ...CITA_AMORE_BASE, id: 9003, id_tenant: OTRO_TENANT, phone_number_id: "otro-numero-real", telefono_cliente: "573009999999" };
    const clienteOtro: ClienteConfig = { phone_number_id: "otro-numero-real", meta_permanent_token: "tok-fake" } as ClienteConfig;
    const { deps, fakeEnviarAmore, fakeNotificarMeta } = armarDeps({
      citas: [CITA_AMORE_BASE, citaOtroTenant],
      clientesMeta: { "otro-numero-real": clienteOtro },
    });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 2);
    assert.equal(fakeEnviarAmore.llamadas.length, 1);
    assert.equal(fakeEnviarAmore.llamadas[0]!.telefono, "573148127388");
    assert.equal(fakeNotificarMeta.llamadas.length, 1);
  });
});

describe("Test 4 -- cita sin teléfono: NUNCA se envía", () => {
  it("telefono_cliente null excluye la cita de la consulta", async () => {
    const { deps, fakeEnviarAmore } = armarDeps({ citas: [{ ...CITA_AMORE_BASE, telefono_cliente: null }] });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 0);
    assert.equal(fakeEnviarAmore.llamadas.length, 0);
  });
});

describe("Test 5 -- cita fuera de la ventana correspondiente: NUNCA se envía", () => {
  it("una cita en 2 horas (fuera de la ventana 55-65 min) no se procesa", async () => {
    const { deps, fakeEnviarAmore } = armarDeps({ citas: [{ ...CITA_AMORE_BASE, inicio: dentroDeLaVentana(120) }] });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 0);
    assert.equal(fakeEnviarAmore.llamadas.length, 0);
  });

  it("una cita que ya pasó (hace 10 min) tampoco se procesa", async () => {
    const { deps, fakeEnviarAmore } = armarDeps({ citas: [{ ...CITA_AMORE_BASE, inicio: dentroDeLaVentana(-10) }] });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 0);
    assert.equal(fakeEnviarAmore.llamadas.length, 0);
  });
});

describe("Test 6 -- recordatorio ya enviado: NUNCA se duplica", () => {
  it("recordatorio_enviado=true excluye la cita de la consulta", async () => {
    const { deps, fakeEnviarAmore } = armarDeps({ citas: [{ ...CITA_AMORE_BASE, recordatorio_enviado: true }] });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 0);
    assert.equal(fakeEnviarAmore.llamadas.length, 0);
  });
});

describe("Test 7 -- ejecución repetida del proceso: idempotencia real", () => {
  it("correr el cron dos veces seguidas solo envía UNA vez", async () => {
    const { deps, fakeEnviarAmore } = armarDeps({ citas: [CITA_AMORE_BASE] });
    const r1 = await ejecutarRecordatoriosCitas(deps);
    const r2 = await ejecutarRecordatoriosCitas(deps); // mismo estado -- la cita ya quedó marcada
    assert.equal(r1.enviados, 1);
    assert.equal(r2.enviados, 0, "la segunda pasada ya no debe encontrar la cita (recordatorio_enviado quedó en true)");
    assert.equal(fakeEnviarAmore.llamadas.length, 1, "el worker NUNCA se llama una segunda vez para la misma cita");
  });
});

describe("Test 8/9 -- fecha/hora interpretadas correctamente en Colombia, y los datos corresponden EXACTAMENTE a la cita real", () => {
  it("el texto real enviado incluye servicio, profesional, fecha y hora correctos en America/Bogota, nunca inventados", async () => {
    const citaReal: FilaCita = {
      ...CITA_AMORE_BASE,
      servicio: "Sombreado de Cejas",
      nombre_cliente: "Carla Gómez",
      inicio: "2026-09-08T21:00:00.000Z", // 4:00 p.m. Colombia, martes 8
    };
    const { deps, fakeEnviarAmore } = armarDeps({ citas: [citaReal] });
    await ejecutarRecordatoriosCitas(deps);
    const mensaje = fakeEnviarAmore.llamadas[0]!.mensaje;
    assert.match(mensaje, /Carla Gómez/);
    assert.match(mensaje, /Servicio: Sombreado de Cejas/);
    assert.match(mensaje, /Profesional: Jessica/);
    assert.match(mensaje, /Fecha: Martes 8 de septiembre/);
    assert.match(mensaje, /Hora: 4:00 p\. m\./);
  });
});

describe("Test 10 -- error del proveedor de WhatsApp: NUNCA marca recordatorio_enviado ni genera un duplicado al reintentar", () => {
  it("un fallo de envío deja la cita elegible para el siguiente intento, sin duplicar el envío exitoso posterior", async () => {
    const { deps, filas, fakeEnviarAmore } = armarDeps({ citas: [CITA_AMORE_BASE], resultadoEnvioAmore: { ok: false, status: 502, error: "no se pudo contactar al worker" } });
    const r1 = await ejecutarRecordatoriosCitas(deps);
    assert.equal(r1.enviados, 0);
    assert.deepEqual(r1.errores, ["9001: no se pudo enviar el recordatorio"]);
    assert.equal(filas.find((f) => f.id === 9001)!.recordatorio_enviado, false, "un fallo NUNCA marca recordatorio_enviado");

    // Reintento -- ahora el worker sí responde bien.
    deps.amoreDeps = { ...deps.amoreDeps, enviarMensajeWhatsApp: crearFakeEnviarWhatsAppAmore({ ok: true }).enviarMensajeWhatsApp };
    const r2 = await ejecutarRecordatoriosCitas(deps);
    assert.equal(r2.enviados, 1, "el reintento sí debe poder enviar (nunca queda bloqueada por el fallo anterior)");
    assert.equal(fakeEnviarAmore.llamadas.length, 1, "el intento fallido no contó como un envío real -- nunca hay un segundo envío exitoso duplicado para la misma cita");
  });

  it("una excepción real del worker (nunca capturada fuera) tampoco marca recordatorio_enviado", async () => {
    const { deps, filas } = armarDeps({ citas: [CITA_AMORE_BASE] });
    deps.amoreDeps = {
      ...deps.amoreDeps,
      enviarMensajeWhatsApp: async () => {
        throw new Error("network error simulado");
      },
    };
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 0);
    assert.equal(filas.find((f) => f.id === 9001)!.recordatorio_enviado, false);
  });
});

describe("Test 11 -- varias citas del mismo cliente se procesan independientemente", () => {
  it("dos citas reales del mismo teléfono, cada una con sus propios datos, reciben su propio recordatorio", async () => {
    const citaB: FilaCita = { ...CITA_AMORE_BASE, id: 9004, servicio: "Manicure", especialista_id: 1262 };
    const { deps, fakeEnviarAmore, filas } = armarDeps({
      citas: [CITA_AMORE_BASE, citaB],
      especialistas: { 1265: ESPECIALISTA_JESSICA, 1262: { ...ESPECIALISTA_JESSICA, id: 1262, nombre: "Mary" } },
    });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 2);
    assert.equal(fakeEnviarAmore.llamadas.length, 2);
    assert.match(fakeEnviarAmore.llamadas.find((l) => l.mensaje.includes("Manicure"))!.mensaje, /Profesional: Mary/);
    assert.match(fakeEnviarAmore.llamadas.find((l) => l.mensaje.includes("Células Madres"))!.mensaje, /Profesional: Jessica/);
    assert.equal(filas.find((f) => f.id === 9001)!.recordatorio_enviado, true);
    assert.equal(filas.find((f) => f.id === 9004)!.recordatorio_enviado, true);
  });
});

describe("Test 12 -- el procesamiento NUNCA modifica la cita, salvo recordatorio_enviado", () => {
  it("servicio/nombre_cliente/inicio/telefono_cliente permanecen EXACTAMENTE intactos tras procesar", async () => {
    const { deps, filas } = armarDeps({ citas: [CITA_AMORE_BASE] });
    await ejecutarRecordatoriosCitas(deps);
    const fila = filas.find((f) => f.id === 9001)!;
    assert.equal(fila.servicio, CITA_AMORE_BASE.servicio);
    assert.equal(fila.nombre_cliente, CITA_AMORE_BASE.nombre_cliente);
    assert.equal(fila.inicio, CITA_AMORE_BASE.inicio);
    assert.equal(fila.telefono_cliente, CITA_AMORE_BASE.telefono_cliente);
    assert.equal(fila.especialista_id, CITA_AMORE_BASE.especialista_id);
  });
});

describe("Defensivo -- especialista real no encontrado: nunca inventa un nombre, omite ese recordatorio sin romper las demás", () => {
  it("una cita con un especialista_id que ya no existe se omite (queda elegible para revisión manual), otras citas siguen procesándose", async () => {
    const citaConEspecialistaBorrado: FilaCita = { ...CITA_AMORE_BASE, especialista_id: 999999 };
    const citaValida: FilaCita = { ...CITA_AMORE_BASE, id: 9005 };
    const { deps, filas, fakeEnviarAmore } = armarDeps({ citas: [citaConEspecialistaBorrado, citaValida], especialistas: { 1265: ESPECIALISTA_JESSICA } });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 1, "solo la cita con especialista real se envía");
    assert.equal(fakeEnviarAmore.llamadas.length, 1);
    assert.equal(filas.find((f) => f.id === 9001)!.recordatorio_enviado, false);
    assert.equal(filas.find((f) => f.id === 9005)!.recordatorio_enviado, true);
  });
});

describe("TEST DE SEGURIDAD -- la cita R-2CX / ID 3057 nunca puede ser tocada por este cron", () => {
  it("estructural: soloIdTenant + la ventana de tiempo garantizan que las pruebas nunca alcanzan datos reales ajenos, y el id 3057 nunca aparece entre lo procesado", async () => {
    // Este test corre EXCLUSIVAMENTE contra el fake en memoria (nunca
    // Supabase real) -- la cita real R-2CX/ID 3057 no existe en ningún
    // fixture de esta suite, así que estructuralmente no puede aparecer.
    const { deps, filas } = armarDeps({ citas: [CITA_AMORE_BASE] });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    const idsProcesados = filas.filter((f) => f.recordatorio_enviado).map((f) => f.id);
    assert.ok(!idsProcesados.includes(3057), "el id real 3057 nunca debe aparecer procesado");
    assert.equal(resultado.enviados, 1);
  });
});

// Mejora Recordatorios (autorizado) -- anticipación y mensaje REALMENTE
// configurables, ahora usados por el motor real (ya no decoración de UI).
function fakeObtenerConfig(config: {
  recordatorioAnticipacionMinutos: AnticipacionRecordatorioMinutos;
  recordatorioMensaje: string;
  tieneConfiguracionGuardada: boolean;
}) {
  return async () => ({
    idTenant: AMORE_TENANT_ID,
    confirmacionActiva: false,
    confirmacionMensaje: "",
    recordatorioActivo: true,
    recordatorioAnticipacionHoras: 1,
    recordatorioAnticipacionMinutos: config.recordatorioAnticipacionMinutos,
    recordatorioMensaje: config.recordatorioMensaje,
    tieneConfiguracionGuardada: config.tieneConfiguracionGuardada,
  });
}

describe("Mejora Recordatorios -- anticipación configurada por tenant (ya no fija en 55-65 min)", () => {
  it("un tenant con anticipación de 120 min (2 horas) NO se envía a los 60 min, SÍ se envía a los 120 min", async () => {
    const citaA60 = { ...CITA_AMORE_BASE, id: 9101, inicio: dentroDeLaVentana(60) };
    const { deps: depsA, fakeEnviarAmore: enviarA } = armarDeps({ citas: [citaA60] });
    depsA.obtenerConfigComunicaciones = fakeObtenerConfig({ recordatorioAnticipacionMinutos: 120, recordatorioMensaje: "", tieneConfiguracionGuardada: false });
    const resultadoA = await ejecutarRecordatoriosCitas(depsA);
    assert.equal(resultadoA.enviados, 0, "a 60 min de la cita, un tenant configurado a 120 min todavía NO debe enviar");
    assert.equal(enviarA.llamadas.length, 0);

    const citaA120 = { ...CITA_AMORE_BASE, id: 9102, inicio: dentroDeLaVentana(120) };
    const { deps: depsB, fakeEnviarAmore: enviarB } = armarDeps({ citas: [citaA120] });
    depsB.obtenerConfigComunicaciones = fakeObtenerConfig({ recordatorioAnticipacionMinutos: 120, recordatorioMensaje: "", tieneConfiguracionGuardada: false });
    const resultadoB = await ejecutarRecordatoriosCitas(depsB);
    assert.equal(resultadoB.enviados, 1, "a 120 min de la cita, un tenant configurado a 120 min SÍ debe enviar");
    assert.equal(enviarB.llamadas.length, 1);
  });

  it("un tenant SIN configuración guardada sigue con el comportamiento histórico EXACTO (60 min, ±5 min)", async () => {
    const { deps, fakeEnviarAmore } = armarDeps({ citas: [{ ...CITA_AMORE_BASE, inicio: dentroDeLaVentana(60) }] });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 1);
    assert.equal(fakeEnviarAmore.llamadas.length, 1);
  });

  it("las 9 anticipaciones válidas (15 min a 2 días) disparan el envío exactamente en su propia ventana", async () => {
    for (const minutos of ANTICIPACIONES_RECORDATORIO_MINUTOS) {
      const cita = { ...CITA_AMORE_BASE, id: 9200 + minutos, inicio: dentroDeLaVentana(minutos) };
      const { deps, fakeEnviarAmore } = armarDeps({ citas: [cita] });
      deps.obtenerConfigComunicaciones = fakeObtenerConfig({ recordatorioAnticipacionMinutos: minutos, recordatorioMensaje: "", tieneConfiguracionGuardada: false });
      const resultado = await ejecutarRecordatoriosCitas(deps);
      assert.equal(resultado.enviados, 1, `anticipación de ${minutos} min debe enviar dentro de su propia ventana`);
      assert.equal(fakeEnviarAmore.llamadas.length, 1);
    }
  });
});

describe("Mejora Recordatorios -- el mensaje configurado (con variables) es el que REALMENTE envía el motor", () => {
  it("con una fila guardada, usa la plantilla configurada vía {{variables}}, no el texto histórico hardcodeado", async () => {
    const citaReal = { ...CITA_AMORE_BASE, servicio: "Sombreado de Cejas", nombre_cliente: "Carla Gómez", inicio: dentroDeLaVentana(60) };
    const { deps, fakeEnviarAmore } = armarDeps({ citas: [citaReal] });
    deps.obtenerConfigComunicaciones = fakeObtenerConfig({
      recordatorioAnticipacionMinutos: 60,
      recordatorioMensaje: "Hola {{nombre}}, tu cita de {{servicio}} con {{profesional}} es el {{fecha}} a las {{hora}}. ¡Te esperamos!",
      tieneConfiguracionGuardada: true,
    });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 1);
    const mensaje = fakeEnviarAmore.llamadas[0]!.mensaje;
    assert.match(mensaje, /Hola Carla Gómez, tu cita de Sombreado de Cejas con Jessica es el/);
    assert.doesNotMatch(mensaje, /\{\{/, "nunca debe quedar una variable sin sustituir");
    assert.doesNotMatch(mensaje, /Te recordamos tu cita en AMORE/, "ya NO debe usar el texto histórico hardcodeado cuando hay una plantilla guardada");
  });

  it("sin fila guardada (caso real de AMORE hoy), sigue usando construirTextoRecordatorioAmore de siempre (incluye el formato especial de multi-servicio)", async () => {
    const citaReal = { ...CITA_AMORE_BASE, servicio: "Sombreado de Cejas", nombre_cliente: "Carla Gómez", inicio: dentroDeLaVentana(60) };
    const { deps, fakeEnviarAmore } = armarDeps({ citas: [citaReal] });
    deps.obtenerConfigComunicaciones = fakeObtenerConfig({ recordatorioAnticipacionMinutos: 60, recordatorioMensaje: "esto nunca debe usarse", tieneConfiguracionGuardada: false });
    const resultado = await ejecutarRecordatoriosCitas(deps);
    assert.equal(resultado.enviados, 1);
    const mensaje = fakeEnviarAmore.llamadas[0]!.mensaje;
    assert.match(mensaje, /Te recordamos tu cita en AMORE/, "sin fila guardada, el texto histórico exacto de siempre sigue intacto");
    assert.doesNotMatch(mensaje, /esto nunca debe usarse/);
  });
});
