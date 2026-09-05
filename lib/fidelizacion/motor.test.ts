/**
 * Fidelización (Fase 7, genérico, autorizado) — integración REAL contra
 * Supabase (tenants descartables, randomUUID, nunca AMORE ni Daniela ni
 * Solo Talento) del orquestador completo (lib/fidelizacion/motor.ts).
 *
 * SEGURIDAD: esta fase no envía WhatsApp bajo ninguna circunstancia (llega
 * en la Fase 9) -- no hay ningún "enviador" que mockear aquí, el motor solo
 * persiste oportunidades. Por la misma razón que en cumpleaños/cron de
 * seguimiento-traspaso, NUNCA se llama a la ruta HTTP del cron directamente
 * en un test (recorre TODOS los tenants con reglas activas) -- se llama
 * procesarFidelizacionDelTenant/buscarCandidatosDelTenant de forma directa,
 * acotado siempre a un tenant descartable propio.
 *
 * Requiere que las migraciones de esta fase ya se hayan corrido
 * (dulabs_fidelizacion_reglas, dulabs_fidelizacion_oportunidades) -- si no,
 * el `before()` lo detecta y todo el archivo se salta con un mensaje claro.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { procesarFidelizacionDelTenant } from "./motor";
import { buscarCandidatosDelTenant } from "./candidatos";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const MENSAJE = "Hola {{nombre}}, hace {{dias}} días de tu {{servicio}} -- prueba Fase 7, nunca se envía.";

describe(
  "Fidelización (Fase 7) — motor completo, integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let migracionesListas = false;

    const TENANT = randomUUID();
    const TENANT_OTRO = randomUUID();
    const PHONE = `test-fidelizacion-${Date.now()}`;
    let especialistaId: number;
    let servicioAId: string; // regla activa, 20 días
    let servicioBId: string; // regla activa, 10 días (test 13)
    let servicioSinReglaId: string; // test 5
    let servicioReglaInactivaId: string; // test 10
    let reglaAId: number;

    const citaIds: number[] = [];
    const clienteIds: number[] = [];
    const reglaIds: number[] = [];

    function haceNDias(n: number): string {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString();
    }

    async function crearCliente(telefono: string, nombre: string) {
      const { data, error } = await supabase
        .from("dulabs_clientes_conocidos")
        .insert({ id_tenant: TENANT, phone_number_id: PHONE, telefono_cliente: telefono, nombre })
        .select("id")
        .single();
      if (error) throw error;
      clienteIds.push(data!.id as number);
      return data!.id as number;
    }

    async function crearCita(params: { servicioId: string; telefono: string; nombre: string; inicioIso: string; estado: string }) {
      const inicio = new Date(params.inicioIso);
      const fin = new Date(inicio.getTime() + 30 * 60_000);
      const { data, error } = await supabase
        .from("dulabs_citas_especialista")
        .insert({
          especialista_id: especialistaId,
          id_tenant: TENANT,
          phone_number_id: PHONE,
          telefono_cliente: params.telefono,
          nombre_cliente: params.nombre,
          servicio: "Servicio de prueba",
          servicio_id: params.servicioId,
          inicio: inicio.toISOString(),
          fin: fin.toISOString(),
          estado: params.estado,
          bloquea_horario: false,
        })
        .select("id")
        .single();
      if (error) throw error;
      citaIds.push(data!.id as number);
      return data!.id as number;
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      const sonda = await supabase.from("dulabs_fidelizacion_reglas").select("id").limit(1);
      migracionesListas = !sonda.error;
      if (!migracionesListas) return;

      const { data: esp, error: espErr } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT, phone_number_id: PHONE, nombre: "Profesional Prueba Fase 7", numero_whatsapp: "573000000000",
          servicio: "manos", duracion_min: 30, activo: true, bloquea_horario: false, es_general: true, requiere_aprobacion: false,
        })
        .select("id")
        .single();
      if (espErr) throw espErr;
      especialistaId = esp!.id as number;

      const servicios = await supabase
        .from("dulabs_servicios")
        .insert([
          { id_tenant: TENANT, nombre: "TEST_FIDELIZACION_A", duracion_min: 30, activo: true },
          { id_tenant: TENANT, nombre: "TEST_FIDELIZACION_B", duracion_min: 30, activo: true },
          { id_tenant: TENANT, nombre: "TEST_FIDELIZACION_SIN_REGLA", duracion_min: 30, activo: true },
          { id_tenant: TENANT, nombre: "TEST_FIDELIZACION_REGLA_INACTIVA", duracion_min: 30, activo: true },
        ])
        .select("id, nombre");
      if (servicios.error) throw servicios.error;
      const porNombre = new Map(servicios.data!.map((s) => [s.nombre as string, s.id as string]));
      servicioAId = porNombre.get("TEST_FIDELIZACION_A")!;
      servicioBId = porNombre.get("TEST_FIDELIZACION_B")!;
      servicioSinReglaId = porNombre.get("TEST_FIDELIZACION_SIN_REGLA")!;
      servicioReglaInactivaId = porNombre.get("TEST_FIDELIZACION_REGLA_INACTIVA")!;

      const reglas = await supabase
        .from("dulabs_fidelizacion_reglas")
        .insert([
          { id_tenant: TENANT, servicio_id: servicioAId, dias: 20, activa: true, mensaje: MENSAJE },
          { id_tenant: TENANT, servicio_id: servicioBId, dias: 10, activa: true, mensaje: MENSAJE },
          { id_tenant: TENANT, servicio_id: servicioReglaInactivaId, dias: 5, activa: false, mensaje: MENSAJE },
        ])
        .select("id, servicio_id");
      if (reglas.error) throw reglas.error;
      reglaIds.push(...reglas.data!.map((r) => r.id as number));
      reglaAId = reglas.data!.find((r) => r.servicio_id === servicioAId)!.id as number;
    });

    after(async () => {
      if (!HAS_SUPABASE || !migracionesListas) return;
      await supabase.from("dulabs_fidelizacion_oportunidades").delete().in("id_tenant", [TENANT, TENANT_OTRO]);
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      if (clienteIds.length) await supabase.from("dulabs_clientes_conocidos").delete().in("id", clienteIds);
      if (reglaIds.length) await supabase.from("dulabs_fidelizacion_reglas").delete().in("id", reglaIds);
      await supabase.from("dulabs_servicios").delete().eq("id_tenant", TENANT);
      await supabase.from("dulabs_especialistas").delete().eq("id_tenant", TENANT);
    });

    it("1/3. servicio con regla, visita completada y ya vencida -> genera oportunidad", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de fidelización");
      await crearCliente("573001110001", "Cliente Uno Vencido");
      await crearCita({ servicioId: servicioAId, telefono: "573001110001", nombre: "Cliente Uno Vencido", inicioIso: haceNDias(20), estado: "completada" });

      const resultado = await procesarFidelizacionDelTenant(supabase, { idTenant: TENANT, dryRun: false });
      const propio = resultado.procesados.find((p) => p.nombre === "Cliente Uno Vencido");
      assert.equal(propio?.resultado, "generada");

      const { data: fila } = await supabase
        .from("dulabs_fidelizacion_oportunidades")
        .select("estado, mensaje_renderizado")
        .eq("id_tenant", TENANT)
        .eq("regla_id", reglaAId)
        .single();
      assert.equal(fila!.estado, "pendiente");
      assert.ok(fila!.mensaje_renderizado.includes("Cliente Uno Vencido"));
      assert.ok(!fila!.mensaje_renderizado.includes("{{"));
    });

    it("2. antes de los días configurados -> NO genera", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de fidelización");
      await crearCliente("573001110002", "Cliente Muy Reciente");
      await crearCita({ servicioId: servicioAId, telefono: "573001110002", nombre: "Cliente Muy Reciente", inicioIso: haceNDias(5), estado: "completada" });

      const candidatos = await buscarCandidatosDelTenant(supabase, TENANT, new Date());
      assert.ok(!candidatos.some((c) => c.nombreCliente === "Cliente Muy Reciente"));
    });

    it("4. visita CANCELADA aunque haya pasado tiempo de sobra -> NO genera", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de fidelización");
      await crearCliente("573001110004", "Cliente Cancelado");
      await crearCita({ servicioId: servicioAId, telefono: "573001110004", nombre: "Cliente Cancelado", inicioIso: haceNDias(60), estado: "cancelada" });

      const candidatos = await buscarCandidatosDelTenant(supabase, TENANT, new Date());
      assert.ok(!candidatos.some((c) => c.nombreCliente === "Cliente Cancelado"), "una cita cancelada nunca es una visita válida");
    });

    it("5. cliente con servicio SIN regla aplicable -> NO genera", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de fidelización");
      await crearCliente("573001110005", "Cliente Sin Regla");
      await crearCita({ servicioId: servicioSinReglaId, telefono: "573001110005", nombre: "Cliente Sin Regla", inicioIso: haceNDias(90), estado: "completada" });

      const candidatos = await buscarCandidatosDelTenant(supabase, TENANT, new Date());
      assert.ok(!candidatos.some((c) => c.nombreCliente === "Cliente Sin Regla"));
    });

    it("6. tenant incorrecto -> NUNCA ve candidatos de otro tenant", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de fidelización");
      // TENANT_OTRO no tiene NINGUNA regla ni servicio propio -- el motor
      // debe devolver 0 candidatos sin explotar, y jamás cruzar con las
      // reglas/citas reales de TENANT.
      const resultado = await procesarFidelizacionDelTenant(supabase, { idTenant: TENANT_OTRO, dryRun: true });
      assert.equal(resultado.candidatos, 0);
      assert.deepEqual(resultado.procesados, []);
    });

    it("10. regla desactivada -> NO genera aunque la visita esté vencida", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de fidelización");
      await crearCliente("573001110010", "Cliente Regla Inactiva");
      await crearCita({ servicioId: servicioReglaInactivaId, telefono: "573001110010", nombre: "Cliente Regla Inactiva", inicioIso: haceNDias(30), estado: "completada" });

      const candidatos = await buscarCandidatosDelTenant(supabase, TENANT, new Date());
      assert.ok(!candidatos.some((c) => c.nombreCliente === "Cliente Regla Inactiva"));
    });

    it("9. múltiples clientes con visitas vencidas el mismo día -> todos se procesan", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de fidelización");
      await crearCliente("573001110091", "Cliente Múltiple A");
      await crearCliente("573001110092", "Cliente Múltiple B");
      await crearCliente("573001110093", "Cliente Múltiple C");
      await crearCita({ servicioId: servicioAId, telefono: "573001110091", nombre: "Cliente Múltiple A", inicioIso: haceNDias(25), estado: "completada" });
      await crearCita({ servicioId: servicioAId, telefono: "573001110092", nombre: "Cliente Múltiple B", inicioIso: haceNDias(25), estado: "completada" });
      await crearCita({ servicioId: servicioAId, telefono: "573001110093", nombre: "Cliente Múltiple C", inicioIso: haceNDias(25), estado: "completada" });

      const resultado = await procesarFidelizacionDelTenant(supabase, { idTenant: TENANT, dryRun: false });
      const nombres = resultado.procesados.filter((p) => p.resultado === "generada").map((p) => p.nombre);
      assert.ok(nombres.includes("Cliente Múltiple A"));
      assert.ok(nombres.includes("Cliente Múltiple B"));
      assert.ok(nombres.includes("Cliente Múltiple C"));
    });

    it("13. diferentes servicios con diferentes reglas -> cada uno usa SU propio umbral de días", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de fidelización");
      await crearCliente("573001110131", "Cliente Servicio B Vencido");
      await crearCliente("573001110132", "Cliente Servicio B Reciente");
      // Regla B = 10 días.
      await crearCita({ servicioId: servicioBId, telefono: "573001110131", nombre: "Cliente Servicio B Vencido", inicioIso: haceNDias(10), estado: "completada" });
      await crearCita({ servicioId: servicioBId, telefono: "573001110132", nombre: "Cliente Servicio B Reciente", inicioIso: haceNDias(3), estado: "completada" });

      const candidatos = await buscarCandidatosDelTenant(supabase, TENANT, new Date());
      assert.ok(candidatos.some((c) => c.nombreCliente === "Cliente Servicio B Vencido" && c.regla.dias === 10));
      assert.ok(!candidatos.some((c) => c.nombreCliente === "Cliente Servicio B Reciente"));
    });

    it("12. dry-run encuentra candidatos pero NUNCA persiste ni envía nada", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de fidelización");
      await crearCliente("573001110120", "Cliente Dry Run");
      await crearCita({ servicioId: servicioAId, telefono: "573001110120", nombre: "Cliente Dry Run", inicioIso: haceNDias(20), estado: "completada" });

      const resultado = await procesarFidelizacionDelTenant(supabase, { idTenant: TENANT, dryRun: true });
      const propio = resultado.procesados.find((p) => p.nombre === "Cliente Dry Run");
      assert.equal(propio?.resultado, "candidato");

      const { data: filas } = await supabase
        .from("dulabs_fidelizacion_oportunidades")
        .select("id")
        .eq("id_tenant", TENANT)
        .eq("regla_id", reglaAId)
        .eq("telefono_cliente", "573001110120");
      assert.equal(filas?.length ?? 0, 0, "dry-run nunca debe escribir una oportunidad real");
    });

    it("7/8. misma visita procesada de nuevo (secuencial y CONCURRENTE) -> nunca duplica", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de fidelización");
      await crearCliente("573001110078", "Cliente Idempotente Fidelización");
      await crearCita({ servicioId: servicioAId, telefono: "573001110078", nombre: "Cliente Idempotente Fidelización", inicioIso: haceNDias(20), estado: "completada" });

      const primera = await procesarFidelizacionDelTenant(supabase, { idTenant: TENANT, dryRun: false });
      assert.equal(primera.procesados.find((p) => p.nombre === "Cliente Idempotente Fidelización")?.resultado, "generada");

      // 7. reintento secuencial -- ya_existia, cero filas nuevas.
      const segunda = await procesarFidelizacionDelTenant(supabase, { idTenant: TENANT, dryRun: false });
      assert.equal(segunda.procesados.find((p) => p.nombre === "Cliente Idempotente Fidelización")?.resultado, "ya_existia");

      const { data: filas } = await supabase
        .from("dulabs_fidelizacion_oportunidades")
        .select("id")
        .eq("id_tenant", TENANT)
        .eq("regla_id", reglaAId)
        .eq("telefono_cliente", "573001110078");
      assert.equal(filas?.length, 1, "nunca debe haber dos filas para la misma (regla, cita)");

      // 8. dos ejecuciones CONCURRENTES contra un cliente NUEVO -- la
      // garantía debe venir de Postgres (UNIQUE), no del orden de llegada.
      await crearCliente("573001110079", "Cliente Concurrente Fidelización");
      await crearCita({ servicioId: servicioAId, telefono: "573001110079", nombre: "Cliente Concurrente Fidelización", inicioIso: haceNDias(20), estado: "completada" });

      const [resA, resB] = await Promise.all([
        procesarFidelizacionDelTenant(supabase, { idTenant: TENANT, dryRun: false }),
        procesarFidelizacionDelTenant(supabase, { idTenant: TENANT, dryRun: false }),
      ]);
      const combinados = [...resA.procesados, ...resB.procesados].filter((p) => p.nombre === "Cliente Concurrente Fidelización");
      const generadas = combinados.filter((p) => p.resultado === "generada");
      const yaExistian = combinados.filter((p) => p.resultado === "ya_existia");
      assert.equal(generadas.length, 1, "exactamente UNA de las dos ejecuciones concurrentes debe ganar el claim");
      assert.equal(yaExistian.length, 1);

      const { data: filasConcurrente } = await supabase
        .from("dulabs_fidelizacion_oportunidades")
        .select("id")
        .eq("id_tenant", TENANT)
        .eq("regla_id", reglaAId)
        .eq("telefono_cliente", "573001110079");
      assert.equal(filasConcurrente?.length, 1);
    });
  }
);
