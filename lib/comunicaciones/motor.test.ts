/**
 * Confirmaciones y recordatorios (Fase 8, genérico, autorizado) —
 * integración REAL contra Supabase (tenants descartables, randomUUID, nunca
 * AMORE ni Daniela ni Solo Talento) del orquestador completo
 * (lib/comunicaciones/motor.ts).
 *
 * SEGURIDAD: esta fase no tiene ningún canal real de envío -- el motor
 * SIEMPRE usa un adaptador simulado (nunca toca WhatsApp/Meta/QR bajo
 * ninguna circunstancia). Por la misma razón documentada en
 * cumpleaños/fidelización/seguimiento-traspaso, NUNCA se llama a la ruta
 * HTTP del cron directamente en un test (recorre TODOS los tenants
 * activos) -- se llama procesarComunicacionesDelTenant de forma directa,
 * acotado siempre a un tenant descartable propio.
 *
 * Requiere que las migraciones de esta fase ya se hayan corrido
 * (dulabs_comunicaciones_config, dulabs_comunicaciones_procesadas) -- si
 * no, el `before()` lo detecta y todo el archivo se salta con un mensaje
 * claro.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { procesarComunicacionesDelTenant } from "./motor";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const MENSAJE_CONFIRMACION = "Confirmada: {{servicio}} con {{profesional}} el {{fecha}} a las {{hora}} -- prueba Fase 8, nunca se envía.";
const MENSAJE_RECORDATORIO = "Hola {{nombre}}, recordatorio de {{servicio}} con {{profesional}} el {{fecha}} a las {{hora}} -- prueba Fase 8.";
const ANTICIPACION_HORAS = 24;

describe(
  "Confirmaciones y recordatorios (Fase 8) — motor completo, integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let migracionesListas = false;

    const TENANT = randomUUID();
    const TENANT_OTRO = randomUUID();
    const TENANT_DESACTIVADO = randomUUID();
    const PHONE = `test-comunicaciones-${Date.now()}`;
    let especialistaId: number;

    const citaIds: number[] = [];

    function horasDesdeAhora(h: number): string {
      return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
    }

    async function crearCita(params: { telefono: string; nombre: string; inicioIso: string; estado: string }) {
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
          servicio: "Servicio de prueba Fase 8",
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

      const sonda = await supabase.from("dulabs_comunicaciones_config").select("id_tenant").limit(1);
      migracionesListas = !sonda.error;
      if (!migracionesListas) return;

      const { data: esp, error: espErr } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT, phone_number_id: PHONE, nombre: "Profesional Prueba Fase 8", numero_whatsapp: "573000000000",
          servicio: "manos", duracion_min: 30, activo: true, bloquea_horario: false, es_general: true, requiere_aprobacion: false,
        })
        .select("id")
        .single();
      if (espErr) throw espErr;
      especialistaId = esp!.id as number;

      await supabase.from("dulabs_comunicaciones_config").insert([
        {
          id_tenant: TENANT, confirmacion_activa: true, confirmacion_mensaje: MENSAJE_CONFIRMACION,
          recordatorio_activo: true, recordatorio_anticipacion_horas: ANTICIPACION_HORAS, recordatorio_mensaje: MENSAJE_RECORDATORIO,
        },
        {
          id_tenant: TENANT_DESACTIVADO, confirmacion_activa: false, confirmacion_mensaje: MENSAJE_CONFIRMACION,
          recordatorio_activo: false, recordatorio_anticipacion_horas: ANTICIPACION_HORAS, recordatorio_mensaje: MENSAJE_RECORDATORIO,
        },
      ]);
    });

    after(async () => {
      if (!HAS_SUPABASE || !migracionesListas) return;
      await supabase.from("dulabs_comunicaciones_procesadas").delete().in("id_tenant", [TENANT, TENANT_OTRO, TENANT_DESACTIVADO]);
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      await supabase.from("dulabs_comunicaciones_config").delete().in("id_tenant", [TENANT, TENANT_DESACTIVADO]);
      await supabase.from("dulabs_especialistas").delete().eq("id_tenant", TENANT);
    });

    it("1. confirmación de cita válida (confirmada, futura) -> se procesa", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de comunicaciones");
      const citaId = await crearCita({ telefono: "573002220001", nombre: "Cliente Confirmación", inicioIso: horasDesdeAhora(48), estado: "confirmada" });

      const resultado = await procesarComunicacionesDelTenant(supabase, { idTenant: TENANT, dryRun: false });
      const propio = resultado.procesados.find((p) => p.citaId === citaId && p.tipo === "confirmacion");
      assert.equal(propio?.resultado, "procesada");

      const { data: fila } = await supabase
        .from("dulabs_comunicaciones_procesadas")
        .select("estado, mensaje_renderizado")
        .eq("id_tenant", TENANT)
        .eq("cita_id", citaId)
        .eq("tipo", "confirmacion")
        .single();
      assert.equal(fila!.estado, "simulado");
      assert.ok(!fila!.mensaje_renderizado.includes("{{"));

      // 4. Esta misma cita está a 48h -- fuera de la ventana de recordatorio (24h) -> NO candidata a recordatorio todavía.
      const recordatorioPropio = resultado.procesados.find((p) => p.citaId === citaId && p.tipo === "recordatorio");
      assert.equal(recordatorioPropio, undefined, "a 48h de la cita, todavía no debe generarse el recordatorio (anticipación 24h)");
    });

    it("2. cita CANCELADA -> nunca se comunica (ni confirmación ni recordatorio)", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de comunicaciones");
      const citaId = await crearCita({ telefono: "573002220002", nombre: "Cliente Cancelado", inicioIso: horasDesdeAhora(12), estado: "cancelada" });

      const resultado = await procesarComunicacionesDelTenant(supabase, { idTenant: TENANT, dryRun: true });
      assert.ok(!resultado.procesados.some((p) => p.citaId === citaId), "una cita cancelada nunca es candidata, sin importar cuán cerca esté");
    });

    it("3. recordatorio DENTRO del tiempo configurado -> se procesa", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de comunicaciones");
      const citaId = await crearCita({ telefono: "573002220003", nombre: "Cliente Recordatorio", inicioIso: horasDesdeAhora(12), estado: "confirmada" });

      const resultado = await procesarComunicacionesDelTenant(supabase, { idTenant: TENANT, dryRun: false });
      const recordatorio = resultado.procesados.find((p) => p.citaId === citaId && p.tipo === "recordatorio");
      assert.equal(recordatorio?.resultado, "procesada");

      const { data: fila } = await supabase
        .from("dulabs_comunicaciones_procesadas")
        .select("mensaje_renderizado")
        .eq("id_tenant", TENANT)
        .eq("cita_id", citaId)
        .eq("tipo", "recordatorio")
        .single();
      assert.ok(fila!.mensaje_renderizado.includes("Cliente Recordatorio"));
    });

    it("9. tenant incorrecto -> aislamiento total (nunca ve ni procesa citas de otro tenant)", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de comunicaciones");
      // TENANT_OTRO no tiene NINGUNA configuración ni cita propia.
      const resultado = await procesarComunicacionesDelTenant(supabase, { idTenant: TENANT_OTRO, dryRun: true });
      assert.equal(resultado.candidatos, 0);
      assert.deepEqual(resultado.procesados, []);
    });

    it("10. configuración desactivada -> no comunica aunque existan citas elegibles", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de comunicaciones");
      // Cita real en el tenant DESACTIVADO -- requiere su propio especialista (FK).
      const { data: espDesactivado } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_DESACTIVADO, phone_number_id: `${PHONE}-desactivado`, nombre: "Profesional Desactivado", numero_whatsapp: "573000000001",
          servicio: "manos", duracion_min: 30, activo: true, bloquea_horario: false, es_general: true, requiere_aprobacion: false,
        })
        .select("id")
        .single();
      const { data: citaDesactivada } = await supabase
        .from("dulabs_citas_especialista")
        .insert({
          especialista_id: espDesactivado!.id, id_tenant: TENANT_DESACTIVADO, phone_number_id: `${PHONE}-desactivado`,
          telefono_cliente: "573002220010", nombre_cliente: "Cliente Desactivado", servicio: "Servicio de prueba",
          inicio: horasDesdeAhora(12), fin: horasDesdeAhora(12.5), estado: "confirmada", bloquea_horario: false,
        })
        .select("id")
        .single();

      const resultado = await procesarComunicacionesDelTenant(supabase, { idTenant: TENANT_DESACTIVADO, dryRun: true });
      assert.equal(resultado.candidatos, 0, "confirmacion_activa=false y recordatorio_activo=false -> cero candidatos");

      await supabase.from("dulabs_citas_especialista").delete().eq("id", citaDesactivada!.id);
      await supabase.from("dulabs_especialistas").delete().eq("id", espDesactivado!.id);
    });

    it("12. dry-run identifica candidatos pero NUNCA persiste ni envía nada", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de comunicaciones");
      const citaId = await crearCita({ telefono: "573002220012", nombre: "Cliente Dry Run", inicioIso: horasDesdeAhora(12), estado: "confirmada" });

      const resultado = await procesarComunicacionesDelTenant(supabase, { idTenant: TENANT, dryRun: true });
      assert.equal(resultado.procesados.find((p) => p.citaId === citaId && p.tipo === "confirmacion")?.resultado, "candidata");
      assert.equal(resultado.procesados.find((p) => p.citaId === citaId && p.tipo === "recordatorio")?.resultado, "candidata");

      const { data: filas } = await supabase.from("dulabs_comunicaciones_procesadas").select("id").eq("id_tenant", TENANT).eq("cita_id", citaId);
      assert.equal(filas?.length ?? 0, 0, "dry-run nunca debe escribir una comunicación real");
    });

    it("13. cita cancelada DESPUÉS de calificar pero ANTES de correr el motor -> no se comunica", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de comunicaciones");
      const citaId = await crearCita({ telefono: "573002220013", nombre: "Cliente Cancelado Tarde", inicioIso: horasDesdeAhora(12), estado: "confirmada" });
      // La cita calificaría (confirmada, dentro de ventana) -- pero se cancela ANTES de que el motor corra.
      await supabase.from("dulabs_citas_especialista").update({ estado: "cancelada" }).eq("id", citaId);

      const resultado = await procesarComunicacionesDelTenant(supabase, { idTenant: TENANT, dryRun: true });
      assert.ok(!resultado.procesados.some((p) => p.citaId === citaId), "el motor siempre lee el estado ACTUAL, nunca uno cacheado");
    });

    it("14. cliente sin WhatsApp válido -> se marca fallido, no rompe el resto del lote", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de comunicaciones");
      const citaRotaId = await crearCita({ telefono: "no-es-un-numero-valido", nombre: "Cliente Teléfono Roto", inicioIso: horasDesdeAhora(12), estado: "confirmada" });
      const citaBuenaId = await crearCita({ telefono: "573002220014", nombre: "Cliente Teléfono Bueno", inicioIso: horasDesdeAhora(12), estado: "confirmada" });

      const resultado = await procesarComunicacionesDelTenant(supabase, { idTenant: TENANT, dryRun: false });
      const roto = resultado.procesados.find((p) => p.citaId === citaRotaId && p.tipo === "recordatorio");
      const bueno = resultado.procesados.find((p) => p.citaId === citaBuenaId && p.tipo === "recordatorio");
      assert.equal(roto?.resultado, "fallido");
      assert.equal(bueno?.resultado, "procesada");
    });

    it("7/8. múltiples citas y múltiples clientes el mismo día -> todas se procesan correctamente", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de comunicaciones");
      const idA = await crearCita({ telefono: "573002220081", nombre: "Cliente Múltiple A", inicioIso: horasDesdeAhora(10), estado: "confirmada" });
      const idB = await crearCita({ telefono: "573002220082", nombre: "Cliente Múltiple B", inicioIso: horasDesdeAhora(11), estado: "confirmada" });
      const idC = await crearCita({ telefono: "573002220083", nombre: "Cliente Múltiple C", inicioIso: horasDesdeAhora(20), estado: "confirmada" });

      const resultado = await procesarComunicacionesDelTenant(supabase, { idTenant: TENANT, dryRun: false });
      for (const id of [idA, idB, idC]) {
        assert.equal(resultado.procesados.find((p) => p.citaId === id && p.tipo === "confirmacion")?.resultado, "procesada");
        assert.equal(resultado.procesados.find((p) => p.citaId === id && p.tipo === "recordatorio")?.resultado, "procesada");
      }
    });

    it("5/6. comunicación ya procesada -> no duplica, ni con reintento secuencial ni CONCURRENTE", async (t) => {
      if (!migracionesListas) return t.skip("faltan las migraciones de comunicaciones");
      const citaId = await crearCita({ telefono: "573002220056", nombre: "Cliente Idempotente Comunicación", inicioIso: horasDesdeAhora(12), estado: "confirmada" });

      const primera = await procesarComunicacionesDelTenant(supabase, { idTenant: TENANT, dryRun: false });
      assert.equal(primera.procesados.find((p) => p.citaId === citaId && p.tipo === "confirmacion")?.resultado, "procesada");
      assert.equal(primera.procesados.find((p) => p.citaId === citaId && p.tipo === "recordatorio")?.resultado, "procesada");

      // 5. reintento secuencial -- ya_procesada para AMBOS tipos, cero filas nuevas.
      const segunda = await procesarComunicacionesDelTenant(supabase, { idTenant: TENANT, dryRun: false });
      assert.equal(segunda.procesados.find((p) => p.citaId === citaId && p.tipo === "confirmacion")?.resultado, "ya_procesada");
      assert.equal(segunda.procesados.find((p) => p.citaId === citaId && p.tipo === "recordatorio")?.resultado, "ya_procesada");

      const { data: filas } = await supabase.from("dulabs_comunicaciones_procesadas").select("id, tipo").eq("id_tenant", TENANT).eq("cita_id", citaId);
      assert.equal(filas?.length, 2, "exactamente una fila por tipo (confirmación + recordatorio), nunca más");

      // 6. dos ejecuciones CONCURRENTES contra una cita NUEVA -- la garantía
      // debe venir de Postgres (UNIQUE), no del orden de llegada.
      const citaConcurrenteId = await crearCita({ telefono: "573002220057", nombre: "Cliente Concurrente Comunicación", inicioIso: horasDesdeAhora(12), estado: "confirmada" });
      const [resA, resB] = await Promise.all([
        procesarComunicacionesDelTenant(supabase, { idTenant: TENANT, dryRun: false }),
        procesarComunicacionesDelTenant(supabase, { idTenant: TENANT, dryRun: false }),
      ]);
      const combinadosConfirmacion = [...resA.procesados, ...resB.procesados].filter((p) => p.citaId === citaConcurrenteId && p.tipo === "confirmacion");
      const procesadasConfirmacion = combinadosConfirmacion.filter((p) => p.resultado === "procesada");
      assert.equal(procesadasConfirmacion.length, 1, "exactamente UNA de las dos ejecuciones concurrentes debe ganar el claim de confirmación");

      const { data: filasConcurrente } = await supabase
        .from("dulabs_comunicaciones_procesadas")
        .select("id")
        .eq("id_tenant", TENANT)
        .eq("cita_id", citaConcurrenteId)
        .eq("tipo", "confirmacion");
      assert.equal(filasConcurrente?.length, 1);
    });
  }
);
