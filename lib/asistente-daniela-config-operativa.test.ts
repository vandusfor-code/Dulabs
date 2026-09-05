/**
 * Fase 8A.4 (autorizado) — conectar dulabs_config_bot.respuestas (el
 * cuestionario que Daniela ya llenó, ver informe de la Fase 8A.3) como
 * conocimiento operativo real del asistente. Hasta esta fase, ningún
 * componente de la IA leía esta tabla.
 *
 * construirContextoOperativoDesdeConfigBot es una función PURA (nunca toca
 * la red) -- se prueba con distintas formas de `respuestas`, incluidas
 * vacías/parciales, sin depender de Supabase. configBotPorPhoneNumberId sí
 * es integración real (aislamiento por phone_number_id, columna unique).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { construirContextoOperativoDesdeConfigBot } from "@/lib/asistente-daniela-ia";
import { configBotPorPhoneNumberId } from "@/lib/config-bot";
import { buscarServicios, consultarServicio } from "@/lib/asistente-daniela-ia";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const ID_TENANT_DANIELA = "c64fac97-eff8-45f2-b691-30b3449da524";
const PHONE_DANIELA = "1282448611609227";

describe("construirContextoOperativoDesdeConfigBot — función pura", () => {
  it("respuestas vacía/null/con forma inesperada -> string vacío, nunca revienta", () => {
    assert.equal(construirContextoOperativoDesdeConfigBot({}), "");
    assert.equal(construirContextoOperativoDesdeConfigBot(null), "");
    assert.equal(construirContextoOperativoDesdeConfigBot(undefined), "");
    assert.equal(construirContextoOperativoDesdeConfigBot("texto raro"), "");
    assert.equal(construirContextoOperativoDesdeConfigBot({ personas: "no es un objeto" }), "");
  });

  it("horarios de personas: solo incluye a quien tiene días+inicio+fin completos", () => {
    const texto = construirContextoOperativoDesdeConfigBot({
      personas: {
        carla: { dias: ["lun", "mar", "sab"], inicio: "09:00", fin: "19:00", sabadoDistinto: true, sabInicio: "09:00", sabFin: "18:00" },
        kelly: { dias: [], inicio: "", fin: "" }, // incompleto -- no debe aparecer
      },
    });
    assert.ok(texto.includes("Carla: lunes, martes, sábado, 09:00 a 19:00 (sábado 09:00 a 18:00)"));
    assert.equal(texto.includes("Kelly"), false);
  });

  it("reglas de asignación: reproduce EXACTAMENTE lo que Daniela confirmó, sin inventar variantes no confirmadas", () => {
    const texto = construirContextoOperativoDesdeConfigBot({
      reglas: { prioridadManos: "carla_primero", danielaPies: "no", retiros: "cualquiera", serviciosCombinados: "paralelo" },
    });
    assert.ok(texto.includes("Carla es la primera opción; Daniela solo entra si Carla no tiene NINGÚN cupo ese día"));
    assert.ok(texto.includes("Daniela nunca hace pies"));
    assert.ok(texto.includes("los puede hacer cualquiera del equipo"));
    assert.ok(texto.includes("dos personas distintas, en paralelo"));
  });

  it("asociaciones servicio->profesional: solo las 3 confirmadas por Daniela, nunca inventa otras", () => {
    const texto = construirContextoOperativoDesdeConfigBot({
      servicios: { cejasSola: "carla", cejasHenna: "carla", hidralips: "nicol" },
    });
    assert.ok(texto.includes("Cejas, depilación sola → Carla"));
    assert.ok(texto.includes("Cejas, depilación con henna → Carla"));
    assert.ok(texto.includes("Hidralips → Nicol"));
    // Nada sobre Press on/Dipping/etc -- esas asociaciones NO existen en config-bot.
    assert.equal(texto.includes("Press on"), false);
  });

  it("políticas de negocio: horario, apertura 8am, cancelación", () => {
    const texto = construirContextoOperativoDesdeConfigBot({
      negocio: {
        lvAbre: "09:00", lvCierra: "19:00", sabAbre: "09:00", sabCierra: "18:00", domingo: "cerrado",
        abre8am: "si", abre8amDetalle: "solo entre semana con Carla o Kelly",
        tiempoCancelacion: "1 hora antes", cobroCancelacion: "no",
      },
    });
    assert.ok(texto.includes("Lunes a viernes: 09:00 a 19:00."));
    assert.ok(texto.includes("Domingos: cerrado."));
    assert.ok(texto.includes("8:00 a.m."));
    assert.ok(texto.includes("solo entre semana con Carla o Kelly"));
    assert.ok(texto.includes("1 hora antes"));
    assert.ok(texto.includes("No se cobra nada"));
  });

  it("nunca incluye precios/duraciones -- esos siguen viniendo solo del catálogo real", () => {
    const texto = construirContextoOperativoDesdeConfigBot({ duraciones: { semiManos: "60", acrilicas: "210" } });
    assert.equal(texto, "", "duraciones no debe generar ninguna línea -- fuente única es dulabs_servicios");
  });
});

describe(
  "configBotPorPhoneNumberId — integración real, aislamiento por phone_number_id",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    if (HAS_SUPABASE) supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    it("Daniela tiene una fila real con reglas/personas/servicios ya confirmados", async () => {
      const config = await configBotPorPhoneNumberId(supabase, PHONE_DANIELA);
      assert.ok(config, "Daniela debe tener una fila real en dulabs_config_bot");
      const respuestas = config!.respuestas as Record<string, unknown>;
      assert.ok(respuestas.personas, "debe traer horarios de personas");
      assert.ok(respuestas.reglas, "debe traer reglas de asignación");
    });

    it("un phone_number_id inexistente/de otro tenant no ve la configuración de Daniela", async () => {
      const config = await configBotPorPhoneNumberId(supabase, "phone-number-id-que-no-existe-jamas");
      assert.equal(config, null);
    });

    it("el contexto operativo real de Daniela contiene las 3 asociaciones confirmadas y las reglas de manos/pies", async () => {
      const config = await configBotPorPhoneNumberId(supabase, PHONE_DANIELA);
      const texto = construirContextoOperativoDesdeConfigBot(config!.respuestas);
      assert.ok(texto.includes("Cejas, depilación sola → Carla"));
      assert.ok(texto.includes("Cejas, depilación con henna → Carla"));
      assert.ok(texto.includes("Hidralips → Nicol"));
      assert.ok(texto.includes("Kelly es la fija"));
    });
  }
);

describe(
  "Fase 8A.4 — Acrílicas y asociaciones cargadas en dulabs_servicios/dulabs_servicio_especialista",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    if (HAS_SUPABASE) supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    it("Acrílicas: duracion_min=210, confirmado por Daniela vía config-bot (ya no bloqueado por rango ambiguo)", async () => {
      const [real] = await consultarServicio(supabase, { idTenant: ID_TENANT_DANIELA, nombre: "Acrílicas" });
      assert.ok(real, "Acrílicas debe existir en el catálogo real de Daniela");
      assert.equal(real!.duracionMin, 210);
    });

    it("el catálogo de Daniela ahora tiene 11 servicios (los 10 de la Fase 8A.2 + Acrílicas)", async () => {
      const servicios = await buscarServicios(supabase, { idTenant: ID_TENANT_DANIELA });
      assert.equal(servicios.length, 11);
      assert.ok(servicios.some((s) => s.nombre === "Acrílicas"));
    });

    it("asociaciones servicio->especialista: exactamente las 3 confirmadas, ninguna otra", async () => {
      const { data: filas, error } = await supabase
        .from("dulabs_servicio_especialista")
        .select("servicio_id, especialista_id, dulabs_servicios!inner(nombre, id_tenant), dulabs_especialistas!inner(nombre)")
        .eq("dulabs_servicios.id_tenant", ID_TENANT_DANIELA);
      if (error) throw error;
      const asociaciones = (filas ?? []).map((f: unknown) => {
        const fila = f as { dulabs_servicios: { nombre: string }; dulabs_especialistas: { nombre: string } };
        return `${fila.dulabs_servicios.nombre} -> ${fila.dulabs_especialistas.nombre}`;
      });
      assert.equal(asociaciones.length, 3);
      assert.ok(asociaciones.includes("Cejas, depilación sola -> Carla"));
      assert.ok(asociaciones.includes("Cejas, depilación con henna -> Carla"));
      assert.ok(asociaciones.includes("Hidralips -> Nicol"));
    });
  }
);
