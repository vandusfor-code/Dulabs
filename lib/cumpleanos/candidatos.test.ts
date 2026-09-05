import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { esCumpleanosHoy, buscarCumpleanosDelDia } from "./candidatos";

describe("esCumpleanosHoy (Fase 6A, pura) -- Pruebas 1/2/3", () => {
  it("1. cumpleaños hoy -> candidato", () => {
    assert.equal(esCumpleanosHoy(4, 9, 4, 9), true);
  });
  it("2. cumpleaños mañana -> NO candidato", () => {
    assert.equal(esCumpleanosHoy(5, 9, 4, 9), false);
  });
  it("3. sin cumpleaños registrado -> NO candidato", () => {
    assert.equal(esCumpleanosHoy(null, null, 4, 9), false);
    assert.equal(esCumpleanosHoy(4, null, 4, 9), false);
  });
});

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("buscarCumpleanosDelDia (Fase 6A, integración real) -- Prueba 4", { skip: !HAS_SUPABASE && "requiere Supabase" }, () => {
  // Solo usa dulabs_clientes_conocidos (ya existente) -- no depende de
  // ninguna migración nueva de esta fase.
  let supabase: SupabaseClient;
  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const PHONE = `test-cumple-${Date.now()}`;
  const clienteIds: number[] = [];

  before(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: a } = await supabase
      .from("dulabs_clientes_conocidos")
      .insert({ id_tenant: TENANT_A, phone_number_id: PHONE, telefono_cliente: "573000000101", nombre: "Cliente Tenant A", cumple_dia: 4, cumple_mes: 9 })
      .select("id")
      .single();
    clienteIds.push(a!.id as number);

    const { data: b } = await supabase
      .from("dulabs_clientes_conocidos")
      .insert({ id_tenant: TENANT_B, phone_number_id: PHONE, telefono_cliente: "573000000102", nombre: "Cliente Tenant B", cumple_dia: 4, cumple_mes: 9 })
      .select("id")
      .single();
    clienteIds.push(b!.id as number);
  });

  after(async () => {
    if (clienteIds.length) await supabase.from("dulabs_clientes_conocidos").delete().in("id", clienteIds);
  });

  it("4. un cliente de OTRO tenant nunca aparece como candidato de este tenant", async () => {
    const resultado = await buscarCumpleanosDelDia(supabase, TENANT_A, { dia: 4, mes: 9 });
    assert.equal(resultado.length, 1);
    assert.equal(resultado[0]!.nombre, "Cliente Tenant A");
    assert.ok(!resultado.some((c) => c.nombre === "Cliente Tenant B"));
  });
});
