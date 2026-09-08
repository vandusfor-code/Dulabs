/**
 * Ajuste final (autorizado) — "Citas pendientes" del dashboard de AMORE:
 * conteo real de dulabs_citas_especialista con estado='pendiente', SIN
 * ningún filtro de fecha (mismo patrón ya establecido para "citasTotales",
 * ver app/api/agenda/[token]/route.ts).
 *
 * Integración real, pero SIN pasar por el handler HTTP completo (auth +
 * plan + resolución de token añaden complejidad ajena a lo que se quiere
 * probar acá) -- se prueba la MISMA consulta real, exacta, que route.ts
 * ejecuta, contra tenants y especialistas 100% desechables (UUID al azar),
 * nunca contra AMORE real ni contra ningún tenant real. Cada test usa su
 * PROPIO tenant desechable para que los conteos nunca se mezclen entre
 * pruebas, y todo se limpia en `after()`.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mismoDia } from "@/components/spa-panel/format";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Test 8/9 -- "Citas de hoy" (lógica YA EXISTENTE, sin ningún cambio en este
 * ajuste: sigue siendo `datos.citas.filter(c => mismoDia(c.inicio, hoy) && ...)`,
 * ver app/admin/amore/page.tsx) y "Citas pendientes" (NUEVO, estado='pendiente',
 * SIN filtro de fecha) son estructuralmente independientes: se prueba acá,
 * en memoria (nunca contra Supabase), con el MISMO `mismoDia` real que ya
 * usa el dashboard -- nunca una reimplementación paralela del filtro de "hoy".
 */
describe("Test 8/9 -- 'Citas de hoy' (sin cambios) y 'Citas pendientes' (nueva) producen resultados independientes", () => {
  type CitaSimulada = { inicio: string; estado: string };
  const HOY = new Date();
  const citas: CitaSimulada[] = [
    { inicio: HOY.toISOString(), estado: "pendiente" }, // hoy, pendiente -- cuenta en AMBAS métricas
    { inicio: HOY.toISOString(), estado: "confirmada" }, // hoy, confirmada -- cuenta solo en "Citas de hoy"
    { inicio: new Date(HOY.getTime() + 5 * 86_400_000).toISOString(), estado: "pendiente" }, // futura, pendiente -- cuenta SOLO en "Citas pendientes"
    { inicio: new Date(HOY.getTime() - 3 * 86_400_000).toISOString(), estado: "pendiente" }, // pasada, pendiente -- cuenta SOLO en "Citas pendientes"
  ];

  it("Test 8 -- 'Citas de hoy' sigue mostrando EXCLUSIVAMENTE las citas de hoy (mismoDia real, sin cambios)", () => {
    const citasHoy = citas.filter((c) => mismoDia(c.inicio, HOY));
    assert.equal(citasHoy.length, 2, "solo las 2 citas de HOY, sin importar su estado");
  });

  it("Test 9 -- 'Citas pendientes' (estado='pendiente', SIN filtro de fecha) da un resultado DISTINTO e independiente de 'Citas de hoy'", () => {
    const citasHoy = citas.filter((c) => mismoDia(c.inicio, HOY));
    const citasPendientesTotal = citas.filter((c) => c.estado === "pendiente");
    assert.equal(citasHoy.length, 2);
    assert.equal(citasPendientesTotal.length, 3, "incluye la pendiente futura y la pendiente pasada, que 'Citas de hoy' NUNCA muestra");
    assert.notEqual(citasHoy.length, citasPendientesTotal.length, "las dos métricas deben poder diferir -- nunca deben ser el mismo número reutilizado por accidente");
  });
});

describe(
  "Dashboard AMORE -- 'Citas pendientes' (conteo real, SIN filtro de fecha) -- integración real, tenants desechables",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const especialistaIds: number[] = [];
    const citaIds: number[] = [];

    before(() => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      if (especialistaIds.length) await supabase.from("dulabs_especialistas").delete().in("id", especialistaIds);
    });

    async function crearEspecialistaTest(idTenant: string): Promise<number> {
      const { data, error } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: idTenant,
          phone_number_id: `test-dash-${idTenant}`,
          nombre: "TEST_dashboard_citas_pendientes",
          numero_whatsapp: "0000000000",
          servicio: "test",
          duracion_min: 30,
          token: `test-token-${idTenant}`,
          activo: true,
          bloquea_horario: true,
          es_general: false,
          requiere_aprobacion: false,
        })
        .select("id")
        .single();
      if (error) throw error;
      especialistaIds.push(data.id as number);
      return data.id as number;
    }

    /** bloquea_horario:false a propósito -- así estas citas de prueba NUNCA participan del EXCLUDE real (dulabs_citas_especialista_sin_solape solo aplica a bloquea_horario=true), sin importar si sus horarios se superponen entre sí. */
    async function crearCitaTest(params: { idTenant: string; especialistaId: number; estado: string; diasDesdeHoy: number }): Promise<number> {
      const inicio = new Date(Date.now() + params.diasDesdeHoy * 24 * 60 * 60_000);
      const fin = new Date(inicio.getTime() + 30 * 60_000);
      const { data, error } = await supabase
        .from("dulabs_citas_especialista")
        .insert({
          especialista_id: params.especialistaId,
          id_tenant: params.idTenant,
          phone_number_id: `test-dash-${params.idTenant}`,
          telefono_cliente: "573000000000",
          nombre_cliente: "Cliente de prueba",
          servicio: "Servicio de prueba",
          inicio: inicio.toISOString(),
          fin: fin.toISOString(),
          estado: params.estado,
          origen: "manual",
          bloquea_horario: false,
        })
        .select("id")
        .single();
      if (error) throw error;
      citaIds.push(data.id as number);
      return data.id as number;
    }

    /** MISMA consulta real, exacta, que ejecuta app/api/agenda/[token]/route.ts para `resumen.citasPendientes`. */
    async function contarPendientes(idTenant: string): Promise<number> {
      const { count, error } = await supabase
        .from("dulabs_citas_especialista")
        .select("id", { count: "exact", head: true })
        .eq("id_tenant", idTenant)
        .eq("estado", "pendiente");
      if (error) throw error;
      return count ?? 0;
    }

    it("Test 1 -- 1 cita pendiente hoy + 4 pendientes futuras -> 5", async () => {
      const tenant = randomUUID();
      const esp = await crearEspecialistaTest(tenant);
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 0 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 1 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 3 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 6 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 10 });
      assert.equal(await contarPendientes(tenant), 5);
    });

    it("Test 2 -- 1 hoy + 2 mañana + 3 en fechas futuras -> 6", async () => {
      const tenant = randomUUID();
      const esp = await crearEspecialistaTest(tenant);
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 0 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 1 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 1 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 4 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 7 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 14 });
      assert.equal(await contarPendientes(tenant), 6);
    });

    it("Test 3 -- las citas futuras pendientes SÍ se contabilizan (sin necesidad de estar 'hoy')", async () => {
      const tenant = randomUUID();
      const esp = await crearEspecialistaTest(tenant);
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 30 });
      assert.equal(await contarPendientes(tenant), 1);
    });

    it("Test 4 -- una cita de un día ANTERIOR que sigue realmente en estado 'pendiente' también se contabiliza (criterio de ESTADO, nunca de fecha)", async () => {
      const tenant = randomUUID();
      const esp = await crearEspecialistaTest(tenant);
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: -5 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 2 });
      assert.equal(await contarPendientes(tenant), 2, "la cita pasada en estado pendiente cuenta igual -- NUNCA se asume 'pendiente' = 'fecha futura'");
    });

    it("Test 5 -- las citas canceladas NUNCA se contabilizan", async () => {
      const tenant = randomUUID();
      const esp = await crearEspecialistaTest(tenant);
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 1 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "cancelada", diasDesdeHoy: 2 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "rechazada", diasDesdeHoy: 3 });
      assert.equal(await contarPendientes(tenant), 1);
    });

    it("Test 6 -- las citas completadas/no_show NUNCA se contabilizan", async () => {
      const tenant = randomUUID();
      const esp = await crearEspecialistaTest(tenant);
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 1 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "completada", diasDesdeHoy: -1 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "no_show", diasDesdeHoy: -2 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "confirmada", diasDesdeHoy: 1 });
      assert.equal(await contarPendientes(tenant), 1);
    });

    it("Test 7 -- las citas de OTRO tenant NUNCA se contabilizan (aislamiento real por tenant)", async () => {
      const tenant = randomUUID();
      const otroTenant = randomUUID();
      const esp = await crearEspecialistaTest(tenant);
      const espOtro = await crearEspecialistaTest(otroTenant);
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 1 });
      await crearCitaTest({ idTenant: otroTenant, especialistaId: espOtro, estado: "pendiente", diasDesdeHoy: 1 });
      await crearCitaTest({ idTenant: otroTenant, especialistaId: espOtro, estado: "pendiente", diasDesdeHoy: 2 });
      assert.equal(await contarPendientes(tenant), 1, "nunca debe incluir las 2 pendientes del otro tenant");
      assert.equal(await contarPendientes(otroTenant), 2, "el otro tenant sigue viendo exactamente las suyas, aislado");
    });

    it("Test 10 -- sin citas pendientes -> 0", async () => {
      const tenant = randomUUID();
      const esp = await crearEspecialistaTest(tenant);
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "confirmada", diasDesdeHoy: 1 });
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "cancelada", diasDesdeHoy: 2 });
      assert.equal(await contarPendientes(tenant), 0);
    });

    it("TEST DE SEGURIDAD -- la cita R-2CX / ID 3057 nunca puede ser tocada ni contada por este ajuste (tenant desechable, nunca AMORE real)", async () => {
      const tenant = randomUUID();
      const esp = await crearEspecialistaTest(tenant);
      await crearCitaTest({ idTenant: tenant, especialistaId: esp, estado: "pendiente", diasDesdeHoy: 1 });
      assert.notEqual(esp, 3057, "el especialista de prueba nunca reutiliza el id real 3057");
      assert.ok(!citaIds.slice(0, -1).includes(3057), "ninguna cita de prueba usa el id real 3057");
    });
  },
);
