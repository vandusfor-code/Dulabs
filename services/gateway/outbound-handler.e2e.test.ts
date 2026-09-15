/**
 * DuLabs Developer V1 -- Fase 3, cierre (hallazgo del usage_ledger). E2E
 * real contra Postgres para el flujo COMPLETO real:
 *   POST /api/v1/messages (manejarMensajeSaliente) -> crearJobConIdempotencia
 *   -> dulabs_dev_usage_ledger.
 *
 * Antes de esta corrección, reservarUso() existía (Fase 2) pero nunca se
 * invocaba desde código de producción real -- este archivo prueba
 * exactamente el punto de entrada real que el desarrollador usa (el
 * handler del Gateway), no solo la función interna de más bajo nivel.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { manejarMensajeSaliente } from "./outbound-handler";
import { crearApiKey } from "@/lib/developer/api-keys-store";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";
import { obtenerLedgerDelJob } from "@/lib/developer/usage-ledger";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — Gateway outbound-handler real contra Postgres (Fase 3, cierre — usage_ledger)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_usage_ledger").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_jobs").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_idempotency_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_api_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    async function prepararWorkspace() {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const apiKey = await crearApiKey(admin, { workspaceId, name: "test" });
      const numero = await registrarNumero(admin, { workspaceId, phoneNumberId: `phn-${randomUUID()}` });
      if (!numero.ok) throw new Error("no se pudo crear número de prueba");
      return { workspaceId, claveEnClaro: apiKey.claveEnClaro, whatsappNumberId: numero.fila.id };
    }

    const publicarNoop = async () => "fake-message-id";

    it("un Job real (POST /api/v1/messages) produce su fila real de usage_ledger, en estado 'reservado', asociada al job_id real", async () => {
      const { workspaceId, claveEnClaro, whatsappNumberId } = await prepararWorkspace();

      const respuesta = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey: `idem-${randomUUID()}`, cuerpo: { whatsappNumberId, to: "573000000000" } }
      );
      assert.equal(respuesta.status, 201);
      const jobId = respuesta.cuerpo.jobId as string;
      assert.ok(jobId);

      const ledger = await obtenerLedgerDelJob(admin, { workspaceId, jobId });
      assert.ok(ledger, "debe existir una fila real de usage_ledger para este job -- ANTES de esta corrección, esto nunca pasaba en producción");
      assert.equal(ledger!.estado, "reservado");
      assert.equal(ledger!.job_id, jobId);
      assert.equal(ledger!.workspace_id, workspaceId);
      assert.equal(ledger!.cantidad, 1);
    });

    it("repetir la MISMA Idempotency-Key (réplica real del desarrollador) NO genera una segunda reserva -- UNA sola fila de ledger para ese job", async () => {
      const { workspaceId, claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const idempotencyKey = `idem-${randomUUID()}`;
      const cuerpo = { whatsappNumberId, to: "573000000000" };

      const r1 = await manejarMensajeSaliente({ supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop }, { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey, cuerpo });
      assert.equal(r1.status, 201);
      const jobId = r1.cuerpo.jobId as string;

      // Réplica real -- MISMA Idempotency-Key, mismo payload.
      const r2 = await manejarMensajeSaliente({ supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop }, { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey, cuerpo });
      assert.equal(r2.status, 200);
      assert.equal(r2.cuerpo.status, "duplicado_identico");
      assert.equal(r2.cuerpo.jobId, jobId, "debe ser el MISMO job -- nunca uno nuevo");

      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("job_id", jobId);
      assert.equal(count, 1, "EXACTAMENTE 1 fila de ledger pese a 2 requests reales con la misma Idempotency-Key");
    });

    it("CONCURRENCIA real contra el límite: 5 requests SIMULTÁNEOS con la MISMA Idempotency-Key -- exactamente 1 job, exactamente 1 reserva, nunca más", async () => {
      const { workspaceId, claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const idempotencyKey = `idem-concurrente-${randomUUID()}`;
      const cuerpo = { whatsappNumberId, to: "573000000000" };
      const deps = { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop };

      const respuestas = await Promise.all(
        Array.from({ length: 5 }, () => manejarMensajeSaliente(deps, { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey, cuerpo }))
      );

      const jobIds = new Set(respuestas.map((r) => r.cuerpo.jobId as string));
      assert.equal(jobIds.size, 1, "las 5 requests concurrentes deben resolver al MISMO job_id -- nunca 5 jobs distintos");
      const statuses = respuestas.map((r) => r.status).sort();
      assert.ok(statuses.includes(201), "al menos una debe ser la creación real (201)");

      const jobId = [...jobIds][0];
      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("job_id", jobId);
      assert.equal(count, 1, `EXACTAMENTE 1 fila de ledger bajo concurrencia real de 5, hubo ${count}`);
    });

    it("una solicitud rechazada ANTES de crear el Job (API key inválida) nunca reserva -- cero filas de ledger para ese workspace", async () => {
      const { workspaceId, whatsappNumberId } = await prepararWorkspace();

      const respuesta = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: "Bearer dl_live_clave_invalida_no_existe", idempotencyKey: `idem-${randomUUID()}`, cuerpo: { whatsappNumberId, to: "573000000000" } }
      );
      assert.equal(respuesta.status, 401);

      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      assert.equal(count, 0, "una request rechazada por auth nunca debe crear una reserva");
    });

    it("un conflicto de Idempotency-Key con payload DISTINTO (409) nunca reserva -- no crea un job ni una fila de ledger nueva", async () => {
      const { workspaceId, claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const idempotencyKey = `idem-${randomUUID()}`;

      const original = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey, cuerpo: { whatsappNumberId, to: "573000000000" } }
      );
      assert.equal(original.status, 201);

      const conflicto = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey, cuerpo: { whatsappNumberId, to: "573099999999" } }
      );
      assert.equal(conflicto.status, 409);

      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      assert.equal(count, 1, "el conflicto (409) no debe haber agregado una segunda fila de ledger -- sigue siendo solo la del job original");
    });
  }
);
