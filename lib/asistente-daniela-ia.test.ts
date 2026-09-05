/**
 * Fase 7 (autorizado) — asistente conversacional de Daniela. Pruebas puras
 * (copy exacto, guarda de no-invención) + integración real contra Supabase
 * (herramientas de catálogo/disponibilidad/cita/transferencia, aislamiento
 * de tenant). NO se invoca la API real de Claude -- este entorno no tiene
 * ANTHROPIC_API_KEY configurada, y esta suite sigue el mismo criterio ya
 * establecido en especialista-solicitud-ia-confirmacion.test.ts: probar las
 * guardas y las primitivas de dominio en aislamiento, no una conversación
 * en vivo con el modelo (eso se cubre con la verificación visual/manual).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  MENSAJE_SALUDO_1,
  MENSAJE_SALUDO_2,
  MENSAJE_PRODUCTOS,
  MENSAJE_SERVICIOS_SPA,
  MENSAJE_SEGUIMIENTO_SIN_RESPUESTA,
  pareceAfirmarPrecioODuracion,
  buscarServicios,
  consultarServicio,
  consultarDisponibilidadReal,
  generarLinkReserva,
  consultarCitaCliente,
  gestionarTransferencia,
  manejarBotonProductos,
} from "@/lib/asistente-daniela-ia";
import type { ClienteConfig } from "@/lib/supabase";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Copy exacto de la experiencia inicial (Paso 5 del pedido / aclaración crítica)", () => {
  it("saludo -- dos mensajes exactos", () => {
    assert.equal(MENSAJE_SALUDO_1, "👋 Hola, un gusto tenerte nuevamente por acá ❤️");
    assert.equal(MENSAJE_SALUDO_2, "¿Qué estás buscando? ❤️");
  });

  it("mensaje de productos exacto", () => {
    assert.equal(
      MENSAJE_PRODUCTOS,
      "Claro que sí 😊\nPara ayudarte con los productos, Dani te contestará para brindarte toda la información.\n\nEspera un momentito 💗"
    );
  });

  it("mensaje de apertura de servicios de spa exacto", () => {
    assert.equal(MENSAJE_SERVICIOS_SPA, "Claro que sí, con gusto te ayudo a agendar tu próxima cita 💗\n\n¿Ya tienes pensado qué servicio te gustaría realizarte?");
  });

  it("mensaje de seguimiento a los 5 minutos exacto", () => {
    assert.equal(MENSAJE_SEGUIMIENTO_SIN_RESPUESTA, "Te pedimos disculpas 💗 Dani se encuentra ocupada en este momento, pero apenas tenga el espacio estará respondiéndote.");
  });
});

describe("pareceAfirmarPrecioODuracion — guarda de no-invención (puro)", () => {
  it("detecta un precio en pesos", () => {
    assert.equal(pareceAfirmarPrecioODuracion("Ese servicio tiene un valor de $45.000 💗"), true);
  });
  it("detecta una duración en minutos", () => {
    assert.equal(pareceAfirmarPrecioODuracion("Dura aproximadamente 60 min"), true);
  });
  it("detecta una duración en horas", () => {
    assert.equal(pareceAfirmarPrecioODuracion("Toma como 2 horas"), true);
  });
  it("NO se activa con conversación normal sin cifras de precio/duración", () => {
    assert.equal(pareceAfirmarPrecioODuracion("Claro, amiga 💗 ¿buscas algo para tus manos o tus pies?"), false);
  });
  it("NO se activa con un número que no es precio/duración (ej. un índice de selección)", () => {
    assert.equal(pareceAfirmarPrecioODuracion("Perfecto, la opción 2 te queda divina ✨"), false);
  });
});

describe(
  "Herramientas del asistente — integración real (tenant descartable)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const PHONE_A = `test-7-${Date.now()}`;
    let especialistaAId: number;
    let servicioManosId: string;
    let servicioOtroTenantId: string;
    const especialistaIds: number[] = [];
    const servicioIds: string[] = [];
    const citaIds: number[] = [];

    function proximoMartes(): string {
      const hoy = new Date();
      const dia = hoy.getUTCDay();
      const dias = ((2 - dia + 7) % 7) || 7;
      const f = new Date(hoy);
      f.setUTCDate(hoy.getUTCDate() + dias);
      return f.toISOString().slice(0, 10);
    }
    const FECHA = proximoMartes();

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      const { data: eA, error: eAerr } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_A, phone_number_id: PHONE_A, nombre: "7 Reservable", numero_whatsapp: "573000000801",
          servicio: "manos", duracion_min: 60, activo: true, bloquea_horario: true, es_general: false, requiere_aprobacion: false,
        })
        .select("id").single();
      if (eAerr) throw eAerr;
      especialistaAId = eA!.id as number;
      especialistaIds.push(especialistaAId);

      const { error: hErr } = await supabase.from("dulabs_horario_especialista").insert({
        id_tenant: TENANT_A, especialista_id: especialistaAId, dia_semana: 2, hora_inicio: "09:00", hora_fin: "18:00",
      });
      if (hErr) throw hErr;

      const { data: s1, error: s1err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_7_semipermanente en manos", categoria: "Manos", descripcion: "Esmaltado de larga duración", duracion_min: 60, precio: 45000, activo: true })
        .select("id").single();
      if (s1err) throw s1err;
      servicioManosId = s1!.id as string;
      servicioIds.push(servicioManosId);
      await supabase.from("dulabs_servicio_especialista").insert({ id_tenant: TENANT_A, servicio_id: servicioManosId, especialista_id: especialistaAId });

      const { data: sInactivo } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_A, nombre: "TEST_7_inactivo", duracion_min: 30, activo: false })
        .select("id").single();
      if (sInactivo) servicioIds.push(sInactivo.id as string);

      const { data: s2, error: s2err } = await supabase
        .from("dulabs_servicios")
        .insert({ id_tenant: TENANT_B, nombre: "TEST_7_otro_tenant", duracion_min: 30, activo: true })
        .select("id").single();
      if (s2err) throw s2err;
      servicioOtroTenantId = s2!.id as string;
      servicioIds.push(servicioOtroTenantId);
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
      await supabase.from("dulabs_servicio_especialista").delete().in("servicio_id", servicioIds);
      await supabase.from("dulabs_horario_especialista").delete().eq("id_tenant", TENANT_A);
      await supabase.from("dulabs_pausas_chat").delete().eq("phone_number_id", PHONE_A);
      if (servicioIds.length) await supabase.from("dulabs_servicios").delete().in("id", servicioIds);
      if (especialistaIds.length) await supabase.from("dulabs_especialistas").delete().in("id", especialistaIds);
    });

    it("buscar_servicios: solo activos del tenant, filtra por texto, aísla tenant", async () => {
      const todos = await buscarServicios(supabase, { idTenant: TENANT_A });
      assert.ok(todos.some((s) => s.id === servicioManosId));
      assert.equal(todos.some((s) => s.nombre === "TEST_7_inactivo"), false, "inactivo no debe aparecer");
      assert.equal(todos.some((s) => s.id === servicioOtroTenantId), false, "servicio de otro tenant no debe aparecer");

      const filtrado = await buscarServicios(supabase, { idTenant: TENANT_A, texto: "manos" });
      assert.ok(filtrado.some((s) => s.id === servicioManosId));
    });

    it("consultar_servicio: servicio real devuelve datos reales; servicio inexistente devuelve vacío (nunca inventado)", async () => {
      const real = await consultarServicio(supabase, { idTenant: TENANT_A, nombre: "semipermanente" });
      assert.equal(real.length, 1);
      assert.equal(real[0]!.precio, 45000);
      assert.equal(real[0]!.duracionMin, 60);

      const inexistente = await consultarServicio(supabase, { idTenant: TENANT_A, nombre: "acrílicas de titanio" });
      assert.deepEqual(inexistente, []);
    });

    it("consultar_disponibilidad: delega al motor real de Fase 2 (mismos horarios que el portal)", async () => {
      const resultado = await consultarDisponibilidadReal(supabase, { idTenant: TENANT_A, servicioId: servicioManosId, fecha: FECHA });
      assert.equal(resultado.ok, true);
      if (resultado.ok) {
        assert.equal(resultado.servicio.duracionMin, 60);
        assert.ok(resultado.especialistas[0]!.horarios.includes("09:00"));
      }
    });

    it("generar_link_reserva: URL real del portal de este tenant, nunca de otro", () => {
      const link = generarLinkReserva(TENANT_A);
      assert.ok(link.includes(`/reservar/${TENANT_A}`));
      assert.equal(link.includes(TENANT_B), false);
    });

    it("consultar_cita_cliente: cita real si existe, aislada por phone_number_id + teléfono", async () => {
      const { data: cita, error } = await supabase
        .from("dulabs_citas_especialista")
        .insert({
          especialista_id: especialistaAId, id_tenant: TENANT_A, phone_number_id: PHONE_A, telefono_cliente: "573009991234",
          nombre_cliente: "Cliente Test 7", servicio: "TEST_7_semipermanente en manos", inicio: `${FECHA}T10:00:00-05:00`, fin: `${FECHA}T11:00:00-05:00`,
          estado: "confirmada", bloquea_horario: true,
        })
        .select("id").single();
      if (error) throw error;
      citaIds.push(cita!.id as number);

      const encontrada = await consultarCitaCliente(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573009991234" });
      assert.ok(encontrada);
      assert.equal(encontrada!.id, cita!.id);

      const otroTelefono = await consultarCitaCliente(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573000000000" });
      assert.equal(otroTelefono, null);
    });

    it("gestionar_transferencia: pausa el chat con la duración correcta (sin depender de credenciales reales de Meta)", async () => {
      const clienteFalso = {
        id: 1,
        id_tenant: TENANT_A,
        phone_number_id: PHONE_A,
        nombre_negocio: "Test 7",
        meta_permanent_token: null,
        api_key_ia: null,
      } as unknown as ClienteConfig;

      const antes = Date.now();
      const { mensajeEnviado } = await gestionarTransferencia(supabase, clienteFalso, "573009995555", "producto");
      assert.equal(mensajeEnviado, MENSAJE_PRODUCTOS);

      const { data: pausa } = await supabase
        .from("dulabs_pausas_chat")
        .select("pausado_hasta, pausado_desde, seguimiento_enviado")
        .eq("phone_number_id", PHONE_A)
        .eq("telefono_cliente", "573009995555")
        .maybeSingle();
      assert.ok(pausa);
      assert.equal(pausa!.seguimiento_enviado, false);
      const horasDePausa = (new Date(pausa!.pausado_hasta).getTime() - antes) / 3_600_000;
      assert.ok(horasDePausa > 23 && horasDePausa < 25, "la pausa debe durar ~24h");
    });

    it("manejarBotonProductos: mensaje fijo + traspaso real (comparte el mismo mecanismo de pausa)", async () => {
      const clienteFalso = {
        id: 1, id_tenant: TENANT_A, phone_number_id: PHONE_A, nombre_negocio: "Test 7", meta_permanent_token: null, api_key_ia: null,
      } as unknown as ClienteConfig;
      await manejarBotonProductos(supabase, clienteFalso, "573009994444");
      const { data: pausa } = await supabase
        .from("dulabs_pausas_chat")
        .select("id")
        .eq("phone_number_id", PHONE_A)
        .eq("telefono_cliente", "573009994444")
        .maybeSingle();
      assert.ok(pausa, "el botón Productos debe activar la pausa real");
    });
  }
);
