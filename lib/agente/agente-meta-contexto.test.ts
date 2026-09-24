/**
 * Bloque 22 — el eslabón REAL entre Meta y el registro de fotos: el `context` que Meta manda
 * cuando el cliente desliza para responder a una foto, y el registro en Supabase (PostgREST en
 * memoria) con wamids con la forma real de Meta. Si esto se rompe, "quiero este" respondiendo a
 * una foto fallaría en producción sin que ninguna otra prueba lo note. Nada toca Supabase ni Meta.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { replyToDeMeta } from "@/lib/agente/webhook";
import { createSupabaseProductMediaLedger } from "@/lib/agente/medios";
import { supabaseAdmin } from "@/lib/supabase";
import { installSupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";

// Forma real de un wamid de Meta (base64 con '=' y '+').
const WAMID_FOTO = "wamid.HBgMNTczMDAxMTEyMjMzFQIAERgSQ0I5RjM3QTc4MjU4RkI0MzZFAA==";
const ESCENA = { tenantId: "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4", phoneNumberId: "100000000000001", waId: "573001112233" };

describe("context de Meta -> a qué respondió el cliente", () => {
  it("deslizar para responder a una foto: el id citado es el wamid de ESA foto", () => {
    // Payload real: messages[0] = { from, id, timestamp, type: "text", text: { body }, context: { from, id } }
    assert.deepEqual(replyToDeMeta({ id: WAMID_FOTO, from: "573148127388" } as never), { wamid: WAMID_FOTO, forwarded: false });
  });

  it("reenviado (o reenviado muchas veces): no hay foto citada, aunque venga un id", () => {
    assert.deepEqual(replyToDeMeta({ forwarded: true }), { wamid: null, forwarded: true });
    assert.deepEqual(replyToDeMeta({ forwarded: true, frequently_forwarded: true }), { wamid: null, forwarded: true });
    assert.deepEqual(replyToDeMeta({ id: WAMID_FOTO, forwarded: true }), { wamid: null, forwarded: true });
  });

  it("sin context, o con un id vacío: no hay respuesta a nada (nunca un wamid inventado)", () => {
    assert.equal(replyToDeMeta(undefined), null);
    assert.equal(replyToDeMeta(null), null);
    assert.deepEqual(replyToDeMeta({ id: "   " }), { wamid: null, forwarded: false });
    assert.equal(replyToDeMeta({ id: "x".repeat(500) })?.wamid?.length, 200, "acotado");
  });

  it("el webhook usa esta única lectura en el turno directo y en el buzón", () => {
    const route = readFileSync("app/webhook-dulabs/route.ts", "utf8");
    assert.equal((route.match(/replyToDeMeta\(mensaje\.context\)/g) ?? []).length, 2);
    assert.doesNotMatch(route, /wamid:\s*mensaje\.context\.id/, "sin lecturas sueltas del context");
  });
});

describe("registro de fotos enviadas en Supabase (PostgREST en memoria), con wamids reales", () => {
  it("se registra y se encuentra SOLO en la misma conversación; un wamid ajeno o inválido no encuentra nada", async () => {
    const db = installSupabaseMemoria(process.env.SUPABASE_URL);
    try {
      db.table("dulabs_agente_medios_enviados", { unique: [["wamid"]] });
      const ledger = createSupabaseProductMediaLedger(supabaseAdmin());
      const foto = { ...ESCENA, wamid: WAMID_FOTO, reference: "DL-000184", productId: "11111111-1111-4111-8111-111111111111", channel: "retail" as const, turn: 3 };
      assert.equal(await ledger.record(foto), true, "un wamid con la forma real de Meta se registra");
      assert.equal(await ledger.record(foto), false, "el mismo wamid dos veces no duplica");

      const hallada = await ledger.findByWamid(ESCENA, WAMID_FOTO);
      assert.equal(hallada?.reference, "DL-000184");
      assert.equal(hallada?.channel, "retail");
      assert.equal(await ledger.findByWamid({ ...ESCENA, waId: "573009999999" }, WAMID_FOTO), null, "otro cliente");
      assert.equal(await ledger.findByWamid({ ...ESCENA, tenantId: "bbbbbbbb-0000-4000-8000-00000000000b" }, WAMID_FOTO), null, "otro negocio");
      assert.equal(await ledger.findByWamid({ ...ESCENA, phoneNumberId: "100000000000002" }, WAMID_FOTO), null, "otro número del negocio");
      assert.equal(await ledger.findByWamid(ESCENA, "wamid.otra"), null, "wamid desconocido");
      assert.equal(await ledger.findByWamid(ESCENA, "wamid' or 1=1 --"), null, "un wamid inválido ni siquiera se consulta");
    } finally {
      db.uninstall();
    }
  });
});
