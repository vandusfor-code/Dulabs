/**
 * DuLabs Developer V1 -- Fase 2 (autorizado, sección 14 del brief). E2E
 * real contra Postgres para lib/developer/events-store.ts -- deduplicación
 * de entrega at-least-once de Pub/Sub vía UNIQUE(event_id) real.
 *
 * REQUIERE la migración 20261007000000_dulabs_developer_v1_fase2_data_model.sql aplicada.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { registrarEvento, obtenerEventosDelJob } from "@/lib/developer/events-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — events-store real contra Postgres (Fase 2)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_events").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    it("registrarEvento: primera vez que se ve un event_id -- se registra", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const eventId = randomUUID();
      const resultado = await registrarEvento(admin, { eventId, workspaceId, tipo: "received" });
      assert.equal(resultado.registrado, true);
    });

    it("registrarEvento: Pub/Sub reentrega el MISMO event_id (at-least-once) -- la segunda vez NO crea una fila nueva (dedup real por UNIQUE, no por SELECT previo)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const eventId = randomUUID();
      const primero = await registrarEvento(admin, { eventId, workspaceId, tipo: "received" });
      assert.equal(primero.registrado, true);

      const segundo = await registrarEvento(admin, { eventId, workspaceId, tipo: "received" });
      assert.equal(segundo.registrado, false);
      if (!segundo.registrado) assert.equal(segundo.motivo, "evento_duplicado");

      const { count } = await admin.from("dulabs_dev_events").select("id", { count: "exact", head: true }).eq("event_id", eventId);
      assert.equal(count, 1);
    });

    it("registrarEvento: 5 reentregas CONCURRENTES del mismo event_id -- exactamente UNA fila real (concurrencia real, no secuencial)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const eventId = randomUUID();
      const intentos = await Promise.all(Array.from({ length: 5 }, () => registrarEvento(admin, { eventId, workspaceId, tipo: "queued" })));
      const exitosos = intentos.filter((r) => r.registrado).length;
      assert.equal(exitosos, 1);

      const { count } = await admin.from("dulabs_dev_events").select("id", { count: "exact", head: true }).eq("event_id", eventId);
      assert.equal(count, 1);
    });

    it("obtenerEventosDelJob: aislado por workspace_id + job_id, ordenado cronológicamente", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const jobId = randomUUID();
      await registrarEvento(admin, { eventId: randomUUID(), workspaceId, jobId, tipo: "received" });
      await registrarEvento(admin, { eventId: randomUUID(), workspaceId, jobId, tipo: "queued" });
      await registrarEvento(admin, { eventId: randomUUID(), workspaceId, jobId, tipo: "sent" });

      const eventos = await obtenerEventosDelJob(admin, { workspaceId, jobId });
      assert.equal(eventos.length, 3);
      assert.deepEqual(eventos.map((e) => e.tipo), ["received", "queued", "sent"]);
    });

    it("obtenerEventosDelJob: un workspace no ve los eventos de un job de otro workspace, aunque coincidiera el jobId", async () => {
      const workspaceA = randomUUID();
      const workspaceB = randomUUID();
      workspacesUsados.push(workspaceA, workspaceB);
      const jobId = randomUUID();
      await registrarEvento(admin, { eventId: randomUUID(), workspaceId: workspaceA, jobId, tipo: "received" });

      const comoB = await obtenerEventosDelJob(admin, { workspaceId: workspaceB, jobId });
      assert.equal(comoB.length, 0);
    });
  }
);
