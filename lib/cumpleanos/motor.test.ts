/**
 * Cumpleaños automáticos (Fase 6A, genérico, autorizado) — integración REAL
 * contra Supabase (tenants descartables, randomUUID, nunca AMORE ni Daniela
 * ni Solo Talento) del orquestador completo (lib/cumpleanos/motor.ts).
 *
 * SEGURIDAD: en NINGÚN test se llama enviarWhatsApp real -- siempre se pasa
 * un `enviador` mock (ver EnviadorWhatsApp en motor.ts), que además de nunca
 * tocar Meta permite verificar exactamente a quién y con qué mensaje se
 * "envió" cada cumpleaños. Ningún número real recibe nada.
 *
 * Requiere que las migraciones de esta fase ya se hayan corrido
 * (dulabs_cumpleanos_config, dulabs_cumpleanos_procesados) -- si no,
 * el `before()` lo detecta y todo el archivo se salta con un mensaje claro.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { procesarCumpleanosDelTenant } from "./motor";
import { resumirResultados } from "./resumen";
import { crearSimuladorLog } from "./simulador";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function mockEnviador() {
  const llamadas: { clienteId: number; telefono: string; mensaje: string }[] = [];
  return { llamadas, enviador: async (p: { clienteId: number; telefono: string; mensaje: string }) => { llamadas.push(p); } };
}

describe(
  "procesarCumpleanosDelTenant (Fase 6A, integración real, sin WhatsApp real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let migracionesListas = false;
    const TENANT = randomUUID();
    const TENANT_DESACTIVADO = randomUUID();
    const PHONE = `test-motor-cumple-${Date.now()}`;
    const clienteIds: number[] = [];

    // 2026-03-15T15:00:00Z -- en America/Bogota (UTC-5) es 2026-03-15 10:00 local.
    const AHORA_2026 = new Date("2026-03-15T15:00:00Z");
    const AHORA_2027 = new Date("2027-03-15T15:00:00Z"); // mismo día/mes, un año después

    const MENSAJE = "🎂 Feliz cumpleaños, {{nombre}}! -- prueba Fase 6A, nunca se envía de verdad.";

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      const sonda = await supabase.from("dulabs_cumpleanos_config").select("id_tenant").limit(1);
      migracionesListas = !sonda.error;
      if (!migracionesListas) return;

      await supabase.from("dulabs_cumpleanos_config").insert([
        { id_tenant: TENANT, activo: true, mensaje: MENSAJE, nombre_negocio: "Test Fase 6A" },
        { id_tenant: TENANT_DESACTIVADO, activo: false, mensaje: MENSAJE, nombre_negocio: "Test Fase 6A (inactivo)" },
      ]);
    });

    after(async () => {
      if (!HAS_SUPABASE || !migracionesListas) return;
      await supabase.from("dulabs_cumpleanos_procesados").delete().in("id_tenant", [TENANT, TENANT_DESACTIVADO]);
      if (clienteIds.length) await supabase.from("dulabs_clientes_conocidos").delete().in("id", clienteIds);
      await supabase.from("dulabs_cumpleanos_config").delete().in("id_tenant", [TENANT, TENANT_DESACTIVADO]);
    });

    async function crearCliente(nombre: string, telefono: string, idTenant = TENANT) {
      const { data, error } = await supabase
        .from("dulabs_clientes_conocidos")
        .insert({ id_tenant: idTenant, phone_number_id: PHONE, telefono_cliente: telefono, nombre, cumple_dia: 15, cumple_mes: 3 })
        .select("id")
        .single();
      if (error) throw error;
      clienteIds.push(data!.id as number);
      return data!.id as number;
    }

    it("8. negocio con cumpleaños desactivado -> no procesa nada", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de cumpleaños (dulabs_cumpleanos_config/procesados)");
      await crearCliente("Cliente Desactivado", "573000000201", TENANT_DESACTIVADO);
      const { enviador, llamadas } = mockEnviador();
      const resultado = await procesarCumpleanosDelTenant(supabase, { idTenant: TENANT_DESACTIVADO, ahora: AHORA_2026, enviador });
      assert.equal(resultado.candidatos, 0);
      assert.deepEqual(resultado.procesados, []);
      assert.equal(llamadas.length, 0, "nunca debe intentar enviar si el negocio tiene el módulo desactivado");
    });

    it("10. múltiples clientes con cumpleaños el mismo día -> todos procesados en una corrida", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de cumpleaños");
      await crearCliente("Cliente Múltiple Uno", "573000000301");
      await crearCliente("Cliente Múltiple Dos", "573000000302");
      await crearCliente("Cliente Múltiple Tres", "573000000303");

      const { enviador, llamadas } = mockEnviador();
      const resultado = await procesarCumpleanosDelTenant(supabase, { idTenant: TENANT, ahora: AHORA_2026, enviador });

      const nombres = resultado.procesados.map((p) => p.nombre);
      assert.ok(nombres.includes("Cliente Múltiple Uno"));
      assert.ok(nombres.includes("Cliente Múltiple Dos"));
      assert.ok(nombres.includes("Cliente Múltiple Tres"));
      assert.equal(llamadas.length, resultado.procesados.filter((p) => p.resultado === "simulado").length);
      for (const llamada of llamadas) {
        assert.ok(llamada.mensaje.includes("Feliz cumpleaños"));
        assert.ok(!llamada.mensaje.includes("{{nombre}}"));
      }
    });

    it("11. WhatsApp inválido/ausente en un cliente no rompe el resto del lote", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de cumpleaños");
      await crearCliente("Cliente Teléfono Roto", "no-es-un-numero-valido");
      await crearCliente("Cliente Teléfono Bueno", "573000000401");

      const { enviador, llamadas } = mockEnviador();
      const resultado = await procesarCumpleanosDelTenant(supabase, { idTenant: TENANT, ahora: AHORA_2026, enviador });

      const roto = resultado.procesados.find((p) => p.nombre === "Cliente Teléfono Roto");
      const bueno = resultado.procesados.find((p) => p.nombre === "Cliente Teléfono Bueno");
      assert.equal(roto?.resultado, "fallido");
      assert.equal(bueno?.resultado, "simulado");
      assert.ok(!llamadas.some((l) => l.telefono === "no-es-un-numero-valido" || l.telefono === ""));
      assert.ok(llamadas.some((l) => l.telefono === "573000000401"));
    });

    it("5/9. cliente ya procesado este año -> NO se vuelve a procesar, ni con ejecuciones repetidas o concurrentes", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de cumpleaños");
      await crearCliente("Cliente Idempotente", "573000000501");

      const { enviador: enviador1, llamadas: llamadas1 } = mockEnviador();
      const primera = await procesarCumpleanosDelTenant(supabase, { idTenant: TENANT, ahora: AHORA_2026, enviador: enviador1 });
      assert.equal(primera.procesados.find((p) => p.nombre === "Cliente Idempotente")?.resultado, "simulado");
      assert.equal(llamadas1.length, 1);

      // 9a. reintento secuencial el mismo día -- ya_procesado, CERO envíos nuevos.
      const { enviador: enviador2, llamadas: llamadas2 } = mockEnviador();
      const segunda = await procesarCumpleanosDelTenant(supabase, { idTenant: TENANT, ahora: AHORA_2026, enviador: enviador2 });
      assert.equal(segunda.procesados.find((p) => p.nombre === "Cliente Idempotente")?.resultado, "ya_procesado");
      assert.equal(llamadas2.length, 0, "un reintento nunca debe volver a enviar");

      // 9b. dos ejecuciones CONCURRENTES (simula dos disparos del cron a la vez)
      // contra un cliente NUEVO -- la garantía debe venir de Postgres (UNIQUE),
      // no de un orden de llegada que no podemos controlar.
      const idConcurrente = await crearCliente("Cliente Concurrente", "573000000502");
      const { enviador: enviadorA, llamadas: llamadasA } = mockEnviador();
      const { enviador: enviadorB, llamadas: llamadasB } = mockEnviador();
      const [resA, resB] = await Promise.all([
        procesarCumpleanosDelTenant(supabase, { idTenant: TENANT, ahora: AHORA_2026, enviador: enviadorA }),
        procesarCumpleanosDelTenant(supabase, { idTenant: TENANT, ahora: AHORA_2026, enviador: enviadorB }),
      ]);
      const resultadosConcurrente = [...resA.procesados, ...resB.procesados].filter((p) => p.nombre === "Cliente Concurrente");
      const exitosos = resultadosConcurrente.filter((p) => p.resultado === "simulado");
      const yaProcesados = resultadosConcurrente.filter((p) => p.resultado === "ya_procesado");
      assert.equal(exitosos.length, 1, "exactamente UNA de las dos ejecuciones concurrentes debe ganar el claim");
      assert.equal(yaProcesados.length, 1);
      assert.equal(llamadasA.length + llamadasB.length, 1, "el cliente concurrente recibe el mensaje UNA sola vez en total");
      void idConcurrente;
    });

    it("6. cliente procesado el año anterior -> puede procesarse de nuevo este año", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de cumpleaños");
      const idMultiAnio = await crearCliente("Cliente Multi-Año", "573000000601");

      // Nota: TENANT es compartido con otros tests de este archivo (mismo
      // día/mes de cumpleaños), así que cada corrida también reprocesa a
      // esos otros clientes si todavía no tienen claim para ESE año -- las
      // aserciones acá se filtran por clienteId para no depender del orden
      // de ejecución de los demás tests.
      const { enviador: enviador2026, llamadas: llamadas2026 } = mockEnviador();
      const res2026 = await procesarCumpleanosDelTenant(supabase, { idTenant: TENANT, ahora: AHORA_2026, enviador: enviador2026 });
      assert.equal(res2026.procesados.find((p) => p.nombre === "Cliente Multi-Año")?.resultado, "simulado");
      assert.equal(llamadas2026.filter((l) => l.clienteId === idMultiAnio).length, 1);

      const { enviador: enviador2027, llamadas: llamadas2027 } = mockEnviador();
      const res2027 = await procesarCumpleanosDelTenant(supabase, { idTenant: TENANT, ahora: AHORA_2027, enviador: enviador2027 });
      assert.equal(
        res2027.procesados.find((p) => p.nombre === "Cliente Multi-Año")?.resultado,
        "simulado",
        "un año nuevo es una clave de idempotencia distinta -- SÍ debe volver a procesarse"
      );
      assert.equal(llamadas2027.filter((l) => l.clienteId === idMultiAnio).length, 1);
    });

    it("1/2/3. dry-run (crearSimuladorLog) encuentra cumpleaños, genera el mensaje y NUNCA envía real", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de cumpleaños");
      const originalLog = console.log;
      const originalError = console.error;
      const logs: string[] = [];
      console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
      console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));

      await crearCliente("Cliente Dry Run", "573000000701");
      let resultado;
      try {
        // Mismo enviador que usaría el endpoint del cron con ?dryRun=true --
        // se ejercita literalmente el modo dry-run, no un mock aparte.
        resultado = await procesarCumpleanosDelTenant(supabase, { idTenant: TENANT, ahora: AHORA_2026, enviador: crearSimuladorLog(TENANT) });
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }

      const propio = resultado.procesados.find((p) => p.nombre === "Cliente Dry Run");
      assert.equal(propio?.resultado, "simulado", "dry-run SÍ encuentra y procesa el cumpleaños de hoy");
      assert.ok(
        logs.some((l) => l.includes("[cumpleanos-dry-run]") && l.includes("573000000701") && l.includes("Feliz cumpleaños")),
        "dry-run debe dejar constancia (log) de qué se habría enviado, con el mensaje ya renderizado"
      );

      const resumen = resumirResultados(resultado.procesados);
      assert.ok(resumen.enviados >= 1);
      assert.equal(resumen.procesados, resultado.procesados.length);
      // "enviados" en el resumen incluye tanto "enviado" (real) como
      // "simulado" (dry-run) -- ver resumen.ts. Verificación explícita de
      // que un dry-run JAMÁS pasa por la rama de envío real: ningún log de
      // whatsapp-outbound (que solo puede aparecer si se llegara a llamar
      // enviarWhatsApp -- ver lib/whatsapp-outbound.ts, usa console.error).
      assert.ok(
        !logs.some((l) => l.includes("whatsapp-outbound")),
        "dry-run nunca debe tocar la infraestructura real de envío"
      );
    });

    it("5. soloTelefono acota la corrida a UN solo número, aunque existan otros candidatos ese día", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de cumpleaños");
      await crearCliente("Cliente Scope Uno", "573000000801");
      await crearCliente("Cliente Scope Dos", "573000000802");

      const { enviador, llamadas } = mockEnviador();
      const resultado = await procesarCumpleanosDelTenant(supabase, {
        idTenant: TENANT,
        ahora: AHORA_2026,
        enviador,
        soloTelefono: "573000000802",
      });

      const nombres = resultado.procesados.map((p) => p.nombre);
      assert.ok(!nombres.includes("Cliente Scope Uno"), "soloTelefono debe EXCLUIR a cualquier otro candidato del mismo día");
      assert.ok(nombres.includes("Cliente Scope Dos"));
      assert.equal(llamadas.length, 1);
      assert.equal(llamadas[0]!.telefono, "573000000802");
    });

    it("10. respeta la zona horaria configurada del tenant (America/Bogota para AMORE)", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de cumpleaños");
      const tenantBogota = randomUUID();
      const phoneBogota = `test-motor-cumple-tz-${Date.now()}`;
      try {
        await supabase
          .from("dulabs_cumpleanos_config")
          .insert({ id_tenant: tenantBogota, activo: true, mensaje: MENSAJE, zona_horaria: "America/Bogota" });
        const { data: cliente } = await supabase
          .from("dulabs_clientes_conocidos")
          .insert({ id_tenant: tenantBogota, phone_number_id: phoneBogota, telefono_cliente: "573000000901", nombre: "Cliente Bogotá", cumple_dia: 15, cumple_mes: 3 })
          .select("id")
          .single();

        // 2026-03-16T04:30:00Z -- en UTC ya es 16 de marzo, pero en
        // America/Bogota (UTC-5) todavía son las 23:30 del 15 de marzo: el
        // cumpleaños (día 15) debe encontrarse igual, porque la fecha se
        // resuelve en la zona horaria del tenant, no en UTC.
        const casiMedianocheUTC = new Date("2026-03-16T04:30:00Z");
        const { enviador, llamadas } = mockEnviador();
        const resultado = await procesarCumpleanosDelTenant(supabase, { idTenant: tenantBogota, ahora: casiMedianocheUTC, enviador });

        assert.equal(resultado.candidatos, 1);
        assert.equal(resultado.procesados[0]?.resultado, "simulado");
        assert.equal(llamadas.length, 1);

        await supabase.from("dulabs_cumpleanos_procesados").delete().eq("id_tenant", tenantBogota);
        if (cliente) await supabase.from("dulabs_clientes_conocidos").delete().eq("id", cliente.id);
      } finally {
        await supabase.from("dulabs_cumpleanos_config").delete().eq("id_tenant", tenantBogota);
      }
    });
  }
);
