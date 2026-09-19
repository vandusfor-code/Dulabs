/**
 * R6 — contrato del InternalActionExecutor para calcular_cotizacion y para
 * listar_catalogo_servicios con productos. Prueba SOLO esta capa (el adaptador):
 * tenant de la solicitud (nunca del payload), params ESTÁTICOS que ganan sobre el payload/IA,
 * clasificación de fallos y formato estricto del precio nulo. La matemática se prueba a fondo en
 * lib/business-agent-quote.test.ts y la cadena completa en e2e/quote-e2e.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalActionExecutor } from "@/lib/flow/executors/internal-action-executor";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest } from "@/lib/flow/executor-types";
import type { BusinessAgentCatalogStore } from "@/lib/business-agent-catalog-store";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const CONV = { phoneNumberId: "pn-1", telefonoCliente: "573001112233" };
const AUTHORIZER: InternalActionAuthorizer = { assertActivacionOwnedByTenant: async () => true, assertPhoneNumberOwnedByTenant: async () => true };

function armar(over: { store?: BusinessAgentCatalogStore; lecturas?: string[] } = {}) {
  const lecturas = over.lecturas ?? [];
  const store: BusinessAgentCatalogStore = over.store ?? {
    async listarServicios(t) {
      lecturas.push(`servicios:${t}`);
      return [
        { tipo: "servicio", id: "s1", nombre: "Corte", precio: 30000 },
        { tipo: "servicio", id: "s2", nombre: "Diseño especial", precio: null },
      ];
    },
    async listarProductos(t) {
      lecturas.push(`productos:${t}`);
      return [{ tipo: "producto", id: "p1", nombre: "Cera", precio: 15000, stock: 1 }];
    },
  };
  return new InternalActionExecutor({
    supabase: {} as SupabaseClient,
    authorizer: AUTHORIZER,
    guardarLeadEnterprise: async () => ({ ok: false }) as never,
    activarPausaChat: async () => ({ ok: false }) as never,
    verificarDisponibilidad: async () => ({ disponible: false }) as never,
    sugerirHorariosLibres: async () => [] as never,
    crearCita: async () => ({ ok: false }) as never,
    readPausaUntil: async () => null,
    consultarDisponibilidadEspecialista: async () => ({ disponible: false }) as never,
    validarServicioEspecialista: async () => ({ ok: false }) as never,
    agendarCitaEspecialista: async () => ({ ok: false }) as never,
    cancelarCitaEspecialista: async () => ({ ok: false }) as never,
    consultarCitasActivasEspecialista: async () => ({ ok: false }) as never,
    moverCitaEspecialista: async () => ({ ok: false }) as never,
    listarHorariosDisponiblesEspecialista: async () => ({ ok: false }) as never,
    listarCatalogoServiciosReal: async () => [{ id: "s1", nombre: "Corte", precio: 30000, duracionMin: 45, categoria: null, descripcion: null }, { id: "s2", nombre: "Diseño especial", precio: 0, duracionMin: 60, categoria: null, descripcion: null }],
    createCatalogStore: () => store,
  });
}

function request(actionType: string, params: Record<string, string> | undefined, payload: Record<string, unknown>, over: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest {
  return {
    effectId: "eff-1", executionRowId: "exec-1", tenantId: TENANT_A, nodeId: "act-quote", attempt: 1, kind: "action",
    action: { actionType, ...(params ? { params } : {}) },
    payload, conversation: CONV, ...over,
  } as EffectDispatchRequest;
}
const CTX = { tenantId: TENANT_A, internal: true };

describe("calcular_cotizacion — el backend calcula (executor)", () => {
  it("1. calcula líneas/total desde el catálogo real; clasificada READ y SUCCESS", async () => {
    const r = await armar().dispatch(request("calcular_cotizacion", { incluirServicios: "true", incluirProductos: "true" }, { items: "Corte x2; Cera x1" }), CTX);
    assert.equal(r.success, true, JSON.stringify(r));
    const d = r.data as Record<string, unknown>;
    assert.equal(d.cotizacionTotal, 75000);
    assert.equal(d.cotizacionTotalTexto, "$75.000");
    assert.equal(d.cantidadLineasCotizacion, 2);
    assert.equal(d.cotizacionCompleta, true);
    assert.match(String(d.cotizacionTexto), /Corte x2 — \$30\.000 c\/u = \$60\.000/);
    assert.equal((r.metadata as { operationClass: string }).operationClass, "READ");
  });

  it("2. el TENANT sale de la solicitud, NUNCA del payload (aunque el payload traiga otro)", async () => {
    const lecturas: string[] = [];
    await armar({ lecturas }).dispatch(request("calcular_cotizacion", { incluirServicios: "true" }, { items: "Corte", tenantId: TENANT_B, id_tenant: TENANT_B, tenant_id: TENANT_B }), CTX);
    assert.deepEqual(lecturas, [`servicios:${TENANT_A}`], "solo se leyó el catálogo del tenant de la solicitud");
  });

  it("3. params ESTÁTICOS ganan sobre el payload/IA: la IA no puede pedir productos si el nodo dice false", async () => {
    const lecturas: string[] = [];
    const r = await armar({ lecturas }).dispatch(request("calcular_cotizacion", { incluirServicios: "true", incluirProductos: "false" }, { items: "Cera x1", incluirProductos: "true" }), CTX);
    assert.deepEqual(lecturas, [`servicios:${TENANT_A}`], "no se leyeron productos");
    assert.match(String((r.data as Record<string, unknown>).cotizacionTexto), /No encontré en el catálogo: Cera/);
  });

  it("4. sin ítems => NON_RETRYABLE cotizacion_sin_items (no hay nada que cotizar)", async () => {
    const r = await armar().dispatch(request("calcular_cotizacion", { incluirServicios: "true" }, { items: "  " }), CTX);
    assert.equal(r.success, false);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
    assert.equal(r.error, "cotizacion_sin_items");
  });

  it("5. si el catálogo no se puede leer => RETRYABLE catalogo_no_disponible (el flujo usa su rama de fallo; nunca inventa)", async () => {
    const roto: BusinessAgentCatalogStore = { async listarServicios() { throw new Error("db"); }, async listarProductos() { return []; } };
    const r = await armar({ store: roto }).dispatch(request("calcular_cotizacion", { incluirServicios: "true" }, { items: "Corte" }), CTX);
    assert.equal(r.success, false);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
    assert.equal(r.error, "catalogo_no_disponible");
  });

  it("6. servicio SIN precio => total parcial (nunca $0 inventado)", async () => {
    const r = await armar().dispatch(request("calcular_cotizacion", { incluirServicios: "true" }, { items: "Diseño especial x1; Corte x1" }), CTX);
    const d = r.data as Record<string, unknown>;
    assert.equal(d.cotizacionCompleta, false);
    assert.equal(d.cotizacionTotal, 30000);
    assert.match(String(d.cotizacionTexto), /Total parcial: \$30\.000/);
  });
});

describe("listar_catalogo_servicios — servicios y/o productos según los params del compiler (executor)", () => {
  it("7. sin params (agentes previos): SOLO servicios, mismas claves y texto de siempre (con el $0 histórico)", async () => {
    const lecturas: string[] = [];
    const r = await armar({ lecturas }).dispatch(request("listar_catalogo_servicios", undefined, {}), CTX);
    const d = r.data as Record<string, unknown>;
    assert.deepEqual(lecturas, [], "no toca el store nuevo: comportamiento idéntico al previo");
    assert.equal("productosDisponibles" in d, false);
    assert.match(String(d.catalogoTexto), /Diseño especial — \$0/);
  });

  it("8. con params del compiler + productos: lista ambos, servicio sin precio 'a confirmar', producto agotado marcado", async () => {
    const r = await armar().dispatch(request("listar_catalogo_servicios", { incluirServicios: "true", incluirProductos: "true" }, {}), CTX);
    const d = r.data as Record<string, unknown>;
    const texto = String(d.catalogoTexto);
    assert.match(texto, /^Servicios:/);
    assert.match(texto, /Corte — \$30\.000 \(45 min\)/);
    assert.match(texto, /Diseño especial — precio a confirmar \(1 h\)/);
    assert.match(texto, /Productos:\n• Cera — \$15\.000/);
    assert.equal(d.cantidadProductos, 1);
    assert.equal((d.catalogoDisponible as unknown[]).length, 2, "catalogoDisponible sigue siendo SOLO servicios (lo consume la reserva)");
  });

  it("9b. si la lectura AUXILIAR de precios nulos falla, el listado NO se cae (usa el texto de siempre)", async () => {
    let llamadas = 0;
    const inestable: BusinessAgentCatalogStore = {
      async listarServicios() { llamadas++; throw new Error("db caída"); },
      async listarProductos() { return []; },
    };
    const r = await armar({ store: inestable }).dispatch(request("listar_catalogo_servicios", { incluirServicios: "true", incluirProductos: "false" }, {}), CTX);
    assert.equal(r.success, true, JSON.stringify(r));
    assert.equal(llamadas, 1);
    assert.match(String((r.data as Record<string, unknown>).catalogoTexto), /Corte — \$30\.000/);
  });

  it("9. solo productos (incluirServicios=false): no lista servicios ni consulta su tabla", async () => {
    const r = await armar().dispatch(request("listar_catalogo_servicios", { incluirServicios: "false", incluirProductos: "true" }, {}), CTX);
    const d = r.data as Record<string, unknown>;
    assert.equal((d.catalogoDisponible as unknown[]).length, 0);
    assert.match(String(d.catalogoTexto), /^Productos:/);
    assert.doesNotMatch(String(d.catalogoTexto), /Servicios:/);
  });
});
