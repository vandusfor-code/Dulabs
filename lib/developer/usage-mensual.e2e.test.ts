/**
 * DuLabs Developer V1 -- Fase 7 (Billing + Usage + Limits, autorizado).
 * E2E real contra Postgres del MOTOR de cuota mensual: reserva ATÓMICA
 * contra el límite del plan (dulabs_dev_reclamar_reservar_mensaje) +
 * confirmar/liberar + resumen mensual. Prioridad máxima verificada acá:
 * atomicidad bajo concurrencia real y CERO idempotency-key/job huérfano al
 * exceder la cuota.
 *
 * La función de reserva recibe el límite como parámetro, así que estos tests
 * usan límites PEQUEÑOS (2-3) para ejercer el borde exacto con un puñado de
 * reservas, en vez de las 20.000 del plan DEVELOPER real.
 *
 * REQUIERE la migración 20261013000000 aplicada.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { reclamarYReservarMensaje, confirmarUso, liberarUso, obtenerResumenMensualDelWorkspace, periodoActual } from "@/lib/developer/usage-ledger";
import { hashPayload } from "@/lib/developer/idempotency";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — cuota mensual atómica real contra Postgres (Fase 7)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_usage_ledger").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_jobs").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_idempotency_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    async function nuevoWorkspaceConNumero() {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numero = await registrarNumero(admin, { workspaceId, phoneNumberId: `phn-${randomUUID()}` });
      if (!numero.ok) throw new Error("no se pudo crear número de prueba");
      return { workspaceId, whatsappNumberId: numero.fila.id };
    }

    function payload(body = "hola") {
      return { to: "573000000000", type: "text", text: { body } };
    }

    async function reservar(workspaceId: string, whatsappNumberId: string, limite: number | null, idempotencyKey = `idem-${randomUUID()}`, p = payload()) {
      return reclamarYReservarMensaje(admin, { workspaceId, idempotencyKey, payloadHash: hashPayload(p), payload: p, whatsappNumberId, limiteMensual: limite });
    }

    it("Test 1 -- usage vacío: el resumen mensual arranca en cero", async () => {
      const { workspaceId } = await nuevoWorkspaceConNumero();
      const resumen = await obtenerResumenMensualDelWorkspace(admin, { workspaceId, period: periodoActual() });
      assert.deepEqual(resumen, { reserved: 0, confirmed: 0, released: 0 });
    });

    it("Test 2 -- consumo normal: cada reserva bajo el límite incrementa el uso mensual", async () => {
      const { workspaceId, whatsappNumberId } = await nuevoWorkspaceConNumero();
      await reservar(workspaceId, whatsappNumberId, 5);
      await reservar(workspaceId, whatsappNumberId, 5);
      const resumen = await obtenerResumenMensualDelWorkspace(admin, { workspaceId, period: periodoActual() });
      assert.equal(resumen.reserved, 2);
    });

    it("Test 3 -- límite exacto: reservar EXACTAMENTE hasta el límite (3 de 3) siempre tiene éxito", async () => {
      const { workspaceId, whatsappNumberId } = await nuevoWorkspaceConNumero();
      for (let i = 0; i < 3; i++) {
        const r = await reservar(workspaceId, whatsappNumberId, 3);
        assert.equal(r.resultado, "nuevo", `la reserva #${i + 1} de 3 debe entrar`);
      }
      const resumen = await obtenerResumenMensualDelWorkspace(admin, { workspaceId, period: periodoActual() });
      assert.equal(resumen.reserved, 3);
    });

    it("Test 4 -- superar el límite: la reserva que excede el límite se rechaza con 'limite_excedido'", async () => {
      const { workspaceId, whatsappNumberId } = await nuevoWorkspaceConNumero();
      for (let i = 0; i < 3; i++) assert.equal((await reservar(workspaceId, whatsappNumberId, 3)).resultado, "nuevo");
      const excedida = await reservar(workspaceId, whatsappNumberId, 3);
      assert.equal(excedida.resultado, "limite_excedido");
      const resumen = await obtenerResumenMensualDelWorkspace(admin, { workspaceId, period: periodoActual() });
      assert.equal(resumen.reserved, 3, "la reserva rechazada NUNCA debe haber incrementado el uso");
    });

    it("Test 5 -- CONCURRENCIA real: con límite 3 y 12 reservas concurrentes (claves distintas), exactamente 3 ganan y 9 se rechazan", async () => {
      const { workspaceId, whatsappNumberId } = await nuevoWorkspaceConNumero();
      const intentos = await Promise.all(Array.from({ length: 12 }, () => reservar(workspaceId, whatsappNumberId, 3)));
      const ganadas = intentos.filter((r) => r.resultado === "nuevo").length;
      const rechazadas = intentos.filter((r) => r.resultado === "limite_excedido").length;
      assert.equal(ganadas, 3, "nunca más de 3 reservas pueden ganar el cupo bajo concurrencia real");
      assert.equal(rechazadas, 9);

      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      assert.equal(count, 3, "exactamente 3 filas de ledger, nunca 4+ pese a 12 requests concurrentes");
    });

    it("Test 8 -- idempotencia sin doble consumo: misma Idempotency-Key + mismo payload dos veces = UNA sola reserva", async () => {
      const { workspaceId, whatsappNumberId } = await nuevoWorkspaceConNumero();
      const key = `idem-${randomUUID()}`;
      const p = payload("mismo");
      const primera = await reservar(workspaceId, whatsappNumberId, 5, key, p);
      const segunda = await reservar(workspaceId, whatsappNumberId, 5, key, p);
      assert.equal(primera.resultado, "nuevo");
      assert.equal(segunda.resultado, "duplicado_identico");
      const resumen = await obtenerResumenMensualDelWorkspace(admin, { workspaceId, period: periodoActual() });
      assert.equal(resumen.reserved, 1, "una réplica idéntica nunca consume una segunda unidad de cuota");
    });

    it("Test 8b -- conflicto de payload con la misma clave -> 'conflicto_payload_distinto', sin consumir cuota nueva", async () => {
      const { workspaceId, whatsappNumberId } = await nuevoWorkspaceConNumero();
      const key = `idem-${randomUUID()}`;
      await reservar(workspaceId, whatsappNumberId, 5, key, payload("uno"));
      const conflicto = await reservar(workspaceId, whatsappNumberId, 5, key, payload("distinto"));
      assert.equal(conflicto.resultado, "conflicto_payload_distinto");
      const resumen = await obtenerResumenMensualDelWorkspace(admin, { workspaceId, period: periodoActual() });
      assert.equal(resumen.reserved, 1);
    });

    it("Test 6/9 -- liberación (failed_by_meta): liberar una reserva la saca del uso mensual y libera cupo", async () => {
      const { workspaceId, whatsappNumberId } = await nuevoWorkspaceConNumero();
      const r1 = await reservar(workspaceId, whatsappNumberId, 1);
      assert.equal(r1.resultado, "nuevo");
      // Con límite 1 y una reserva activa, la siguiente se rechaza...
      assert.equal((await reservar(workspaceId, whatsappNumberId, 1)).resultado, "limite_excedido");
      // ...pero tras liberar la primera, vuelve a haber cupo.
      if (r1.resultado === "nuevo") {
        const lib = await liberarUso(admin, { workspaceId, jobId: r1.jobId });
        assert.equal(lib.liberado, true);
      }
      const resumen = await obtenerResumenMensualDelWorkspace(admin, { workspaceId, period: periodoActual() });
      assert.equal(resumen.reserved, 0);
      assert.equal(resumen.released, 1);
      const r2 = await reservar(workspaceId, whatsappNumberId, 1);
      assert.equal(r2.resultado, "nuevo", "un cupo liberado debe poder reutilizarse");
    });

    it("Test 10 -- success_confirmed: confirmar una reserva la mantiene contando contra la cuota (consumo real)", async () => {
      const { workspaceId, whatsappNumberId } = await nuevoWorkspaceConNumero();
      const r1 = await reservar(workspaceId, whatsappNumberId, 1);
      assert.equal(r1.resultado, "nuevo");
      if (r1.resultado === "nuevo") assert.equal((await confirmarUso(admin, { workspaceId, jobId: r1.jobId })).confirmado, true);
      const resumen = await obtenerResumenMensualDelWorkspace(admin, { workspaceId, period: periodoActual() });
      assert.equal(resumen.confirmed, 1);
      // confirmado sigue contando -> el cupo de 1 sigue agotado.
      assert.equal((await reservar(workspaceId, whatsappNumberId, 1)).resultado, "limite_excedido");
    });

    it("Test 11 -- reconciliation_pending conserva la reserva: sin liberar, sigue contando contra la cuota", async () => {
      const { workspaceId, whatsappNumberId } = await nuevoWorkspaceConNumero();
      const r1 = await reservar(workspaceId, whatsappNumberId, 1);
      assert.equal(r1.resultado, "nuevo");
      // No se libera ni se confirma (equivale a un job en reconciliation_pending/
      // retry_pending) -> la reserva se CONSERVA y el cupo sigue tomado.
      const resumen = await obtenerResumenMensualDelWorkspace(admin, { workspaceId, period: periodoActual() });
      assert.equal(resumen.reserved, 1);
      assert.equal(resumen.released, 0);
      assert.equal((await reservar(workspaceId, whatsappNumberId, 1)).resultado, "limite_excedido", "una reserva conservada nunca debe liberar cupo por sí sola");
    });

    it("PRIORIDAD #2 -- exceder la cuota NO deja idempotency-key ni job huérfano (rollback atómico total)", async () => {
      const { workspaceId, whatsappNumberId } = await nuevoWorkspaceConNumero();
      // Agota el cupo (límite 1).
      assert.equal((await reservar(workspaceId, whatsappNumberId, 1)).resultado, "nuevo");

      const keyExcedida = `idem-excedida-${randomUUID()}`;
      const excedida = await reservar(workspaceId, whatsappNumberId, 1, keyExcedida);
      assert.equal(excedida.resultado, "limite_excedido");

      // NINGÚN idempotency-key persistido para la request rechazada.
      const { count: idemCount } = await admin
        .from("dulabs_dev_idempotency_keys")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("idempotency_key", keyExcedida);
      assert.equal(idemCount, 0, "un exceso de cuota NUNCA debe dejar un idempotency-key huérfano");

      // Solo 1 job y 1 fila de ledger en total (la reserva que sí entró).
      const { count: jobCount } = await admin.from("dulabs_dev_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      assert.equal(jobCount, 1, "un exceso de cuota NUNCA debe crear un job huérfano");
      const { count: ledgerCount } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      assert.equal(ledgerCount, 1);

      // Reintentar con la MISMA clave rechazada vuelve a evaluarse en frío
      // (nunca 'duplicado_identico' de un job fantasma) -> sigue rechazada.
      const reintento = await reservar(workspaceId, whatsappNumberId, 1, keyExcedida);
      assert.equal(reintento.resultado, "limite_excedido", "el reintento de una clave que fue rechazada por cuota nunca debe resolver a un job inexistente");
    });

    it("plan sin límite (null) -- nunca aplica cuota (AGENCY/ENTERPRISE): muchas reservas, todas entran", async () => {
      const { workspaceId, whatsappNumberId } = await nuevoWorkspaceConNumero();
      for (let i = 0; i < 5; i++) assert.equal((await reservar(workspaceId, whatsappNumberId, null)).resultado, "nuevo");
      const resumen = await obtenerResumenMensualDelWorkspace(admin, { workspaceId, period: periodoActual() });
      assert.equal(resumen.reserved, 5);
    });
  }
);
