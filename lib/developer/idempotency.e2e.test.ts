/**
 * DuLabs Developer V1 -- Fase 1 (autorizado, sección 9/13 del brief,
 * sección 2.4 del documento de arquitectura). E2E real contra Supabase
 * (Postgres real, no simulado) -- mismo patrón que el resto de suites E2E
 * del repo: workspace_id desechables, se limpian al final.
 *
 * REQUIERE la migración 20261006000000_dulabs_developer_v1_fase1.sql
 * aplicada (tabla dulabs_dev_idempotency_keys) -- ver PENDING_MIGRATIONS.md.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { reclamarIdempotencia, hashPayload } from "@/lib/developer/idempotency";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — idempotencia real contra Postgres (Fase 1, sección 2.4)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_idempotency_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    it("hashPayload es determinístico para el mismo objeto", () => {
      const payload = { to: "573001234567", type: "text", text: { body: "hola" } };
      assert.equal(hashPayload(payload), hashPayload({ to: "573001234567", type: "text", text: { body: "hola" } }));
    });

    it("primera vez que se ve una (workspace, idempotency_key): resultado 'nuevo', crea un job_id real", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const r = await reclamarIdempotencia(admin, { workspaceId, idempotencyKey: "req-1", payload: { to: "573000000001" } });
      assert.equal(r.resultado, "nuevo");
      if (r.resultado === "nuevo") assert.match(r.jobId, /^[0-9a-f-]{36}$/);
    });

    it("misma clave, mismo payload: resultado 'duplicado_identico', devuelve el MISMO job_id que la primera vez", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const payload = { to: "573000000002", type: "text" };

      const primero = await reclamarIdempotencia(admin, { workspaceId, idempotencyKey: "req-2", payload });
      assert.equal(primero.resultado, "nuevo");
      const segundo = await reclamarIdempotencia(admin, { workspaceId, idempotencyKey: "req-2", payload });
      assert.equal(segundo.resultado, "duplicado_identico");

      if (primero.resultado === "nuevo" && segundo.resultado === "duplicado_identico") {
        assert.equal(segundo.jobId, primero.jobId, "el segundo intento debe devolver el job_id ya creado, nunca uno nuevo");
      }
    });

    it("misma clave, payload DISTINTO: 'conflicto_payload_distinto' -- nunca procesa el payload nuevo en silencio", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      await reclamarIdempotencia(admin, { workspaceId, idempotencyKey: "req-3", payload: { to: "573000000003" } });
      const r = await reclamarIdempotencia(admin, { workspaceId, idempotencyKey: "req-3", payload: { to: "573000000099" } });
      assert.equal(r.resultado, "conflicto_payload_distinto");
    });

    it("la misma idempotency_key en DOS workspaces distintos son independientes (aislamiento real, no solo teórico)", async () => {
      const workspaceA = randomUUID();
      const workspaceB = randomUUID();
      workspacesUsados.push(workspaceA, workspaceB);
      const claveCompartida = "misma-clave-en-ambos";

      const rA = await reclamarIdempotencia(admin, { workspaceId: workspaceA, idempotencyKey: claveCompartida, payload: { to: "A" } });
      const rB = await reclamarIdempotencia(admin, { workspaceId: workspaceB, idempotencyKey: claveCompartida, payload: { to: "B" } });

      assert.equal(rA.resultado, "nuevo");
      assert.equal(rB.resultado, "nuevo", "el workspace B no debe verse afectado por la clave del workspace A");
      if (rA.resultado === "nuevo" && rB.resultado === "nuevo") {
        assert.notEqual(rA.jobId, rB.jobId);
      }
    });

    it("CONCURRENCIA REAL: 5 reclamos simultáneos con la misma (workspace, clave) -- exactamente UNO gana 'nuevo', los demás ven el mismo job_id", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const payload = { to: "573000000005", type: "text", nota: "prueba de concurrencia real" };

      const resultados = await Promise.all(
        Array.from({ length: 5 }, () => reclamarIdempotencia(admin, { workspaceId, idempotencyKey: "req-concurrente", payload }))
      );

      const nuevos = resultados.filter((r) => r.resultado === "nuevo");
      const duplicados = resultados.filter((r) => r.resultado === "duplicado_identico");

      assert.equal(nuevos.length, 1, "exactamente una llamada concurrente debe ganar 'nuevo'");
      assert.equal(duplicados.length, 4, "las otras 4 deben ver 'duplicado_identico', nunca crear una segunda fila");

      const jobIds = new Set(resultados.map((r) => (r.resultado !== "conflicto_payload_distinto" ? r.jobId : null)));
      assert.equal(jobIds.size, 1, "las 5 llamadas concurrentes deben coincidir en el MISMO job_id -- nunca dos jobs para la misma clave");

      // Confirmación final directa contra la tabla: debe haber EXACTAMENTE
      // una fila para esta (workspace, clave), sin importar la carrera.
      const { data: filas, count } = await admin
        .from("dulabs_dev_idempotency_keys")
        .select("id", { count: "exact" })
        .eq("workspace_id", workspaceId)
        .eq("idempotency_key", "req-concurrente");
      assert.equal(count, 1);
      assert.ok(filas);
    });

    it("REPETICIÓN DESPUÉS DE COMPLETAR LA OPERACIÓN: un reintento que llega mucho después (job ya 'terminado' del lado del negocio) sigue devolviendo el MISMO job_id, nunca crea una segunda operación lógica", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const payload = { to: "573000000007", type: "text", nota: "operación que ya se completó" };

      const original = await reclamarIdempotencia(admin, { workspaceId, idempotencyKey: "req-tardio", payload });
      assert.equal(original.resultado, "nuevo");

      // Simula el paso de tiempo real (el job ya se procesó, se cobró, se
      // cerró del lado del negocio) -- la fila de idempotencia NO se borra
      // ni se toca por eso (su TTL lógico es de 24h, ver sección 2.4 del
      // documento de arquitectura). Un reintento que llega después, dentro
      // de la ventana, debe seguir viendo la MISMA operación.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const repeticionTardia = await reclamarIdempotencia(admin, { workspaceId, idempotencyKey: "req-tardio", payload });
      assert.equal(repeticionTardia.resultado, "duplicado_identico");
      if (original.resultado === "nuevo" && repeticionTardia.resultado === "duplicado_identico") {
        assert.equal(repeticionTardia.jobId, original.jobId, "la repetición tardía debe apuntar exactamente al mismo job, nunca crear uno segundo");
      }

      // Y una SEGUNDA repetición tardía, para descartar que la primera
      // repetición haya "consumido" o mutado algo -- debe seguir siendo
      // estable indefinidamente dentro de la ventana.
      const otraRepeticion = await reclamarIdempotencia(admin, { workspaceId, idempotencyKey: "req-tardio", payload });
      assert.equal(otraRepeticion.resultado, "duplicado_identico");
    });
  }
);
