/**
 * Fase 8A.2 (autorizado) — regresión del catálogo REAL de Daniela recién
 * cargado en dulabs_servicios (id_tenant c64fac97-eff8-45f2-b691-30b3449da524,
 * ver el informe de esta fase para el detalle exacto de qué se extrajo de
 * base_conocimiento y qué se dejó fuera -- Acrílicas y Pestañas, por
 * duración ambigua/ausente, y Retoque de forrado, por no estar en la lista
 * de 12 nombres pedida) y de la corrección del loop de herramientas
 * (Parte 13/14 del pedido: catálogo vacío nunca debe agotar
 * MAX_TURNOS_HERRAMIENTA sin responder).
 *
 * H/I/K/L del pedido (servicio inexistente no se inventa, servicio real se
 * puede usar para recomendar, el link usa el tenant correcto, disponibilidad
 * nunca crea una cita) YA están cubiertos en
 * lib/asistente-daniela-ia.test.ts -- no se duplican acá (salvo K, que se
 * repite acá con el id_tenant REAL de Daniela en vez de uno descartable).
 *
 * Fase 8A.4 (autorizado) — Acrílicas se agregó a SERVICIOS_ESPERADOS acá
 * (duración 210 min, confirmada por Daniela vía config-bot, ver
 * lib/asistente-daniela-config-operativa.test.ts para la prueba dedicada de
 * esa fase) para que este archivo no quede con una aserción desactualizada
 * ("exactamente 10") ahora que el catálogo real tiene 11 servicios.
 *
 * J (la IA nunca puede afirmar que Daniela ofrece un servicio que no existe
 * en dulabs_servicios) depende del JUICIO real del modelo -- este entorno no
 * tiene ANTHROPIC_API_KEY (confirmado, ver informe), así que NO se puede
 * probar de forma determinista acá. Queda para la prueba manual real contra
 * el único número autorizado (573148127388) -- NO se ejecuta en esta fase.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { buscarServicios, consultarServicio, generarLinkReserva, generarRespuestaAsistenteDaniela } from "@/lib/asistente-daniela-ia";
import type { ClienteConfig } from "@/lib/supabase";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const ID_TENANT_DANIELA = "c64fac97-eff8-45f2-b691-30b3449da524";
const OTRO_TENANT = "00000000-0000-0000-0000-000000000000";

const SERVICIOS_ESPERADOS: Record<string, { precio: number; duracionMin: number }> = {
  "Press on": { precio: 80000, duracionMin: 120 },
  "Semipermanente en manos": { precio: 45000, duracionMin: 60 },
  "Semipermanente en pies": { precio: 37000, duracionMin: 60 },
  Dipping: { precio: 70000, duracionMin: 120 },
  "Base Rubber": { precio: 60000, duracionMin: 120 },
  "Forrado en gel": { precio: 70000, duracionMin: 120 },
  "Forrado en acrílico": { precio: 85000, duracionMin: 120 },
  "Cejas, depilación sola": { precio: 15000, duracionMin: 15 },
  "Cejas, depilación con henna": { precio: 25000, duracionMin: 25 },
  Hidralips: { precio: 60000, duracionMin: 60 },
  Acrílicas: { precio: 95000, duracionMin: 210 },
};

describe(
  "Fase 8A.2 — catálogo real de Daniela en dulabs_servicios",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;

    before(() => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    });

    it("A. Daniela tiene exactamente los servicios cargados (ni más, ni menos)", async () => {
      const servicios = await buscarServicios(supabase, { idTenant: ID_TENANT_DANIELA });
      const nombres = servicios.map((s) => s.nombre).sort();
      assert.deepEqual(nombres, Object.keys(SERVICIOS_ESPERADOS).sort());
    });

    it("B. no hay duplicados -- cada nombre aparece exactamente una vez", async () => {
      const servicios = await buscarServicios(supabase, { idTenant: ID_TENANT_DANIELA });
      const conteos = new Map<string, number>();
      for (const s of servicios) conteos.set(s.nombre, (conteos.get(s.nombre) ?? 0) + 1);
      for (const [nombre, veces] of conteos) assert.equal(veces, 1, `"${nombre}" aparece ${veces} veces`);
    });

    it("C. tenant isolation -- un tenant distinto no ve ningún servicio de Daniela", async () => {
      const servicios = await buscarServicios(supabase, { idTenant: OTRO_TENANT });
      const nombresDaniela = new Set(Object.keys(SERVICIOS_ESPERADOS));
      assert.equal(
        servicios.some((s) => nombresDaniela.has(s.nombre)),
        false
      );
    });

    it("D. precio real correcto para cada servicio cargado", async () => {
      for (const [nombre, esperado] of Object.entries(SERVICIOS_ESPERADOS)) {
        const [real] = await consultarServicio(supabase, { idTenant: ID_TENANT_DANIELA, nombre });
        assert.ok(real, `no se encontró "${nombre}"`);
        assert.equal(real!.precio, esperado.precio, `precio de "${nombre}"`);
      }
    });

    it("E. duración real correcta para cada servicio cargado", async () => {
      for (const [nombre, esperado] of Object.entries(SERVICIOS_ESPERADOS)) {
        const [real] = await consultarServicio(supabase, { idTenant: ID_TENANT_DANIELA, nombre });
        assert.ok(real);
        assert.equal(real!.duracionMin, esperado.duracionMin, `duración de "${nombre}"`);
      }
    });

    it("K. generar_link_reserva usa el tenant real de Daniela", () => {
      const link = generarLinkReserva(ID_TENANT_DANIELA);
      assert.ok(link.includes(`/reservar/${ID_TENANT_DANIELA}`));
    });

    it("M. otro tenant no puede acceder al catálogo real de Daniela vía consultar_servicio", async () => {
      const resultado = await consultarServicio(supabase, { idTenant: OTRO_TENANT, nombre: "Semipermanente en manos" });
      assert.deepEqual(resultado, []);
    });

    // ---------------------------------------------------------------------
    // F/G — corrección del loop de herramientas (Parte 13/14): si buscar_servicios
    // siempre devuelve [] (acá, real contra la base real, con un texto que a
    // propósito no coincide con ningún servicio de Daniela) el loop nunca debe
    // agotar MAX_TURNOS_HERRAMIENTA sin responder texto real. Se usa un
    // anthropicOverride falso (Fase 8A.2) solo para la CAPA de Claude -- la
    // consulta al catálogo es 100% real contra Supabase, sin mockear.
    // ---------------------------------------------------------------------

    const CLIENTE_PRUEBA = {
      id: 1,
      id_tenant: ID_TENANT_DANIELA,
      phone_number_id: "1282448611609227",
      nombre_negocio: "TEST_8A2_asistente",
      meta_permanent_token: null,
      api_key_ia: null,
    } as unknown as ClienteConfig;

    /** Imita una Claude que SIEMPRE quiere seguir llamando buscar_servicios con distintos términos, mientras tenga `tools` disponibles. */
    function crearAnthropicFalsoQueSiempreBuscaVacio() {
      const llamadas: Anthropic.MessageCreateParamsNonStreaming[] = [];
      let contador = 0;
      const cliente = {
        messages: {
          create: async (p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
            llamadas.push(p);
            const tieneTools = Boolean(p.tools && p.tools.length > 0);
            if (tieneTools) {
              contador += 1;
              return {
                id: `msg_fake_${contador}`,
                type: "message",
                role: "assistant",
                model: "claude-sonnet-5",
                stop_reason: "tool_use",
                stop_sequence: null,
                usage: { input_tokens: 1, output_tokens: 1 },
                content: [
                  { type: "tool_use", id: `tool_${contador}`, name: "buscar_servicios", input: { texto: `xyz-no-existe-${contador}` } },
                ],
              } as unknown as Anthropic.Message;
            }
            // Último turno: sin tools -- DEBE cerrar con texto real (esto es
            // exactamente lo que garantiza el código de Fase 8A.2, no un
            // comportamiento espontáneo del mock).
            return {
              id: "msg_fake_final",
              type: "message",
              role: "assistant",
              model: "claude-sonnet-5",
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 },
              content: [{ type: "text", text: "No encontré una opción que coincida exactamente con lo que buscas 💗 ¿me cuentas un poco más?" }],
            } as unknown as Anthropic.Message;
          },
        },
      };
      return { llamadas, cliente };
    }

    it("F. catálogo real sin coincidencias en cada intento -> el loop termina acotado (MAX_TURNOS_HERRAMIENTA llamadas, nunca más)", async () => {
      const falso = crearAnthropicFalsoQueSiempreBuscaVacio();
      await generarRespuestaAsistenteDaniela({
        supabase,
        cliente: CLIENTE_PRUEBA,
        textoUsuario: "Quiero conservar mis uñas naturales pero quiero que se vean bonitas y duren bastantes",
        telefonoRemitente: "573148127388",
        anthropicOverride: falso.cliente,
      });
      assert.equal(falso.llamadas.length, 4, "debe llamar exactamente MAX_TURNOS_HERRAMIENTA veces, nunca más");
      assert.equal(falso.llamadas[3]!.tools, undefined, "el último turno no debe ofrecer tools");
    });

    it("G. el texto final devuelto es real (no null, no un fallback genérico) cuando el catálogo no encuentra nada", async () => {
      const falso = crearAnthropicFalsoQueSiempreBuscaVacio();
      const respuesta = await generarRespuestaAsistenteDaniela({
        supabase,
        cliente: CLIENTE_PRUEBA,
        textoUsuario: "¿Tienen algo para dejar mis uñas divinas?",
        telefonoRemitente: "573148127388",
        anthropicOverride: falso.cliente,
      });
      assert.equal(typeof respuesta, "string");
      assert.ok(respuesta!.includes("No encontré una opción"), "debe ser el texto real del último turno, no un fallback genérico");
    });
  }
);
