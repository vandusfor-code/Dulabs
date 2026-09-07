/**
 * lib/plantilla-conexion.ts — integración real contra Supabase (tenant
 * descartable, randomUUID, nunca Charlotte/AMORE/Daniela/Solo Talento
 * reales). Mismo criterio que el resto de la suite (ver
 * app/api/flows/flows-api.test.ts): sin mocks del código bajo prueba.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolverClienteDeNumero, phoneNumberIdsConectados, MENSAJE_PLANTILLA_DESCONECTADA } from "./plantilla-conexion";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "lib/plantilla-conexion — integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const TENANT = randomUUID();
    const OTRO_TENANT = randomUUID();
    const sufijo = randomUUID().slice(0, 8);
    // Nunca reutilizar un phone_number_id real -- dulabs_clientes_config
    // tiene un índice único global sobre esta columna.
    const PHONE_CONECTADO = `plantilla-conexion-test-conectado-${sufijo}`;
    const PHONE_HUERFANO = `plantilla-conexion-test-huerfano-${sufijo}`; // deliberadamente NUNCA insertado

    before(async () => {
      const { error } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: TENANT,
        phone_number_id: PHONE_CONECTADO,
        whatsapp_business_account_id: `waba-test-${sufijo}`,
        nombre_negocio: "Tenant de prueba (plantilla-conexion.test.ts)",
        telefono_negocio: "570000000000",
      });
      if (error) throw error;
    });

    after(async () => {
      await admin.from("dulabs_clientes_config").delete().eq("id_tenant", TENANT);
    });

    it("devuelve la fila real para un phone_number_id realmente conectado a este tenant", async () => {
      const cliente = await resolverClienteDeNumero(admin, { phoneNumberId: PHONE_CONECTADO, idTenant: TENANT });
      assert.ok(cliente, "debía encontrar la fila real insertada en before()");
      assert.equal(cliente?.phone_number_id, PHONE_CONECTADO);
    });

    it("devuelve null para un phone_number_id que nunca tuvo fila de configuración (plantilla huérfana)", async () => {
      const cliente = await resolverClienteDeNumero(admin, { phoneNumberId: PHONE_HUERFANO, idTenant: TENANT });
      assert.equal(cliente, null);
    });

    it("aislamiento por tenant -- el mismo phone_number_id bajo OTRO tenant nunca cuenta como conectado", async () => {
      const cliente = await resolverClienteDeNumero(admin, { phoneNumberId: PHONE_CONECTADO, idTenant: OTRO_TENANT });
      assert.equal(cliente, null, "un phone_number_id conectado al tenant A nunca debe resolver para el tenant B");
    });

    it("phoneNumberIdsConectados incluye el número conectado, nunca el huérfano", async () => {
      const conectados = await phoneNumberIdsConectados(admin, TENANT);
      assert.ok(conectados.has(PHONE_CONECTADO));
      assert.ok(!conectados.has(PHONE_HUERFANO));
    });

    it("phoneNumberIdsConectados de un tenant sin ninguna configuración -> set vacío, nunca inventa", async () => {
      const conectados = await phoneNumberIdsConectados(admin, randomUUID());
      assert.equal(conectados.size, 0);
    });

    it("MENSAJE_PLANTILLA_DESCONECTADA es un texto claro, nunca el genérico 'Número no encontrado' que confundía con los destinatarios", () => {
      assert.match(MENSAJE_PLANTILLA_DESCONECTADA, /vinculada a un número de WhatsApp activo/);
      assert.notEqual(MENSAJE_PLANTILLA_DESCONECTADA, "Número no encontrado");
    });
  },
);
