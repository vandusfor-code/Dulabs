/**
 * DuLabs Developer V1 -- Fase 15. E2E del endpoint público de planes contra la
 * DB real: el pricing público coincide EXACTAMENTE con dulabs_dev_plans, el
 * anual es x10, Enterprise es manual y la respuesta NO expone secretos. Solo
 * lee el catálogo (tabla no sensible); no crea ni toca datos de cuentas.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { GET } from "./route";
import type { PlanPublico } from "@/lib/developers/planes-publicos";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Fase 15 -- GET /api/developers/plans (e2e)", { skip: HAS_SUPABASE ? false : "sin SUPABASE_URL/SERVICE_ROLE_KEY" }, () => {
  it("devuelve el catálogo y el pricing coincide con dulabs_dev_plans", async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as { plans: PlanPublico[] };
    assert.ok(Array.isArray(body.plans) && body.plans.length >= 3, "debe haber al menos 3 planes");

    // Ordenado por precio ascendente.
    const precios = body.plans.map((p) => p.precioMensualUsd ?? Infinity);
    assert.deepEqual(precios, [...precios].sort((a, b) => a - b), "planes ordenados por precio");

    const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    for (const pub of body.plans) {
      const { data: fila } = await admin
        .from("dulabs_dev_plans")
        .select("precio_mensual_usd, mensajes_mensuales_incluidos, numeros_incluidos, max_workspaces, max_members")
        .eq("codigo", pub.slug.toUpperCase())
        .maybeSingle();
      assert.ok(fila, `plan ${pub.slug} existe en dulabs_dev_plans`);
      assert.equal(pub.precioMensualUsd, fila!.precio_mensual_usd, `precio mensual de ${pub.slug}`);
      // Anual derivado x10 (nunca una columna persistida).
      const esperadoAnual = fila!.precio_mensual_usd === null ? null : Math.round(Number(fila!.precio_mensual_usd) * 10 * 100) / 100;
      assert.equal(pub.precioAnualUsd, esperadoAnual, `anual de ${pub.slug} = mensual x10`);
      assert.equal(pub.mensajesMensualesIncluidos, fila!.mensajes_mensuales_incluidos, `mensajes de ${pub.slug}`);
      assert.equal(pub.numerosIncluidos, fila!.numeros_incluidos, `números de ${pub.slug}`);
      assert.equal(pub.maxWorkspaces, fila!.max_workspaces, `workspaces de ${pub.slug}`);
      assert.equal(pub.maxMembers, fila!.max_members, `miembros de ${pub.slug}`);
    }
  });

  it("Enterprise aparece como manual (sin checkout self-service)", async () => {
    const res = await GET();
    const body = (await res.json()) as { plans: PlanPublico[] };
    const ent = body.plans.find((p) => p.slug === "enterprise");
    assert.ok(ent, "existe el plan enterprise");
    assert.equal(ent!.esManual, true);
    assert.equal(ent!.checkoutHabilitado, false);
  });

  it("Developer permite checkout y trae sus límites reales", async () => {
    const res = await GET();
    const body = (await res.json()) as { plans: PlanPublico[] };
    const dev = body.plans.find((p) => p.slug === "developer");
    assert.ok(dev, "existe el plan developer");
    assert.equal(dev!.checkoutHabilitado, true);
    assert.equal(dev!.esManual, false);
  });

  it("la respuesta NO expone secretos ni datos privados", async () => {
    const res = await GET();
    const texto = (await res.text()).toLowerCase();
    for (const prohibido of ["service_role", "account_id", "wompi", "token", "secret", "payment_source", "fx_rate", "customer_id"]) {
      assert.ok(!texto.includes(prohibido), `la respuesta contiene '${prohibido}'`);
    }
    // Cache pública (catálogo, no datos por usuario).
    assert.match(res.headers.get("cache-control") ?? "", /max-age=300/);
  });
});
