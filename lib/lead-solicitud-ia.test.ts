/**
 * Du -- Fase 1 (autorizado). Dos bloques:
 * 1) resolverContextoContacto ("enrutamiento silencioso", Capa 1 de AIM-O).
 * 2) Migración a Gemini: parsearSalidaGemini, ejecutarAccion y
 *    generarRespuestaConLeadIA completa con un cliente Gemini FALSO
 *    inyectado (nunca la red real -- no hay GEMINI_KEY en este entorno de
 *    todas formas).
 *
 * Ningún test de este archivo toca Supabase real ni envía WhatsApp real.
 * Esto es seguro incluso para los casos que internamente llaman a
 * registrarFalloIA (lib/alertas.ts): ese archivo corre `npx tsx --test`
 * directo, sin cargar .env.local (a diferencia de Next.js) -- así que
 * `process.env.SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` están vacíos acá,
 * `supabaseAdmin()` lanza "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"
 * de inmediato (lib/supabase.ts:91-95), y registrarFalloIA lo atrapa en su
 * propio try/catch y solo lo loguea -- nunca llega a una escritura real ni
 * a un WhatsApp real. Mismo principio que el guard HAS_SUPABASE que ya usan
 * otros tests del repo (ej. lib/comunicaciones/config.test.ts).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "./supabase";
import type { GeminiGenerateContentClient, GeminiGenerateContentResult } from "./flow/gemini/gemini-types";
import {
  resolverContextoContacto,
  parsearSalidaGemini,
  ejecutarAccion,
  generarRespuestaConLeadIA,
} from "./lead-solicitud-ia";

type FilaLead = { nombre: string; empresa: string; necesidad: string; created_at: string };
type FilaMensaje = { created_at: string };

function crearFakeSupabase(opts: { lead: FilaLead | null; primerMensaje: FilaMensaje | null }) {
  const from = (tabla: string) => {
    if (tabla === "dulabs_enterprise_leads") {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: opts.lead, error: null });
        },
      };
    }
    if (tabla === "dulabs_mensajes_log") {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: opts.primerMensaje, error: null });
        },
      };
    }
    throw new Error(`fake de prueba: tabla inesperada "${tabla}"`);
  };
  return { from } as unknown as SupabaseClient;
}

describe("resolverContextoContacto -- Capa 1 de AIM-O (enrutamiento silencioso)", () => {
  it("contacto nuevo, sin lead previo: dice que es primera vez, no inventa nada más", async () => {
    const supabase = crearFakeSupabase({ lead: null, primerMensaje: null });
    const contexto = await resolverContextoContacto(supabase, "696346603563682", "573000000001");
    assert.ok(contexto);
    assert.match(contexto!, /primera vez/);
    assert.doesNotMatch(contexto!, /lead registrado/);
  });

  it("contacto recurrente sin lead: dice que ya había escrito antes", async () => {
    const supabase = crearFakeSupabase({ lead: null, primerMensaje: { created_at: "2026-09-01T00:00:00Z" } });
    const contexto = await resolverContextoContacto(supabase, "696346603563682", "573000000002");
    assert.ok(contexto);
    assert.match(contexto!, /ya había escrito antes/);
  });

  it("contacto con lead previo: incluye nombre, empresa y necesidad, e indica no repetir la pregunta", async () => {
    const supabase = crearFakeSupabase({
      lead: { nombre: "Carlos Pérez", empresa: "Clínica Dental", necesidad: "automatizar atención", created_at: "2026-09-05T00:00:00Z" },
      primerMensaje: { created_at: "2026-09-01T00:00:00Z" },
    });
    const contexto = await resolverContextoContacto(supabase, "696346603563682", "573000000003");
    assert.ok(contexto);
    assert.match(contexto!, /Carlos Pérez/);
    assert.match(contexto!, /Clínica Dental/);
    assert.match(contexto!, /No vuelvas a pedirle estos datos/);
  });

  it("nunca falla la conversación si Supabase truena -- devuelve null en vez de lanzar", async () => {
    const supabaseQueRompe = {
      from() {
        throw new Error("simulando una caída de Supabase");
      },
    } as unknown as SupabaseClient;
    const contexto = await resolverContextoContacto(supabaseQueRompe, "696346603563682", "573000000004");
    assert.equal(contexto, null);
  });
});

// --- Migración a Gemini -----------------------------------------------------

describe("parsearSalidaGemini -- Test A (JSON válido) y D (parámetros inválidos / integridad estructural)", () => {
  it("A. JSON válido con mode=reply se convierte en la respuesta real para WhatsApp", () => {
    const salida = parsearSalidaGemini(JSON.stringify({ mode: "reply", reply_text: "Hola, cuéntame qué necesitas." }));
    assert.ok(salida);
    assert.equal(salida!.mode, "reply");
    assert.equal(salida!.reply_text, "Hola, cuéntame qué necesitas.");
    assert.equal(salida!.guardar_lead_interesado, null);
    assert.equal(salida!.transferir_a_soporte, null);
  });

  it("A. JSON válido con propose_action y guardar_lead_interesado con los 4 datos completos", () => {
    const salida = parsearSalidaGemini(
      JSON.stringify({
        mode: "propose_action",
        reply_text: "Dame un momento, ya te confirmo.",
        guardar_lead_interesado: { nombre: "Ana", empresa: "Ana SAS", correo: "ana@x.co", necesidad: "automatizar" },
      })
    );
    assert.ok(salida);
    assert.equal(salida!.mode, "propose_action");
    assert.equal(salida!.guardar_lead_interesado?.nombre, "Ana");
    assert.equal(salida!.guardar_lead_interesado?.empresa, "Ana SAS");
    assert.equal(salida!.transferir_a_soporte, null);
  });

  it("A. JSON válido con propose_action y transferir_a_soporte con motivo", () => {
    const salida = parsearSalidaGemini(
      JSON.stringify({ mode: "propose_action", reply_text: "Dame un momento.", transferir_a_soporte: { motivo: "ya es cliente, bot no responde" } })
    );
    assert.ok(salida);
    assert.equal(salida!.transferir_a_soporte?.motivo, "ya es cliente, bot no responde");
    assert.equal(salida!.guardar_lead_interesado, null);
  });

  it("D. JSON roto (no parsea) devuelve null -- nunca inventa una respuesta", () => {
    assert.equal(parsearSalidaGemini("esto no es json"), null);
  });

  it("D. texto vacío/null devuelve null", () => {
    assert.equal(parsearSalidaGemini(null), null);
    assert.equal(parsearSalidaGemini(""), null);
  });

  it("D. mode desconocido (fuera del enum) devuelve null", () => {
    assert.equal(parsearSalidaGemini(JSON.stringify({ mode: "hacer_lo_que_sea", reply_text: "x" })), null);
  });

  it("D. reply_text con tipo equivocado devuelve null", () => {
    assert.equal(parsearSalidaGemini(JSON.stringify({ mode: "reply", reply_text: 12345 })), null);
  });

  it("D. integridad estructural (Caso 12): guardar_lead_interesado con campos en null -- NUNCA se completa con datos inventados, queda null entero", () => {
    const salida = parsearSalidaGemini(
      JSON.stringify({
        mode: "propose_action",
        reply_text: "Tomo nota de tus datos.",
        guardar_lead_interesado: { nombre: null, empresa: null, correo: null, necesidad: null },
      })
    );
    assert.ok(salida);
    assert.equal(salida!.guardar_lead_interesado, null);
  });

  it("D. guardar_lead_interesado con un solo dato faltante (correo) -- también queda null entero, no se guarda parcial", () => {
    const salida = parsearSalidaGemini(
      JSON.stringify({
        mode: "propose_action",
        reply_text: "texto",
        guardar_lead_interesado: { nombre: "Carlos", empresa: "Clínica X", necesidad: "automatizar" },
      })
    );
    assert.ok(salida);
    assert.equal(salida!.guardar_lead_interesado, null);
  });

  it("D. transferir_a_soporte sin motivo (string vacío) queda null", () => {
    const salida = parsearSalidaGemini(
      JSON.stringify({ mode: "propose_action", reply_text: "texto", transferir_a_soporte: { motivo: "" } })
    );
    assert.ok(salida);
    assert.equal(salida!.transferir_a_soporte, null);
  });
});

type FilaLeadInsertado = { nombre: string; empresa: string; correo: string; telefono: string | null; necesidad: string; detalle: string | null };

function crearFakeSupabaseAcciones(opts: {
  leadGuardadoId?: number | null;
  leadGuardadoError?: string;
  pausaOk?: boolean;
  pausaError?: string;
} = {}) {
  const leadsInsertados: FilaLeadInsertado[] = [];
  const pausasActivadas: { phoneNumberId: string; telefonoCliente: string; duracionMs: number }[] = [];

  const from = (tabla: string) => {
    if (tabla === "dulabs_enterprise_leads") {
      // Misma tabla, dos formas de uso reales: guardarLeadEnterprise hace
      // .insert(...).select("id").maybeSingle(); resolverContextoContacto
      // (enrutamiento silencioso) hace .select(...).eq(...).order(...).limit(1).maybeSingle()
      // -- se distinguen por si hubo un .insert() antes en la misma cadena.
      let filaAInsertar: FilaLeadInsertado | null = null;
      const builder = {
        insert(fila: FilaLeadInsertado) {
          filaAInsertar = fila;
          return builder;
        },
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          if (filaAInsertar) {
            if (opts.leadGuardadoError) return Promise.resolve({ data: null, error: { message: opts.leadGuardadoError } });
            leadsInsertados.push(filaAInsertar);
            return Promise.resolve({ data: { id: opts.leadGuardadoId ?? 1 }, error: null });
          }
          // Select puro (resolverContextoContacto): sin lead previo en esta prueba.
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    }
    if (tabla === "dulabs_mensajes_log") {
      // resolverContextoContacto también consulta esta tabla -- sin
      // historial previo en esta prueba (contacto nuevo), respuesta benigna.
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    if (tabla === "dulabs_pausas_chat") {
      return {
        upsert(fila: { phone_number_id: string; telefono_cliente: string }) {
          pausasActivadas.push({ phoneNumberId: fila.phone_number_id, telefonoCliente: fila.telefono_cliente, duracionMs: 0 });
          if (opts.pausaError) return Promise.resolve({ error: { message: opts.pausaError } });
          return Promise.resolve({ error: null });
        },
      };
    }
    throw new Error(`fake de prueba: tabla inesperada "${tabla}"`);
  };
  return { supabase: { from } as unknown as SupabaseClient, leadsInsertados, pausasActivadas };
}

describe("ejecutarAccion -- Test B (acción válida), C (acción inválida/vacía), G (transferencia)", () => {
  it("B. guardar_lead_interesado con datos completos: valida, ejecuta y llega al executor real (guardarLeadEnterprise)", async () => {
    const { supabase, leadsInsertados } = crearFakeSupabaseAcciones();
    const resultado = await ejecutarAccion(supabase, { phone_number_id: "696346603563682" }, "573000000010", {
      guardar_lead_interesado: {
        nombre: "Carlos Pérez",
        empresa: "Clínica Dental",
        correo: "carlos@clinicadental.co",
        necesidad: "automatizar atención",
        detalle: null,
      },
      transferir_a_soporte: null,
    });
    assert.equal(resultado.success, true);
    assert.match(resultado.resumen, /se ejecutó correctamente/);
    assert.equal(leadsInsertados.length, 1);
    // El teléfono SIEMPRE viene del parámetro real del webhook, nunca de lo que propuso el modelo.
    assert.equal(leadsInsertados[0].telefono, "573000000010");
  });

  it("C. ninguna acción propuesta (ambas null) se rechaza -- NO se ejecuta nada", async () => {
    const { supabase, leadsInsertados, pausasActivadas } = crearFakeSupabaseAcciones();
    const resultado = await ejecutarAccion(supabase, { phone_number_id: "696346603563682" }, "573000000011", {
      guardar_lead_interesado: null,
      transferir_a_soporte: null,
    });
    assert.equal(resultado.success, false);
    assert.match(resultado.resumen, /No se propuso ninguna acción válida/);
    assert.equal(leadsInsertados.length, 0);
    assert.equal(pausasActivadas.length, 0);
  });

  it("G. transferir_a_soporte: pausa el chat puntual (phone_number_id + teléfono del contacto), nunca todo el número", async () => {
    const { supabase, pausasActivadas } = crearFakeSupabaseAcciones();
    const resultado = await ejecutarAccion(supabase, { phone_number_id: "696346603563682" }, "573000000013", {
      guardar_lead_interesado: null,
      transferir_a_soporte: { motivo: "ya es cliente, bot no le funciona" },
    });
    assert.equal(resultado.success, true);
    assert.equal(pausasActivadas.length, 1);
    assert.equal(pausasActivadas[0].phoneNumberId, "696346603563682");
    assert.equal(pausasActivadas[0].telefonoCliente, "573000000013");
  });

  it("G. transferir_a_soporte: si la pausa falla, se rechaza de forma segura (no dice éxito)", async () => {
    const { supabase } = crearFakeSupabaseAcciones({ pausaError: "supabase caído" });
    const resultado = await ejecutarAccion(supabase, { phone_number_id: "696346603563682" }, "573000000014", {
      guardar_lead_interesado: null,
      transferir_a_soporte: { motivo: "motivo x" },
    });
    assert.equal(resultado.success, false);
    assert.match(resultado.resumen, /No se pudo transferir/);
  });
});

/** Cliente Gemini falso: nunca la red real. Se le puede dar una secuencia fija de respuestas (una por llamada) o una función que lance un error. */
function crearFakeGeminiClient(
  respuestas: (GeminiGenerateContentResult | (() => never))[]
): GeminiGenerateContentClient & { llamadas: number } {
  let llamadas = 0;
  return {
    get llamadas() {
      return llamadas;
    },
    async generateContent() {
      const siguiente = respuestas[llamadas] ?? respuestas[respuestas.length - 1];
      llamadas++;
      if (typeof siguiente === "function") return siguiente();
      return siguiente;
    },
  };
}

function fakeCliente(): ClienteConfig {
  return {
    id_tenant: "daf555ef-bda6-40d1-9833-bea40d69e38c",
    phone_number_id: "696346603563682",
    nombre_negocio: "Dulabs",
    prompt_sistema: "Eres Du, consultor de DuLabs (prompt de prueba).",
    base_conocimiento: "DuLabs ofrece automatización por WhatsApp.",
    api_key_ia: null,
  } as ClienteConfig;
}

describe("generarRespuestaConLeadIA con Gemini -- Test E (error), F (sin falsa confirmación)", () => {
  it("A. mode=reply de Gemini llega tal cual como respuesta para WhatsApp", async () => {
    const { supabase } = crearFakeSupabaseAcciones();
    const geminiClient = crearFakeGeminiClient([{ text: JSON.stringify({ mode: "reply", reply_text: "Hola, cuéntame tu negocio." }) }]);
    const respuesta = await generarRespuestaConLeadIA(
      { supabase, cliente: fakeCliente(), textoUsuario: "Hola", telefonoRemitente: "573000000020" },
      { geminiClient, resolveApiKey: () => "fake-key-de-prueba-nunca-real" }
    );
    assert.equal(respuesta, "Hola, cuéntame tu negocio.");
  });

  it("E. si Gemini lanza un error de red/API, la conversación no se rompe -- responde el mensaje de respaldo, nunca lanza", async () => {
    const { supabase } = crearFakeSupabaseAcciones();
    const geminiClient = crearFakeGeminiClient([
      () => {
        throw Object.assign(new Error("simulando caída de Gemini"), { status: 503 });
      },
    ]);
    const respuesta = await generarRespuestaConLeadIA(
      { supabase, cliente: fakeCliente(), textoUsuario: "Hola", telefonoRemitente: "573000000021" },
      { geminiClient, resolveApiKey: () => "fake-key-de-prueba-nunca-real" }
    );
    assert.ok(respuesta);
    assert.match(respuesta!, /problema técnico/);
  });

  it("E. si Gemini devuelve JSON fuera del schema (roto), responde el mensaje de respaldo, nunca lanza", async () => {
    const { supabase } = crearFakeSupabaseAcciones();
    const geminiClient = crearFakeGeminiClient([{ text: "esto no es el JSON esperado" }]);
    const respuesta = await generarRespuestaConLeadIA(
      { supabase, cliente: fakeCliente(), textoUsuario: "Hola", telefonoRemitente: "573000000022" },
      { geminiClient, resolveApiKey: () => "fake-key-de-prueba-nunca-real" }
    );
    assert.ok(respuesta);
    assert.match(respuesta!, /problema técnico/);
  });

  it("F. si la acción propuesta FALLA al ejecutarse, la respuesta final no dice que funcionó (el modelo recibe el resultado real y redacta de nuevo)", async () => {
    // Simula: la pausa falla en el backend -> Gemini se entera del fallo
    // real en el 2do turno y debe disculparse, NUNCA confirmar éxito.
    const { supabase } = crearFakeSupabaseAcciones({ pausaError: "supabase caído" });
    const geminiClient = crearFakeGeminiClient([
      {
        text: JSON.stringify({
          mode: "propose_action",
          reply_text: "Listo, ya te transfiero con soporte.",
          transferir_a_soporte: { motivo: "cliente con problema" },
        }),
      },
      { text: JSON.stringify({ mode: "reply", reply_text: "Uy, tuve un problema transfiriéndote, ¿lo intentamos de nuevo?" }) },
    ]);
    const respuesta = await generarRespuestaConLeadIA(
      { supabase, cliente: fakeCliente(), textoUsuario: "Ya soy cliente y necesito soporte", telefonoRemitente: "573000000023" },
      { geminiClient, resolveApiKey: () => "fake-key-de-prueba-nunca-real" }
    );
    assert.equal(geminiClient.llamadas, 2);
    assert.ok(respuesta);
    // La respuesta final es la del SEGUNDO turno (ya informado del fallo real), no la optimista del primero.
    assert.doesNotMatch(respuesta!, /Listo, ya te transfiero/);
    assert.match(respuesta!, /problema transfiriéndote/);
  });

  it("F (integridad estructural). guardar_lead_interesado con campos en null (Caso 12): NUNCA se ejecuta ni se confirma -- Gemini debe redactar de nuevo con el fallo real", async () => {
    const { supabase, leadsInsertados } = crearFakeSupabaseAcciones();
    const geminiClient = crearFakeGeminiClient([
      {
        text: JSON.stringify({
          mode: "propose_action",
          reply_text: "Ya dejé tus datos registrados con el equipo.",
          guardar_lead_interesado: { nombre: null, empresa: null, correo: null, necesidad: null },
        }),
      },
      { text: JSON.stringify({ mode: "reply", reply_text: "Para poder registrarte, ¿me confirmas tu correo?" }) },
    ]);
    const respuesta = await generarRespuestaConLeadIA(
      { supabase, cliente: fakeCliente(), textoUsuario: "Soy Carlos, tengo una clínica", telefonoRemitente: "573000000026" },
      { geminiClient, resolveApiKey: () => "fake-key-de-prueba-nunca-real" }
    );
    assert.equal(leadsInsertados.length, 0);
    assert.doesNotMatch(respuesta!, /Ya dejé tus datos registrados/);
    assert.match(respuesta!, /correo/);
  });

  it("B/G. si la acción propuesta SE EJECUTA con éxito, la ejecución real ocurre antes de la respuesta final", async () => {
    const { supabase, leadsInsertados } = crearFakeSupabaseAcciones();
    const geminiClient = crearFakeGeminiClient([
      {
        text: JSON.stringify({
          mode: "propose_action",
          reply_text: "ignorado",
          guardar_lead_interesado: {
            nombre: "Ana",
            empresa: "Ana SAS",
            correo: "ana@ana.co",
            necesidad: "automatizar ventas",
          },
        }),
      },
      { text: JSON.stringify({ mode: "reply", reply_text: "Listo Ana, ya quedaste registrada, el equipo te escribe pronto." }) },
    ]);
    const respuesta = await generarRespuestaConLeadIA(
      { supabase, cliente: fakeCliente(), textoUsuario: "Soy Ana...", telefonoRemitente: "573000000024" },
      { geminiClient, resolveApiKey: () => "fake-key-de-prueba-nunca-real" }
    );
    assert.equal(leadsInsertados.length, 1);
    assert.equal(leadsInsertados[0].telefono, "573000000024");
    assert.match(respuesta!, /ya quedaste registrada/);
  });

  it("sin GEMINI_KEY (resolveApiKey devuelve null): devuelve null sin lanzar", async () => {
    const { supabase } = crearFakeSupabaseAcciones();
    const geminiClient = crearFakeGeminiClient([{ text: "no debería llamarse nunca" }]);
    const respuesta = await generarRespuestaConLeadIA(
      { supabase, cliente: fakeCliente(), textoUsuario: "Hola", telefonoRemitente: "573000000025" },
      { geminiClient, resolveApiKey: () => null }
    );
    assert.equal(respuesta, null);
    assert.equal(geminiClient.llamadas, 0);
  });
});
