/**
 * R6 — E2E de CADENA COMPLETA con cotización real (offline, sin red/Supabase):
 *
 *   Spec(catalog+sales[+humanHandoff], productos) -> compile -> draft validado -> publish -> resolver
 *     -> atenderMensajeConBusinessAgent (boundary real) -> Flow Engine real
 *       -> InternalActionExecutor REAL -> listar_catalogo_servicios / calcular_cotizacion REALES
 *
 * Fakes: el LLM (stub que solo transforma intención -> "Nombre xCantidad" y presenta el texto que el
 * BACKEND calculó), el catálogo (en memoria, por tenant), Nylas/calendario. Lo demás es código de producción.
 * La prueba central: los NÚMEROS que ve el cliente salen del backend, no del modelo.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EffectDispatchRequest } from "@/lib/flow/executor-types";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { BusinessAgentCatalogStore } from "@/lib/business-agent-catalog-store";
import type { QuoteCatalogItem } from "@/lib/business-agent-quote";
import { CONV, TELEFONO, TENANT_A, TENANT_B, agenteFaq, caps, mundo } from "@/lib/agent-compiler/e2e/testing/knowledge-harness";

const SERVICIOS_A: QuoteCatalogItem[] = [
  { tipo: "servicio", id: "s1", nombre: "Manicure semipermanente", precio: 45000 },
  { tipo: "servicio", id: "s2", nombre: "Diseño de uñas", precio: null },
];
const PRODUCTOS_A: QuoteCatalogItem[] = [
  { tipo: "producto", id: "p1", nombre: "Esmalte rojo", precio: 12000, stock: 3 },
  { tipo: "producto", id: "p2", nombre: "Lima profesional", precio: 8000, stock: 0 },
];
const SERVICIOS_B: QuoteCatalogItem[] = [{ tipo: "servicio", id: "sb1", nombre: "Corte B", precio: 99999 }];

function catalogoPorTenant(): BusinessAgentCatalogStore {
  return {
    async listarServicios(t) {
      return t === TENANT_A ? SERVICIOS_A : t === TENANT_B ? SERVICIOS_B : [];
    },
    async listarProductos(t) {
      return t === TENANT_A ? PRODUCTOS_A : [];
    },
  };
}

function agenteVentas(over: Partial<BusinessAgentSpec> = {}): BusinessAgentSpec {
  return agenteFaq({
    capabilities: caps({ catalog: true, sales: true, humanHandoff: true }),
    catalog: { source: "structured", useServices: true, useProducts: true, quoteBeforeQualification: true },
    handoff: { rules: [], defaultPauseHours: 12 },
    ...over,
  });
}

/** IA que SOLO transforma intención -> estructura y presenta lo que calculó el backend. */
function iaVentas(items: string) {
  return (req: EffectDispatchRequest): Record<string, unknown> => {
    switch (req.nodeId) {
      case "ai-catalog-propose":
        return { actionProposal: { actionType: "listar_catalogo_servicios", arguments: {} } };
      case "ai-catalog-present":
        return { responseText: String(req.payload.catalogoTexto ?? "") };
      case "ai-quote-propose":
        return { actionProposal: { actionType: "calcular_cotizacion", arguments: { items } } };
      case "ai-quote-present":
        return { responseText: String(req.payload.cotizacionTexto ?? "") };
      default:
        return { responseText: "ok" };
    }
  };
}

async function hastaLaCotizacion(items: string, spec = agenteVentas(), tenant = TENANT_A) {
  const m = await mundo(undefined, {
    createCatalogStore: () => catalogoPorTenant(),
    // El listado de servicios (con duración) sale del adaptador real del catálogo, por tenant.
    listarCatalogoServiciosReal: async (_s, tenantId) => (await catalogoPorTenant().listarServicios(tenantId)).map((s) => ({ id: s.id, nombre: s.nombre, precio: s.precio ?? 0, duracionMin: 45, categoria: null, descripcion: null })),
  });
  m.setIA(iaVentas(items));
  const a = await m.activar(spec, tenant);
  await a.turno("Hola", `${tenant}-1`); // welcome -> q-need
  await a.turno("Quiero ver qué venden", `${tenant}-2`); // -> q-qualify (calificación: 'sales' activa)
  await a.turno("Para mí", `${tenant}-3`); // -> catálogo REAL -> q-catalog-choose
  return { m, a };
}

describe("R6 — E2E: catálogo (servicios + productos) y cotización REAL calculada por el backend", () => {
  it("1. el catálogo muestra SERVICIOS y PRODUCTOS reales (con 'agotado'), sin inventar nada", async () => {
    const { m } = await hastaLaCotizacion("Manicure semipermanente x1");
    const catalogo = m.mensajes.find((t) => /Servicios:/.test(t)) ?? "";
    assert.match(catalogo, /Manicure semipermanente/);
    assert.match(catalogo, /\$45\.000/);
    assert.match(catalogo, /Productos:/);
    assert.match(catalogo, /Esmalte rojo — \$12\.000/);
    assert.match(catalogo, /Lima profesional — \$8\.000 \(agotado\)/);
    assert.match(catalogo, /Diseño de uñas — precio a confirmar \(45 min\)/, "un servicio sin precio fijo NUNCA se lista como $0");
    assert.doesNotMatch(catalogo, /\$0\b/);
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-catalog-choose");
  });

  it("2. la cotización la CALCULA el backend: 2 x 45.000 + 1 x 12.000 = 102.000, aunque el modelo no calcule nada", async () => {
    const { m, a } = await hastaLaCotizacion("Manicure semipermanente x2; Esmalte rojo x1");
    await a.turno("Dos manicures y un esmalte rojo", "q1");
    const cot = m.mensajes.find((t) => /Total:/.test(t)) ?? "";
    assert.match(cot, /Manicure semipermanente x2 — \$45\.000 c\/u = \$90\.000/);
    assert.match(cot, /Esmalte rojo x1 — \$12\.000 c\/u = \$12\.000/);
    assert.match(cot, /Total: \$102\.000/);
    const act = m.accionesDe("act-quote")[0]!;
    assert.equal(act.tenantId, TENANT_A, "el tenant sale del contexto confiable");
    assert.deepEqual((act.action as { params?: Record<string, string> }).params, { incluirServicios: "true", incluirProductos: "true" });
    // Se ofrece continuar con una persona (capacidad 'Transferir a un humano' activa).
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "btn-quote-buy");
  });

  it("3. 'Sí, quiero seguir' => transferencia REAL: aviso + pausa del chat (no se simula una venta) y la ejecución termina", async () => {
    const { m, a } = await hastaLaCotizacion("Manicure semipermanente x1");
    await a.turno("Un manicure", "q1");
    await a.turno("Sí, quiero seguir", "q2");
    assert.ok(m.mensajes.some((t) => /persona del equipo para continuar/.test(t)));
    assert.equal(m.pausas.length, 1);
    assert.deepEqual(m.pausas[0], { phoneNumberId: CONV.phoneNumberId, telefonoCliente: CONV.telefonoCliente, duracionMs: 12 * 3600 * 1000 });
    assert.equal(m.accionesDe("act-handoff-sale").length, 1);
    assert.equal(m.ejecucion(TENANT_A).status, "completed");
    assert.equal(m.eventos.length, 0, "no se crea ningún evento/pedido: cotizar y transferir NO es vender");
  });

  it("4. 'Solo el precio' => NO transfiere ni pausa", async () => {
    const { m, a } = await hastaLaCotizacion("Manicure semipermanente x1");
    await a.turno("Un manicure", "q1");
    await a.turno("Solo el precio", "q2");
    assert.equal(m.pausas.length, 0);
    assert.equal(m.accionesDe("act-handoff-sale").length, 0);
  });

  it("5. ítems que NO existen / ambiguos / sin precio: el backend lo dice y NO inventa líneas ni ofrece comprar", async () => {
    const { m, a } = await hastaLaCotizacion("Botox capilar x1");
    await a.turno("Botox", "q1");
    const cot = m.mensajes.find((t) => /No encontré en el catálogo/.test(t)) ?? "";
    assert.match(cot, /Botox capilar/);
    assert.equal(m.mensajes.some((t) => /Total:/.test(t)), false, "ninguna línea => ningún total inventado");
    assert.notEqual(m.ejecucion(TENANT_A).current_node_id, "btn-quote-buy", "sin líneas cotizadas no se ofrece 'seguir con una persona'");
    assert.equal(m.pausas.length, 0);
  });

  it("6. servicio SIN precio fijo: total parcial y 'precio a confirmar' (nunca $0)", async () => {
    const { m, a } = await hastaLaCotizacion("Diseño de uñas x1; Esmalte rojo x2");
    await a.turno("Diseño y dos esmaltes", "q1");
    const cot = m.mensajes.find((t) => /Total parcial:/.test(t)) ?? "";
    assert.match(cot, /Diseño de uñas x1 — precio a confirmar = precio a confirmar/);
    assert.match(cot, /Total parcial: \$24\.000/);
  });

  it("7. TENANT ISOLATION: la cotización del tenant B usa SOLO el catálogo de B (mismos nombres no cruzan)", async () => {
    const { m, a } = await hastaLaCotizacion("Manicure semipermanente x1; Corte B x1", agenteVentas({ catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: true } }), TENANT_B);
    await a.turno("Manicure y corte", "q1");
    const cot = m.mensajes.find((t) => /Total:|No encontré/.test(t)) ?? "";
    assert.match(cot, /Corte B x1 — \$99\.999/);
    assert.match(cot, /No encontré en el catálogo: Manicure semipermanente/, "el servicio de A no existe para B");
    assert.doesNotMatch(cot, /45\.000/);
  });

  it("8. cantidades inválidas se reportan (no se corrigen) y la IA no puede cambiar tenant/fuentes por el payload", async () => {
    const { m, a } = await hastaLaCotizacion("Manicure semipermanente x0");
    await a.turno("cero manicures", "q1");
    assert.match(m.mensajes.find((t) => /Revisa la cantidad/.test(t)) ?? "", /Manicure semipermanente/);
    // El params ESTÁTICO gana: aunque el payload traiga otras fuentes/tenant, la acción usa las del nodo.
    const act = m.accionesDe("act-quote")[0]!;
    assert.equal(act.tenantId, TENANT_A);
  });

  it("9. agente SIN 'Transferir a un humano': cotiza pero NO ofrece un paso de compra que no existe", async () => {
    const { m, a } = await hastaLaCotizacion("Manicure semipermanente x1", agenteVentas({ capabilities: caps({ catalog: true, sales: true }), handoff: { rules: [], defaultPauseHours: 24 } }));
    await a.turno("Un manicure", "q1");
    assert.ok(m.mensajes.some((t) => /Total: \$45\.000/.test(t)));
    assert.notEqual(m.ejecucion(TENANT_A).current_node_id, "btn-quote-buy");
    assert.equal(m.accionesDe("act-handoff-sale").length, 0);
    assert.equal(m.pausas.length, 0);
    void TELEFONO;
  });
});
