/**
 * FASE FINAL (autorizado) — los dos mensajes de WhatsApp (confirmación +
 * recordatorio inmediato) tras una reserva exitosa del Portal Cliente.
 * Ningún test de este archivo crea citas reales ni envía WhatsApp real: los
 * clientes de prueba usan `meta_permanent_token: null` y este entorno no
 * tiene `META_ACCESS_TOKEN` (verificado antes de implementar), así que
 * enviarWhatsApp jamás puede alcanzar la red real -- mismo patrón de
 * seguridad ya usado en lib/asistente-daniela-gate.test.ts y
 * app/api/cron/seguimiento-traspaso/route.test.ts.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  construirMensajeConfirmacionReserva,
  formatearFechaHoraColombia,
  MENSAJE_RECORDATORIO_INMEDIATO,
  enviarConfirmacionReservaWhatsApp,
} from "@/lib/reserva-notificaciones-whatsapp";

describe("construirMensajeConfirmacionReserva / formatearFechaHoraColombia — funciones puras", () => {
  it("incluye servicio y profesional reales, tal cual se pasaron -- nunca inventados", () => {
    const texto = construirMensajeConfirmacionReserva({
      servicio: "Semipermanente en manos",
      profesional: "Carla",
      inicioISO: "2026-09-05T14:30:00.000Z",
    });
    assert.match(texto, /¡Tu cita ha sido confirmada! 💗/);
    assert.match(texto, /📌 Servicio: Semipermanente en manos/);
    assert.match(texto, /💅 Profesional: Carla/);
    assert.match(texto, /¡Gracias por elegirnos! ✨/);
  });

  it("fecha y hora en formato Colombia -- 14:30 UTC es 9:30 a.m. en Bogotá (UTC-5)", () => {
    const texto = construirMensajeConfirmacionReserva({ servicio: "X", profesional: "Y", inicioISO: "2026-09-05T14:30:00.000Z" });
    assert.match(texto, /sábado, 5 de septiembre a las 9:30 a\. m\./);
  });

  it("cruce de día: 2026-09-06T02:00:00Z (UTC) es todavía 5 de septiembre 9:00 p.m. en Bogotá", () => {
    const texto = formatearFechaHoraColombia("2026-09-06T02:00:00.000Z");
    assert.match(texto, /5 de septiembre a las 9:00 p\. m\./);
  });
});

describe("MENSAJE_RECORDATORIO_INMEDIATO — texto fijo de política", () => {
  it("es exactamente el texto pedido", () => {
    assert.equal(
      MENSAJE_RECORDATORIO_INMEDIATO,
      "💗 Recuerda que toda cita debe ser confirmada 1 hora antes de la hora programada.\n\nDe lo contrario, la cita se cancelará automáticamente.\n\nSi ya confirmaste tu cita, puedes ignorar este mensaje. ✨"
    );
  });
});

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "enviarConfirmacionReservaWhatsApp — integración real (tenants descartables, SIN token real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const PHONE_A = `test-final-a-${Date.now()}`;
    const PHONE_B = `test-final-b-${Date.now()}`;

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { error: e1 } = await supabase.from("dulabs_clientes_config").insert({
        id_tenant: TENANT_A, phone_number_id: PHONE_A, nombre_negocio: "TEST_FINAL_A",
        whatsapp_business_account_id: "test-waba-final-a", telefono_negocio: "573000001111", meta_permanent_token: null,
      });
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("dulabs_clientes_config").insert({
        id_tenant: TENANT_B, phone_number_id: PHONE_B, nombre_negocio: "TEST_FINAL_B",
        whatsapp_business_account_id: "test-waba-final-b", telefono_negocio: "573000002222", meta_permanent_token: null,
      });
      if (e2) throw e2;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      await supabase.from("dulabs_clientes_config").delete().in("id_tenant", [TENANT_A, TENANT_B]);
    });

    it("6/7. funciona de forma genérica: sin cliente para ese tenant -> 'sin_cliente' (nunca resuelve el de otro tenant)", async () => {
      const resultado = await enviarConfirmacionReservaWhatsApp(supabase, randomUUID(), "573000009999", {
        servicio: "X", profesional: "Y", inicioISO: new Date().toISOString(),
      });
      assert.deepEqual(resultado, { enviado: false, motivo: "sin_cliente" });
    });

    it("1/2/3. envía AMBOS mensajes (sin ventana de 24h, sin plantilla) para cualquier tenant -- se comprueba contando los intentos reales de envío", async () => {
      const logs: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
      try {
        const resultado = await enviarConfirmacionReservaWhatsApp(supabase, TENANT_A, "573000003333", {
          servicio: "Semipermanente en manos", profesional: "Carla", inicioISO: new Date().toISOString(),
        });
        assert.deepEqual(resultado, { enviado: true });
      } finally {
        console.error = original;
      }
      // Sin token real (fixture de prueba), enviarWhatsApp registra "sin
      // token de Meta" por cada intento real -- dos intentos = dos mensajes.
      const intentos = logs.filter((l) => l.includes("sin token de Meta para TEST_FINAL_A")).length;
      assert.equal(intentos, 2, "deben intentarse EXACTAMENTE 2 envíos: mensaje 1 y mensaje 2");
    });

    it("6/7b. funciona igual para OTRO tenant, sin nada hardcodeado (TENANT_B, nombre distinto)", async () => {
      const logs: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
      try {
        const resultado = await enviarConfirmacionReservaWhatsApp(supabase, TENANT_B, "573000004444", {
          servicio: "Otro servicio", profesional: "Otra persona", inicioISO: new Date().toISOString(),
        });
        assert.deepEqual(resultado, { enviado: true });
      } finally {
        console.error = original;
      }
      const intentos = logs.filter((l) => l.includes("sin token de Meta para TEST_FINAL_B")).length;
      assert.equal(intentos, 2);
    });
  }
);
