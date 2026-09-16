/**
 * DuLabs Developer V1 -- Fase 2 (autorizado, sección 13 del brief). E2E
 * real contra Postgres para lib/developer/usage-ledger.ts -- la garantía
 * anti-doble-contabilización es UNIQUE(job_id), nunca solo lógica de
 * aplicación.
 *
 * REQUIERE la migración 20261007000000_dulabs_developer_v1_fase2_data_model.sql aplicada.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { reservarUso, confirmarUso, liberarUso, obtenerLedgerDelJob } from "@/lib/developer/usage-ledger";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — usage-ledger real contra Postgres (Fase 2)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_usage_ledger").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    it("reservarUso: primera reserva de un job -- ok, estado 'reservado'", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const jobId = randomUUID();
      const resultado = await reservarUso(admin, { workspaceId, jobId });
      assert.equal(resultado.reservado, true);
      if (resultado.reservado) assert.equal(resultado.fila.estado, "reservado");
    });

    it("reservarUso: DOBLE reserva del MISMO job -- la segunda se rechaza por UNIQUE(job_id) real de Postgres, nunca dos filas para el mismo job", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const jobId = randomUUID();
      const primera = await reservarUso(admin, { workspaceId, jobId });
      assert.equal(primera.reservado, true);

      const segunda = await reservarUso(admin, { workspaceId, jobId });
      assert.equal(segunda.reservado, false);
      if (!segunda.reservado) assert.equal(segunda.motivo, "ya_reservado_o_procesado");

      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("job_id", jobId);
      assert.equal(count, 1, "nunca debe existir más de una fila de ledger para el mismo job_id");
    });

    it("reservarUso: 5 reservas CONCURRENTES del mismo job -- exactamente UNA se registra (prueba de concurrencia real, no solo secuencial)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const jobId = randomUUID();
      const intentos = await Promise.all(Array.from({ length: 5 }, () => reservarUso(admin, { workspaceId, jobId })));
      const exitosas = intentos.filter((r) => r.reservado).length;
      assert.equal(exitosas, 1, "de 5 reservas concurrentes para el mismo job, exactamente una debe ganar");

      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("job_id", jobId);
      assert.equal(count, 1);
    });

    it("confirmarUso: solo transiciona desde 'reservado' -- confirmar dos veces la segunda no aplica (CAS)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const jobId = randomUUID();
      await reservarUso(admin, { workspaceId, jobId });

      const primera = await confirmarUso(admin, { workspaceId, jobId });
      assert.equal(primera.confirmado, true);
      const segunda = await confirmarUso(admin, { workspaceId, jobId });
      assert.equal(segunda.confirmado, false, "ya estaba confirmado -- confirmar de nuevo no debe 'reconfirmar' (evita doble cobro lógico)");

      const fila = await obtenerLedgerDelJob(admin, { workspaceId, jobId });
      assert.equal(fila!.estado, "confirmado");
    });

    it("liberarUso: libera una reserva no confirmada -- el job no debe cobrarse", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const jobId = randomUUID();
      await reservarUso(admin, { workspaceId, jobId });

      const resultado = await liberarUso(admin, { workspaceId, jobId });
      assert.equal(resultado.liberado, true);
      const fila = await obtenerLedgerDelJob(admin, { workspaceId, jobId });
      assert.equal(fila!.estado, "liberado");
    });

    it("liberarUso: no puede liberar un uso YA confirmado (CAS -- un job cobrado no puede 'desconfirmarse' por esta vía)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const jobId = randomUUID();
      await reservarUso(admin, { workspaceId, jobId });
      await confirmarUso(admin, { workspaceId, jobId });

      const intento = await liberarUso(admin, { workspaceId, jobId });
      assert.equal(intento.liberado, false);

      const fila = await obtenerLedgerDelJob(admin, { workspaceId, jobId });
      assert.equal(fila!.estado, "confirmado", "un uso confirmado nunca debe volver a 'liberado' vía esta función");
    });
  }
);
