/**
 * Contabilidad (Fase 10, genérico, autorizado) — integración REAL contra
 * Supabase (tenants descartables, randomUUID, nunca Daniela ni Solo
 * Talento) del orquestador completo (lib/contabilidad/reporte.ts).
 *
 * Los 20 escenarios pedidos se agrupan en 3 tenants descartables + 1
 * lectura de solo-lectura sobre el tenant REAL de AMORE (sin escribir nada
 * ahí, ver escenario 19). NUNCA se llama la ruta HTTP directamente -- se
 * llama generarReporteContabilidad de forma directa, mismo criterio que
 * cumpleaños/fidelización/comunicaciones/whatsapp-qr en este proyecto.
 *
 * Requiere que la migración de comisión por servicio ya se haya corrido
 * (dulabs_servicios.comision_tipo/comision_valor, ver
 * 20260924000000_amore_comision_servicio.sql) -- si no, el `before()` lo
 * detecta y todo el archivo se salta con un mensaje claro.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generarReporteContabilidad } from "./reporte";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const AMORE_TENANT_ID = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";

// Miércoles 18 de marzo de 2026, 10:00 a.m. Bogotá -- mismo instante que
// periodo.test.ts, lejos de cualquier borde de semana/mes.
const AHORA = new Date("2026-03-18T15:00:00Z");
const LUNES_MISMA_SEMANA = new Date("2026-03-16T15:00:00Z");
const MES_ANTERIOR = new Date("2026-02-15T15:00:00Z");

describe(
  "Contabilidad (Fase 10) — reporte completo, integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let migracionesListas = false;

    const tenantsCreados: string[] = [];
    const especialistaIds: number[] = [];
    const servicioIds: string[] = [];
    const citaIds: number[] = [];

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const sonda = await supabase.from("dulabs_servicios").select("comision_tipo").limit(1);
      migracionesListas = !sonda.error;
    });

    after(async () => {
      if (!HAS_SUPABASE || !migracionesListas) return;
      if (citaIds.length) {
        await supabase.from("dulabs_cita_servicios").delete().in("cita_id", citaIds);
        await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      }
      if (especialistaIds.length) await supabase.from("dulabs_especialistas").delete().in("id", especialistaIds);
      if (servicioIds.length) await supabase.from("dulabs_servicios").delete().in("id", servicioIds);
    });

    function nuevoTenant(): string {
      const id = randomUUID();
      tenantsCreados.push(id);
      return id;
    }

    async function crearEspecialista(idTenant: string, nombre: string): Promise<number> {
      const { data, error } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: idTenant,
          phone_number_id: `test-contabilidad-${idTenant}`,
          nombre,
          numero_whatsapp: `57300${Math.floor(Math.random() * 10_000_000)}`,
          servicio: "general",
        })
        .select("id")
        .single();
      if (error) throw error;
      especialistaIds.push(data!.id as number);
      return data!.id as number;
    }

    async function crearServicio(
      idTenant: string,
      nombre: string,
      precio: number | null,
      comision?: { tipo: "porcentaje" | "valor_fijo"; valor: number }
    ): Promise<string> {
      const { data, error } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: idTenant, nombre, precio, duracion_min: 30, comision_tipo: comision?.tipo ?? null, comision_valor: comision?.valor ?? null })
        .select("id")
        .single();
      if (error) throw error;
      servicioIds.push(data!.id as string);
      return data!.id as string;
    }

    async function crearCita(params: {
      idTenant: string;
      especialistaId: number;
      servicioId: string | null;
      servicioTexto: string;
      inicio: Date;
      estado: string;
    }): Promise<number> {
      const fin = new Date(params.inicio.getTime() + 30 * 60_000);
      const { data, error } = await supabase
        .from("dulabs_citas_especialista")
        .insert({
          id_tenant: params.idTenant,
          especialista_id: params.especialistaId,
          phone_number_id: `test-contabilidad-${params.idTenant}`,
          nombre_cliente: "Cliente de prueba Fase 10",
          servicio: params.servicioTexto,
          servicio_id: params.servicioId,
          inicio: params.inicio.toISOString(),
          fin: fin.toISOString(),
          estado: params.estado,
        })
        .select("id")
        .single();
      if (error) throw error;
      citaIds.push(data!.id as number);
      return data!.id as number;
    }

    // Fase 3 (multi-servicio, ya existente) -- misma tabla puente real que
    // usa reserva-servicio-nylas.ts (dulabs_cita_servicios): la cita en sí
    // sigue guardando servicio/servicio_id/precio_total del PRIMER servicio
    // (compatibilidad histórica), y el detalle real de los 2-3 servicios
    // vive en el puente -- exactamente lo que lee obtenerLineasMultiServicioPorCita.
    async function crearCitaMultiServicio(params: {
      idTenant: string;
      especialistaId: number;
      servicios: { id: string; nombre: string; precio: number }[];
      inicio: Date;
    }): Promise<number> {
      const precioTotal = params.servicios.reduce((total, s) => total + s.precio, 0);
      const citaId = await crearCita({
        idTenant: params.idTenant,
        especialistaId: params.especialistaId,
        servicioId: params.servicios[0]!.id,
        servicioTexto: params.servicios.map((s) => s.nombre).join(" + "),
        inicio: params.inicio,
        estado: "completada",
      });
      await supabase.from("dulabs_citas_especialista").update({ precio_total: precioTotal }).eq("id", citaId);
      const { error } = await supabase.from("dulabs_cita_servicios").insert(
        params.servicios.map((s, i) => ({ cita_id: citaId, id_tenant: params.idTenant, servicio_id: s.id, orden: i + 1 }))
      );
      if (error) throw error;
      return citaId;
    }

    // ------------------------------------------------------------------
    // Grupo 1: escenarios 1-14 (ingreso válido, exclusiones, filtros,
    // "sin precio configurado", comparación con período anterior).
    // ------------------------------------------------------------------
    describe("ingreso válido, exclusiones, filtros y comparación", () => {
      const TENANT = randomUUID();
      let especialistaA: number, especialistaB: number;
      let servicioConPrecio: string, servicioSinPrecio: string;

      before(async () => {
        if (!migracionesListas) return;
        tenantsCreados.push(TENANT);
        especialistaA = await crearEspecialista(TENANT, "Especialista A");
        especialistaB = await crearEspecialista(TENANT, "Especialista B");
        servicioConPrecio = await crearServicio(TENANT, "Servicio Con Precio", 50000);
        servicioSinPrecio = await crearServicio(TENANT, "Servicio Sin Precio", null);

        // 1. completada con precio (hoy, especialista A)
        await crearCita({ idTenant: TENANT, especialistaId: especialistaA, servicioId: servicioConPrecio, servicioTexto: "Servicio Con Precio", inicio: AHORA, estado: "completada" });
        // 2-5. NO deben contar como ingreso (mismo día, mismo especialista/servicio)
        await crearCita({ idTenant: TENANT, especialistaId: especialistaA, servicioId: servicioConPrecio, servicioTexto: "Servicio Con Precio", inicio: AHORA, estado: "cancelada" });
        await crearCita({ idTenant: TENANT, especialistaId: especialistaA, servicioId: servicioConPrecio, servicioTexto: "Servicio Con Precio", inicio: AHORA, estado: "pendiente" });
        await crearCita({ idTenant: TENANT, especialistaId: especialistaA, servicioId: servicioConPrecio, servicioTexto: "Servicio Con Precio", inicio: AHORA, estado: "no_show" });
        await crearCita({ idTenant: TENANT, especialistaId: especialistaA, servicioId: servicioConPrecio, servicioTexto: "Servicio Con Precio", inicio: AHORA, estado: "rechazada" });
        // 6. completada SIN servicio_id (legacy, solo texto libre)
        await crearCita({ idTenant: TENANT, especialistaId: especialistaA, servicioId: null, servicioTexto: "Corte manual sin catálogo", inicio: AHORA, estado: "completada" });
        // 7. completada con servicio_id pero el servicio NO tiene precio
        await crearCita({ idTenant: TENANT, especialistaId: especialistaB, servicioId: servicioSinPrecio, servicioTexto: "Servicio Sin Precio", inicio: AHORA, estado: "completada" });
        // Misma semana, no "hoy" (especialista B)
        await crearCita({ idTenant: TENANT, especialistaId: especialistaB, servicioId: servicioConPrecio, servicioTexto: "Servicio Con Precio", inicio: LUNES_MISMA_SEMANA, estado: "completada" });
        // Mes anterior (para "mes" negativo y comparación)
        await crearCita({ idTenant: TENANT, especialistaId: especialistaA, servicioId: servicioConPrecio, servicioTexto: "Servicio Con Precio", inicio: MES_ANTERIOR, estado: "completada" });
      });

      it("1/2/3/4/5/6/7. periodo=hoy: solo cuentan las completadas; cancelada/pendiente/no_show/rechazada nunca cuentan; sin precio configurado no rompe ni inventa valor", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración");
        const resultado = await generarReporteContabilidad(supabase, { idTenant: TENANT, periodo: "hoy", ahora: AHORA });
        assert.ok(resultado.ok);
        // 3 citas completadas "hoy": con precio (50000), sin servicio_id (null), servicio sin precio (null)
        assert.equal(resultado.reporte.citasCompletadas, 3);
        assert.equal(resultado.reporte.ingresos.actual, 50000);

        const sinServicio = resultado.reporte.movimientos.find((m) => m.servicio === "Corte manual sin catálogo");
        assert.equal(sinServicio?.valor, null);
        const servicioSinPrecioMov = resultado.reporte.movimientos.find((m) => m.servicio === "Servicio Sin Precio");
        assert.equal(servicioSinPrecioMov?.valor, null);
      });

      it("9. periodo=semana: incluye la cita del lunes (misma semana), no la del mes anterior", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración");
        const resultado = await generarReporteContabilidad(supabase, { idTenant: TENANT, periodo: "semana", ahora: AHORA });
        assert.ok(resultado.ok);
        assert.equal(resultado.reporte.citasCompletadas, 4); // las 3 de "hoy" + la del lunes
        assert.equal(resultado.reporte.ingresos.actual, 100000); // 50000 (hoy) + 50000 (lunes)
      });

      it("10. periodo=mes: excluye la cita del mes anterior", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración");
        const resultado = await generarReporteContabilidad(supabase, { idTenant: TENANT, periodo: "mes", ahora: AHORA });
        assert.ok(resultado.ok);
        assert.equal(resultado.reporte.citasCompletadas, 4);
        assert.equal(resultado.reporte.ingresos.actual, 100000);
      });

      it("11. rango personalizado: captura solo el mes anterior", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración");
        const resultado = await generarReporteContabilidad(supabase, {
          idTenant: TENANT,
          periodo: "personalizado",
          personalizado: { desde: "2026-02-01", hasta: "2026-02-28" },
          ahora: AHORA,
        });
        assert.ok(resultado.ok);
        assert.equal(resultado.reporte.citasCompletadas, 1);
        assert.equal(resultado.reporte.ingresos.actual, 50000);
      });

      it("12. filtro por especialista (ID real, no texto)", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración");
        const resultado = await generarReporteContabilidad(supabase, { idTenant: TENANT, periodo: "mes", especialistaId: especialistaA, ahora: AHORA });
        assert.ok(resultado.ok);
        // especialista A en marzo: con precio (hoy) + sin servicio (hoy) = 2, ingresos 50000
        assert.equal(resultado.reporte.citasCompletadas, 2);
        assert.equal(resultado.reporte.ingresos.actual, 50000);
      });

      it("13. filtro por servicio (ID real, no texto)", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración");
        const resultado = await generarReporteContabilidad(supabase, { idTenant: TENANT, periodo: "mes", servicioId: servicioConPrecio, ahora: AHORA });
        assert.ok(resultado.ok);
        // servicioConPrecio en marzo: hoy (A) + lunes (B) = 2, ingresos 100000
        assert.equal(resultado.reporte.citasCompletadas, 2);
        assert.equal(resultado.reporte.ingresos.actual, 100000);
      });

      it("14. comparación con período anterior", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración");
        const resultado = await generarReporteContabilidad(supabase, { idTenant: TENANT, periodo: "mes", ahora: AHORA });
        assert.ok(resultado.ok);
        assert.equal(resultado.reporte.ingresos.anterior, 50000); // la cita de febrero
        assert.equal(resultado.reporte.ingresos.variacionPorcentual, 100); // (100000-50000)/50000*100
      });
    });

    // ------------------------------------------------------------------
    // Grupo 2: escenarios 15-17 (comisiones) -- NUEVA FASE: la comisión ahora
    // se configura POR SERVICIO (dulabs_servicios.comision_tipo/comision_valor),
    // no por especialista -- cada profesional puede comisionar distinto según
    // qué servicio real completó.
    // ------------------------------------------------------------------
    describe("comisiones (por servicio)", () => {
      const TENANT = randomUUID();
      let especialistaPorcentaje: number, especialistaValorFijo: number, especialistaSinComision: number, especialistaMultiServicio: number;
      let servicioPorcentaje: string, servicioValorFijo: string, servicioSinComision: string;
      let manicure: string, pedicure: string, cejas: string;

      before(async () => {
        if (!migracionesListas) return;
        tenantsCreados.push(TENANT);
        especialistaPorcentaje = await crearEspecialista(TENANT, "Comisión Porcentaje");
        especialistaValorFijo = await crearEspecialista(TENANT, "Comisión Fija");
        especialistaSinComision = await crearEspecialista(TENANT, "Sin Comisión");
        especialistaMultiServicio = await crearEspecialista(TENANT, "Mary (multi-servicio)");

        servicioPorcentaje = await crearServicio(TENANT, "Servicio 40%", 50000, { tipo: "porcentaje", valor: 40 });
        servicioValorFijo = await crearServicio(TENANT, "Servicio Fijo", 50000, { tipo: "valor_fijo", valor: 20000 });
        servicioSinComision = await crearServicio(TENANT, "Servicio Sin Comisión", 50000);
        // Ejemplo real pedido por el negocio: Manicure $30.000 (20%),
        // Pedicure $40.000 (10%), Cejas $20.000 (valor fijo $5.000).
        manicure = await crearServicio(TENANT, "Manicure", 30000, { tipo: "porcentaje", valor: 20 });
        pedicure = await crearServicio(TENANT, "Pedicure", 40000, { tipo: "porcentaje", valor: 10 });
        cejas = await crearServicio(TENANT, "Cejas", 20000, { tipo: "valor_fijo", valor: 5000 });

        await crearCita({ idTenant: TENANT, especialistaId: especialistaPorcentaje, servicioId: servicioPorcentaje, servicioTexto: "Servicio 40%", inicio: AHORA, estado: "completada" });
        await crearCita({ idTenant: TENANT, especialistaId: especialistaValorFijo, servicioId: servicioValorFijo, servicioTexto: "Servicio Fijo", inicio: AHORA, estado: "completada" });
        await crearCita({ idTenant: TENANT, especialistaId: especialistaValorFijo, servicioId: servicioValorFijo, servicioTexto: "Servicio Fijo", inicio: AHORA, estado: "completada" });
        await crearCita({ idTenant: TENANT, especialistaId: especialistaSinComision, servicioId: servicioSinComision, servicioTexto: "Servicio Sin Comisión", inicio: AHORA, estado: "completada" });
      });

      it("15. comisión por porcentaje: precio_del_servicio * valor / 100", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración");
        const resultado = await generarReporteContabilidad(supabase, { idTenant: TENANT, periodo: "hoy", ahora: AHORA });
        assert.ok(resultado.ok);
        const fila = resultado.reporte.porProfesional.find((p) => p.especialistaId === especialistaPorcentaje);
        assert.equal(fila?.ingresos, 50000);
        assert.deepEqual(fila?.comision, { estado: "configurada", monto: 20000 }); // 50000 * 40%
      });

      it("16. comisión por valor fijo: un monto fijo por CADA servicio completado (no por cita)", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración");
        const resultado = await generarReporteContabilidad(supabase, { idTenant: TENANT, periodo: "hoy", ahora: AHORA });
        assert.ok(resultado.ok);
        const fila = resultado.reporte.porProfesional.find((p) => p.especialistaId === especialistaValorFijo);
        assert.equal(fila?.cantidad, 2);
        assert.equal(fila?.ingresos, 100000);
        assert.deepEqual(fila?.comision, { estado: "configurada", monto: 40000 }); // 20000 + 20000
      });

      it("17. servicio sin comisión configurada -> 'no_configurada', nunca un porcentaje inventado", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración");
        const resultado = await generarReporteContabilidad(supabase, { idTenant: TENANT, periodo: "hoy", ahora: AHORA });
        assert.ok(resultado.ok);
        const fila = resultado.reporte.porProfesional.find((p) => p.especialistaId === especialistaSinComision);
        assert.deepEqual(fila?.comision, { estado: "no_configurada" });
      });

      it("15b. cita multi-servicio: cada servicio real se comisiona con SU PROPIA configuración (ejemplo real del negocio)", async (t) => {
        if (!migracionesListas) return t.skip("falta la migración");
        await crearCitaMultiServicio({
          idTenant: TENANT,
          especialistaId: especialistaMultiServicio,
          servicios: [
            { id: manicure, nombre: "Manicure", precio: 30000 },
            { id: pedicure, nombre: "Pedicure", precio: 40000 },
            { id: cejas, nombre: "Cejas", precio: 20000 },
          ],
          inicio: AHORA,
        });
        const resultado = await generarReporteContabilidad(supabase, { idTenant: TENANT, periodo: "hoy", ahora: AHORA });
        assert.ok(resultado.ok);
        const fila = resultado.reporte.porProfesional.find((p) => p.especialistaId === especialistaMultiServicio);
        assert.equal(fila?.ingresos, 90000); // 30000 + 40000 + 20000 (precio_total real)
        // 30000*20% + 40000*10% + 5000 fijo = 6000 + 4000 + 5000 = 15000
        assert.deepEqual(fila?.comision, { estado: "configurada", monto: 15000 });
      });
    });

    // ------------------------------------------------------------------
    // Grupo 3: escenario 18 (aislamiento entre tenants).
    // ------------------------------------------------------------------
    it("18. aislamiento entre tenants: el ingreso de un tenant nunca aparece en el reporte de otro", async (t) => {
      if (!migracionesListas) return t.skip("falta la migración de comisión por servicio");
      const TENANT_X = nuevoTenant();
      const TENANT_Y = nuevoTenant();
      const espX = await crearEspecialista(TENANT_X, "Especialista X");
      const espY = await crearEspecialista(TENANT_Y, "Especialista Y");
      const servX = await crearServicio(TENANT_X, "Servicio X", 70000);
      const servY = await crearServicio(TENANT_Y, "Servicio Y", 30000);
      await crearCita({ idTenant: TENANT_X, especialistaId: espX, servicioId: servX, servicioTexto: "Servicio X", inicio: AHORA, estado: "completada" });
      await crearCita({ idTenant: TENANT_Y, especialistaId: espY, servicioId: servY, servicioTexto: "Servicio Y", inicio: AHORA, estado: "completada" });

      const reporteX = await generarReporteContabilidad(supabase, { idTenant: TENANT_X, periodo: "hoy", ahora: AHORA });
      const reporteY = await generarReporteContabilidad(supabase, { idTenant: TENANT_Y, periodo: "hoy", ahora: AHORA });
      assert.ok(reporteX.ok && reporteY.ok);
      assert.equal(reporteX.reporte.ingresos.actual, 70000);
      assert.equal(reporteY.reporte.ingresos.actual, 30000);
      assert.ok(!reporteX.reporte.movimientos.some((m) => m.servicio === "Servicio Y"));
      assert.ok(!reporteY.reporte.movimientos.some((m) => m.servicio === "Servicio X"));
    });

    // ------------------------------------------------------------------
    // Escenario 19: AMORE real, SOLO LECTURA -- nunca se escribe nada acá.
    // ------------------------------------------------------------------
    it("19. AMORE (tenant real) sin citas/clientes -> métricas en cero, nunca se inventan datos", async () => {
      const resultado = await generarReporteContabilidad(supabase, { idTenant: AMORE_TENANT_ID, periodo: "mes" });
      assert.ok(resultado.ok);
      assert.equal(resultado.reporte.ingresos.actual, 0);
      assert.equal(resultado.reporte.citasCompletadas, 0);
      assert.deepEqual(resultado.reporte.movimientos, []);
      assert.deepEqual(resultado.reporte.porServicio, []);
      assert.deepEqual(resultado.reporte.porProfesional, []);
    });

    // Escenario 20 (ausencia de residuos de prueba) se verifica DESPUÉS de
    // esta corrida completa: el after() de arriba borra citas/servicios/
    // especialistas/comisiones de todos los tenantsCreados, y una consulta
    // de solo lectura posterior (fuera de este archivo, ver reporte final)
    // confirma 0 filas restantes -- mismo criterio que el resto de fases.
  }
);
