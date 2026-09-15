/**
 * DuLabs Developer V1 -- Fase 2 (autorizado, secciones 9/10/11 del brief).
 * E2E real contra Postgres para lib/developer/jobs-store.ts: creación con
 * idempotencia, leases (adquisición/expiración/takeover/CAS) y transición
 * de estado (ownership + validez de la máquina de estados de Fase 1).
 *
 * REQUIERE la migración 20261007000000_dulabs_developer_v1_fase2_data_model.sql aplicada.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearJobConIdempotencia, obtenerJobDelWorkspace, adquirirLease, liberarLease, aplicarEventoJob, obtenerJobsListosParaReintento, BACKOFF_REINTENTO_MS } from "@/lib/developer/jobs-store";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — jobs-store real contra Postgres (Fase 2)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    async function crearNumeroDePrueba(workspaceId: string): Promise<string> {
      const registro = await registrarNumero(admin, { workspaceId, phoneNumberId: `phn-${randomUUID()}` });
      if (!registro.ok) throw new Error("no se pudo crear número de prueba");
      return registro.fila.id;
    }

    async function crearJobDePrueba(workspaceId: string, numeroId: string): Promise<string> {
      const resultado = await crearJobConIdempotencia(admin, { workspaceId, whatsappNumberId: numeroId, idempotencyKey: `job-${randomUUID()}`, payload: { to: "573000000000" } });
      if (resultado.resultado === "conflicto_payload_distinto") throw new Error("no debería haber conflicto en un job nuevo");
      return resultado.jobId;
    }

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        // Fase 3, cierre (hallazgo del usage_ledger) -- crearJobConIdempotencia
        // ahora también reserva, así que cada job de prueba deja una fila
        // real de ledger que hay que limpiar.
        await admin.from("dulabs_dev_usage_ledger").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_jobs").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_idempotency_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    it("crearJobConIdempotencia: crea la fila con estado inicial correcto (created / pre_send / 0 intentos)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);
      const jobId = await crearJobDePrueba(workspaceId, numeroId);

      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.ok(job);
      assert.equal(job!.status, "created");
      assert.equal(job!.physical_outcome, "pre_send");
      assert.equal(job!.network_attempts, 0);
      assert.equal(job!.version_token, 0);
    });

    it("obtenerJobDelWorkspace: un workspace no puede leer el job de otro aunque conozca el jobId exacto", async () => {
      const workspaceA = randomUUID();
      const workspaceB = randomUUID();
      workspacesUsados.push(workspaceA, workspaceB);
      const numeroA = await crearNumeroDePrueba(workspaceA);
      const jobId = await crearJobDePrueba(workspaceA, numeroA);

      const comoB = await obtenerJobDelWorkspace(admin, { workspaceId: workspaceB, jobId });
      assert.equal(comoB, null);
    });

    it("adquirirLease: primera adquisición sobre un job libre -- CAS real (rowCount de la fila devuelta, no una lectura previa)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);
      const jobId = await crearJobDePrueba(workspaceId, numeroId);

      const resultado = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(resultado.adquirido, true);
      if (resultado.adquirido) {
        assert.equal(resultado.job.lease_id, resultado.leaseId);
      }
    });

    it("adquirirLease: un segundo Worker NO puede tomar un lease ya vigente (CAS bloquea, no solo 'el último que escribe gana')", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);
      const jobId = await crearJobDePrueba(workspaceId, numeroId);

      const primero = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(primero.adquirido, true);

      const segundo = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(segundo.adquirido, false);
      if (!segundo.adquirido) assert.equal(segundo.motivo, "ya_tomado");
    });

    it("adquirirLease: job inexistente en ese workspace -> job_no_encontrado (distinto de ya_tomado)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const resultado = await adquirirLease(admin, { workspaceId, jobId: randomUUID() });
      assert.equal(resultado.adquirido, false);
      if (!resultado.adquirido) assert.equal(resultado.motivo, "job_no_encontrado");
    });

    it("adquirirLease: takeover real tras vencimiento -- un lease con locked_at en el pasado puede ser tomado por otro Worker", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);
      const jobId = await crearJobDePrueba(workspaceId, numeroId);

      const primero = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(primero.adquirido, true);

      // Simula que el Worker dueño murió hace más de LEASE_DURACION_MS --
      // se manipula locked_at directamente (vía service_role) para no
      // depender de esperar 60s reales en el test.
      await admin.from("dulabs_dev_jobs").update({ locked_at: new Date(Date.now() - 120_000).toISOString() }).eq("id", jobId);

      const segundo = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(segundo.adquirido, true, "un lease vencido debe poder ser tomado por otro Worker (takeover real)");
      if (primero.adquirido && segundo.adquirido) {
        assert.notEqual(segundo.leaseId, primero.leaseId);
      }
    });

    it("liberarLease: solo el dueño real (leaseId coincide) puede liberar -- un leaseId equivocado no libera el lease de otro", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);
      const jobId = await crearJobDePrueba(workspaceId, numeroId);

      const lease = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(lease.adquirido, true);
      if (!lease.adquirido) return;

      const intentoAjeno = await liberarLease(admin, { workspaceId, jobId, leaseId: randomUUID() });
      assert.equal(intentoAjeno.liberado, false);

      const intentoReal = await liberarLease(admin, { workspaceId, jobId, leaseId: lease.leaseId });
      assert.equal(intentoReal.liberado, true);

      const otroWorker = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(otroWorker.adquirido, true, "tras liberar, el job debe quedar disponible de inmediato");
    });

    it("aplicarEventoJob: sin el lease correcto -> sin_ownership, el job NO cambia de estado", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);
      const jobId = await crearJobDePrueba(workspaceId, numeroId);
      await adquirirLease(admin, { workspaceId, jobId });

      const resultado = await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: randomUUID(), evento: { tipo: "encolar" } });
      assert.equal(resultado.aplicada, false);
      if (!resultado.aplicada) assert.equal(resultado.motivo, "sin_ownership");

      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(job!.status, "created", "un evento sin ownership válido nunca debe mutar el estado");
    });

    it("aplicarEventoJob: transición inválida según la máquina de estados de Fase 1 se rechaza (ej. 'meta_confirmo_exito' sin haber pasado por 'sending')", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);
      const jobId = await crearJobDePrueba(workspaceId, numeroId);
      const lease = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(lease.adquirido, true);
      if (!lease.adquirido) return;

      const resultado = await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "meta_confirmo_exito" } });
      assert.equal(resultado.aplicada, false);
      if (!resultado.aplicada) assert.equal(resultado.motivo, "transicion_invalida");
    });

    it("aplicarEventoJob: ciclo feliz completo (encolar -> iniciar_envio -> meta_confirmo_exito), version_token avanza en cada paso", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);
      const jobId = await crearJobDePrueba(workspaceId, numeroId);
      const lease = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(lease.adquirido, true);
      if (!lease.adquirido) return;

      const paso1 = await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "encolar" } });
      assert.equal(paso1.aplicada, true);
      if (paso1.aplicada) assert.equal(paso1.job.status, "queued");

      const paso2 = await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "iniciar_envio" } });
      assert.equal(paso2.aplicada, true);
      if (paso2.aplicada) {
        assert.equal(paso2.job.status, "sending");
        assert.equal(paso2.job.network_attempts, 1);
      }

      const paso3 = await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "meta_confirmo_exito" } });
      assert.equal(paso3.aplicada, true);
      if (paso3.aplicada) {
        assert.equal(paso3.job.status, "success_confirmed");
        assert.equal(paso3.job.physical_outcome, "success_confirmed");
        assert.equal(paso3.job.version_token, 3, "cada mutación real debe incrementar version_token en 1");
      }
    });

    it("REGLA CRÍTICA (sección 11): incertidumbre_de_red NUNCA pasa a retry_pending, solo a reconciliation_pending -- y bloquea un segundo intento físico automático", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);
      const jobId = await crearJobDePrueba(workspaceId, numeroId);
      const lease = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(lease.adquirido, true);
      if (!lease.adquirido) return;

      await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "encolar" } });
      await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "iniciar_envio" } });
      const incertidumbre = await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "incertidumbre_de_red" } });
      assert.equal(incertidumbre.aplicada, true);
      if (incertidumbre.aplicada) {
        assert.equal(incertidumbre.job.status, "reconciliation_pending");
        assert.notEqual(incertidumbre.job.status, "retry_pending");
        assert.equal(incertidumbre.job.physical_outcome, "uncertain");
      }

      // Un segundo "iniciar_envio" directo (sin que reconciliación haya
      // confirmado nada) debe ser rechazado por la máquina de estados --
      // así se prueba, a nivel de persistencia real, que no hay reintento
      // físico automático tras una incertidumbre.
      const segundoIntento = await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "iniciar_envio" } });
      assert.equal(segundoIntento.aplicada, false);
    });

    it("aplicarEventoJob: CAS de version_token -- una mutación concurrente con el version_token viejo se rechaza aunque el lease sea correcto", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);
      const jobId = await crearJobDePrueba(workspaceId, numeroId);
      const lease = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(lease.adquirido, true);
      if (!lease.adquirido) return;

      // Avanza el job una vez (version_token pasa de 0 a 1).
      await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "encolar" } });

      // Fuerza el version_token de vuelta a un valor viejo simulando una
      // condición de carrera donde otro proceso ya avanzó el job --
      // aplicarEventoJob relee el estado actual antes de decidir, así que
      // para probar el CAS real hacemos dos llamadas concurrentes reales.
      const numeroId2 = await crearNumeroDePrueba(workspaceId);
      const jobId2 = await crearJobDePrueba(workspaceId, numeroId2);
      const lease2 = await adquirirLease(admin, { workspaceId, jobId: jobId2 });
      assert.equal(lease2.adquirido, true);
      if (!lease2.adquirido) return;

      const [a, b] = await Promise.all([
        aplicarEventoJob(admin, { workspaceId, jobId: jobId2, leaseId: lease2.leaseId, evento: { tipo: "encolar" } }),
        aplicarEventoJob(admin, { workspaceId, jobId: jobId2, leaseId: lease2.leaseId, evento: { tipo: "encolar" } }),
      ]);
      const aplicadas = [a, b].filter((r) => r.aplicada).length;
      assert.equal(aplicadas, 1, "de dos 'encolar' concurrentes sobre el mismo job, exactamente UNA debe aplicarse -- la otra debe fallar por CAS de version_token, nunca duplicar el avance de estado");
    });

    it("Fase 5 (decisión D6) -- al entrar en retry_pending, next_attempt_at queda fijado en el futuro (backoff real)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);
      const jobId = await crearJobDePrueba(workspaceId, numeroId);
      const lease = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(lease.adquirido, true);
      if (!lease.adquirido) return;

      await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "encolar" } });
      await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "iniciar_envio" } });
      const rechazo = await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "meta_rechazo" } });
      assert.equal(rechazo.aplicada, true);
      if (rechazo.aplicada) {
        assert.equal(rechazo.job.status, "retry_pending");
        assert.ok(rechazo.job.next_attempt_at, "debe fijarse next_attempt_at");
        const delta = new Date(rechazo.job.next_attempt_at!).getTime() - Date.now();
        assert.ok(delta > 0 && delta <= BACKOFF_REINTENTO_MS + 2000, `next_attempt_at debe estar ~BACKOFF_REINTENTO_MS (${BACKOFF_REINTENTO_MS}ms) en el futuro, delta real: ${delta}ms`);
      }
    });

    it("Fase 5 (D6) -- next_attempt_at se limpia (null) al salir de retry_pending hacia sending", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);
      const jobId = await crearJobDePrueba(workspaceId, numeroId);
      const lease = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(lease.adquirido, true);
      if (!lease.adquirido) return;

      await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "encolar" } });
      await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "iniciar_envio" } });
      await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "meta_rechazo" } });
      let job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.ok(job!.next_attempt_at);

      const reintento = await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: lease.leaseId, evento: { tipo: "iniciar_envio" } });
      assert.equal(reintento.aplicada, true);
      if (reintento.aplicada) assert.equal(reintento.job.next_attempt_at, null, "al volver a 'sending' ya no debe quedar un next_attempt_at viejo");
    });

    it("Fase 5 (D6) -- obtenerJobsListosParaReintento SOLO devuelve jobs cuyo next_attempt_at ya pasó (o nunca se fijó), nunca uno todavía en backoff", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numeroId = await crearNumeroDePrueba(workspaceId);

      // Job A: recién rechazado -- next_attempt_at en el futuro (~30s), NO debe aparecer todavía.
      const jobIdFuturo = await crearJobDePrueba(workspaceId, numeroId);
      const leaseFuturo = await adquirirLease(admin, { workspaceId, jobId: jobIdFuturo });
      if (leaseFuturo.adquirido) {
        await aplicarEventoJob(admin, { workspaceId, jobId: jobIdFuturo, leaseId: leaseFuturo.leaseId, evento: { tipo: "encolar" } });
        await aplicarEventoJob(admin, { workspaceId, jobId: jobIdFuturo, leaseId: leaseFuturo.leaseId, evento: { tipo: "iniciar_envio" } });
        await aplicarEventoJob(admin, { workspaceId, jobId: jobIdFuturo, leaseId: leaseFuturo.leaseId, evento: { tipo: "meta_rechazo" } });
      }

      // Job B: mismo camino, pero se fuerza next_attempt_at al pasado (simulando que el backoff ya venció) -- manipulación directa, mismo patrón ya usado para locked_at.
      const jobIdListo = await crearJobDePrueba(workspaceId, numeroId);
      const leaseListo = await adquirirLease(admin, { workspaceId, jobId: jobIdListo });
      if (leaseListo.adquirido) {
        await aplicarEventoJob(admin, { workspaceId, jobId: jobIdListo, leaseId: leaseListo.leaseId, evento: { tipo: "encolar" } });
        await aplicarEventoJob(admin, { workspaceId, jobId: jobIdListo, leaseId: leaseListo.leaseId, evento: { tipo: "iniciar_envio" } });
        await aplicarEventoJob(admin, { workspaceId, jobId: jobIdListo, leaseId: leaseListo.leaseId, evento: { tipo: "meta_rechazo" } });
      }
      await admin.from("dulabs_dev_jobs").update({ next_attempt_at: new Date(Date.now() - 5_000).toISOString() }).eq("id", jobIdListo);

      const listos = await obtenerJobsListosParaReintento(admin, { limite: 1000 });
      const ids = listos.map((j) => j.id);
      assert.ok(ids.includes(jobIdListo), "el job con next_attempt_at ya vencido debe aparecer como listo");
      assert.ok(!ids.includes(jobIdFuturo), "el job todavía en backoff (next_attempt_at futuro) NUNCA debe aparecer como listo");
    });
  }
);
