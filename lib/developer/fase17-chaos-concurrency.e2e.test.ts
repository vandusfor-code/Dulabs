/**
 * DuLabs Developer V1 -- Fase 17 (17.6/17.7). Gaps de concurrencia/caos NO
 * cubiertos por los e2e previos:
 *   - claim de entrega concurrente (dos "workers" reclaman el MISMO evento):
 *     exactamente uno lo reclama (lease atómico) -> sin doble entrega.
 *   - webhook de billing DUPLICADO/concurrente (mismo provider_event_id):
 *     exactamente un registro "nuevo" (dedup por unique) -> efecto único, sin
 *     doble cobro/activación.
 * Requiere Supabase real (tablas dulabs_dev_*); crea filas desechables y limpia.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { registrarEvento, reclamarEntrega } from "@/lib/developer/events-store";
import { registrarEventoWebhook } from "@/lib/developer/billing/billing-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Fase 17 -- concurrencia/caos (gaps)", { skip: HAS_SUPABASE ? false : "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" }, () => {
  const admin: SupabaseClient = HAS_SUPABASE
    ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    : (null as unknown as SupabaseClient);

  const workspaces: string[] = [];
  const providerEventIds: string[] = [];

  after(async () => {
    for (const ws of workspaces) await admin.from("dulabs_dev_events").delete().eq("workspace_id", ws).then(() => {}, () => {});
    for (const pe of providerEventIds) await admin.from("dulabs_dev_billing_events").delete().eq("provider_event_id", pe).then(() => {}, () => {});
  });

  it("claim de entrega CONCURRENTE del mismo evento -> exactamente UNO reclama (sin doble entrega)", async () => {
    const workspaceId = randomUUID();
    workspaces.push(workspaceId);
    const eventId = `evt_${randomUUID()}`;
    const reg = await registrarEvento(admin, { eventId, workspaceId, tipo: "queued", payload: { hola: "mundo" } });
    assert.equal(reg.registrado, true);
    const id = reg.fila!.id;

    // 8 "workers" reclaman el MISMO evento a la vez.
    const resultados = await Promise.all(Array.from({ length: 8 }, () => reclamarEntrega(admin, { id })));
    const reclamados = resultados.filter((r) => r.reclamado).length;
    assert.equal(reclamados, 1, `exactamente un worker debe reclamar la entrega (obtenidos: ${reclamados})`);
  });

  it("webhook de billing DUPLICADO/concurrente (mismo provider_event_id) -> exactamente UNO 'nuevo' (efecto único)", async () => {
    const providerEventId = `wompi_evt_${randomUUID()}`;
    providerEventIds.push(providerEventId);

    const intentos = await Promise.all(
      Array.from({ length: 8 }, () =>
        registrarEventoWebhook(admin, {
          providerEventId,
          tipo: "transaction.updated",
          payload: { data: { transaction: { id: "tx_test", status: "APPROVED" } } },
          signatureVerified: true,
        }),
      ),
    );
    const nuevos = intentos.filter((r) => r.nuevo).length;
    assert.equal(nuevos, 1, `un webhook duplicado debe registrarse una sola vez (nuevos: ${nuevos})`);
  });
});
