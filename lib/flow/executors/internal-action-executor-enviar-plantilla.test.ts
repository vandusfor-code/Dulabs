/**
 * FASE F8.1 (Flow Engine <-> WhatsApp Cloud API, autorizado) — tests del
 * caso REAL "enviar_plantilla" en InternalActionExecutor (antes un
 * callejón sin salida: "internal_action_not_supported"). Mismo criterio
 * exacto que internal-action-executor-etiquetar.test.ts (F7 Bloque 2) y
 * flow-f7-3-contact-tools.test.ts (F7.3): nunca red real, nunca WhatsApp
 * real -- enviarPlantilla/resolverClienteWhatsapp/resolverPlantillaAprobadaDelTenant
 * se inyectan como fakes.
 *
 * Grupos: unitarios (InternalActionExecutor directo) + integración
 * (EffectExecutorFramework -> IntegrationResolver -> InternalActionExecutor,
 * confirmando el registro real de "enviar_plantilla" en integration-resolver.ts).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalActionExecutor, type InternalActionDeps } from "@/lib/flow/executors/internal-action-executor";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest } from "@/lib/flow/executor-types";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import type { ClienteConfig } from "@/lib/supabase";
import type { PlantillaAprobada } from "@/lib/plantillas";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const conversation = { phoneNumberId: "phone-123", telefonoCliente: "573001112233" };

function baseRequest(overrides: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest {
  return {
    effectId: "fx-1",
    executionRowId: "exec-row-1",
    tenantId: TENANT_A,
    nodeId: "node-1",
    kind: "action",
    payload: {},
    attempt: 1,
    ...overrides,
  };
}

function alwaysOwnedAuthorizer(): InternalActionAuthorizer {
  return {
    assertActivacionOwnedByTenant: async () => true,
    assertPhoneNumberOwnedByTenant: async () => true,
  };
}

function fakeCliente(overrides: Partial<ClienteConfig> = {}): ClienteConfig {
  return {
    id: "cliente-row-1",
    id_tenant: TENANT_A,
    nombre_negocio: "Negocio de prueba",
    whatsapp_business_account_id: "waba-1",
    phone_number_id: conversation.phoneNumberId,
    telefono_negocio: "0000000000",
    prompt_sistema: null,
    api_key_ia: null,
    meta_permanent_token: "token-cifrado-fake",
    estado_pausa: false,
    pausado_hasta: null,
    plan: null,
    mensajes_usados_mes: 0,
    mes_actual: "2026-09",
    base_conocimiento: null,
    base_conocimiento_nombre_archivo: null,
    base_conocimiento_actualizado_at: null,
    calidad: null,
    limite_mensajeria: null,
    estado_verificacion: null,
    estado_nombre_visible: null,
    ultima_sincronizacion_meta: null,
    nombre_agente: null,
    ia_pausada: false,
    ia_restringida_a: null,
    ia_numeros_bloqueados: null,
    forward_to_dumo: false,
    captura_leads: false,
    agente_id: null,
    marketplace_activacion_id: null,
    ...overrides,
  } as ClienteConfig;
}

function fakePlantilla(overrides: Partial<PlantillaAprobada> = {}): PlantillaAprobada {
  return { id: 1, nombre: "recordatorio_cita", idioma: "es_CO", ...overrides };
}

function baseInternalDeps(overrides: Partial<InternalActionDeps> = {}): InternalActionDeps {
  return {
    supabase: {} as SupabaseClient,
    authorizer: alwaysOwnedAuthorizer(),
    guardarLeadEnterprise: async () => ({ success: false, error: "unused" }),
    activarPausaChat: async () => ({ ok: false, error: "unused" }),
    verificarDisponibilidad: async () => false,
    sugerirHorariosLibres: async () => [],
    crearCita: async () => null,
    readPausaUntil: async () => null,
    consultarDisponibilidadEspecialista: async () => ({ ok: false as const, motivo: "servicio_no_manejado" as const, detalle: "stub" }),
    validarServicioEspecialista: async () => ({ ok: false as const, motivo: "servicio_no_manejado" as const, detalle: "stub" }),
    agendarCitaEspecialista: async () => ({ ok: false as const, motivo: "servicio_no_manejado" as const, detalle: "stub" }),
    cancelarCitaEspecialista: async () => ({ ok: false as const, motivo: "sin_cita_activa" as const, detalle: "stub" }),
    consultarCitasActivasEspecialista: async () => ({ cantidad: 0, citas: [] }),
    moverCitaEspecialista: async () => ({ ok: false as const, motivo: "sin_cita_activa" as const, detalle: "stub" }),
    listarHorariosDisponiblesEspecialista: async () => ({ ok: false as const, motivo: "servicio_no_manejado" as const, detalle: "stub" }),
    resolverClienteWhatsapp: async () => fakeCliente(),
    resolverPlantillaAprobadaDelTenant: async () => fakePlantilla(),
    resolverTokenMeta: () => "token-real-descifrado-fake",
    enviarPlantilla: async () => ({ wamid: "wamid.FAKE123" }),
    incrementarUsoMensajes: async () => {},
    registrarMensaje: async () => false,
    ...overrides,
  };
}

describe("FASE F8.1 — InternalActionExecutor::enviar_plantilla (unitarios)", () => {
  it("1. llega a InternalActionExecutor y llama a enviarPlantilla con los parámetros correctos", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        enviarPlantilla: async (params) => {
          capturedParams = params as unknown as Record<string, unknown>;
          return { wamid: "wamid.ABC" };
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "enviar_plantilla", templateName: "recordatorio_cita" },
        conversation,
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(capturedParams?.phoneNumberId, conversation.phoneNumberId);
    assert.equal(capturedParams?.token, "token-real-descifrado-fake");
    assert.equal(capturedParams?.para, conversation.telefonoCliente);
    assert.equal(capturedParams?.nombrePlantilla, "recordatorio_cita");
    assert.equal(capturedParams?.idioma, "es_CO");
  });

  it("2. éxito devuelve wamid en el resultado", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({ enviarPlantilla: async () => ({ wamid: "wamid.SUCCESS1" }) }),
    );
    const result = await executor.dispatch(
      baseRequest({ action: { actionType: "enviar_plantilla", templateName: "recordatorio_cita" }, conversation }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(result.data?.wamid, "wamid.SUCCESS1");
    assert.equal(result.externalReference, "wamid:wamid.SUCCESS1");
  });

  it("3. error de Meta (enviarPlantilla lanza) se propaga como RETRYABLE, nunca se trata como éxito", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        enviarPlantilla: async () => {
          throw new Error("Meta respondió 400: (#132001) Template not approved");
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({ action: { actionType: "enviar_plantilla", templateName: "recordatorio_cita" }, conversation }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
    assert.match(result.error ?? "", /Template not approved/);
  });

  it("4. las variables del template se interpolan contra las variables reales de la ejecución", async () => {
    let capturedVariables: unknown;
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        enviarPlantilla: async (params) => {
          capturedVariables = params.variables;
          return { wamid: "wamid.VARS" };
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({
        action: {
          actionType: "enviar_plantilla",
          templateName: "recordatorio_cita",
          variables: { nombre_cliente: "{{nombre}}", fecha: "{{fecha}}", literal: "sin llaves" },
        },
        conversation,
        payload: { nombre: "Ana", fecha: "2026-09-20" },
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.deepEqual(capturedVariables, [
      { nombre: "nombre_cliente", valor: "Ana" },
      { nombre: "fecha", valor: "2026-09-20" },
      { nombre: "literal", valor: "sin llaves" },
    ]);
  });

  it("5. variable ausente en el estado interpola a vacío, nunca lanza", async () => {
    let capturedVariables: unknown;
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        enviarPlantilla: async (params) => {
          capturedVariables = params.variables;
          return { wamid: "wamid.EMPTY" };
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "enviar_plantilla", templateName: "recordatorio_cita", variables: { falta: "{{no_existe}}" } },
        conversation,
        payload: {},
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.deepEqual(capturedVariables, [{ nombre: "falta", valor: "" }]);
  });

  it("6. templateName vacío falla de forma controlada (VALIDATION_ERROR), nunca llama a Meta", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        enviarPlantilla: async () => {
          throw new Error("no debía llamarse sin templateName válido");
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({ action: { actionType: "enviar_plantilla", templateName: "" }, conversation }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
    assert.equal(result.error, "invalid_template_name");
  });

  it("7. plantilla inexistente o no aprobada falla de forma controlada, nunca llama a Meta", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        resolverPlantillaAprobadaDelTenant: async () => null,
        enviarPlantilla: async () => {
          throw new Error("no debía llamarse sin plantilla resuelta");
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({ action: { actionType: "enviar_plantilla", templateName: "no_existe" }, conversation }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
    assert.equal(result.error, "plantilla_no_encontrada_o_no_aprobada");
  });

  it("8. sin conversation -> VALIDATION_ERROR, nunca llama a Supabase/Meta", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        resolverClienteWhatsapp: async () => {
          throw new Error("no debía llamarse sin conversation");
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({ action: { actionType: "enviar_plantilla", templateName: "recordatorio_cita" } }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.error, "conversation_required");
  });

  it("9. sin token de Meta disponible -> AUTH_ERROR, nunca llama a Meta", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        resolverTokenMeta: () => null,
        enviarPlantilla: async () => {
          throw new Error("no debía llamarse sin token");
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({ action: { actionType: "enviar_plantilla", templateName: "recordatorio_cita" }, conversation }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR);
    assert.equal(result.error, "meta_token_unavailable");
  });

  it("10. wamid se persiste en el historial y se incrementa el uso de mensajes", async () => {
    let registrado: unknown[] | undefined;
    let usoIncrementado = false;
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        enviarPlantilla: async () => ({ wamid: "wamid.PERSIST" }),
        registrarMensaje: async (_s, phoneNumberId, telefonoCliente, direccion, contenido, origen, wamid) => {
          registrado = [phoneNumberId, telefonoCliente, direccion, contenido, origen, wamid];
          return false;
        },
        incrementarUsoMensajes: async () => {
          usoIncrementado = true;
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({ action: { actionType: "enviar_plantilla", templateName: "recordatorio_cita" }, conversation }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.deepEqual(registrado, [
      conversation.phoneNumberId,
      conversation.telefonoCliente,
      "saliente",
      "[plantilla:recordatorio_cita]",
      "ia",
      "wamid.PERSIST",
    ]);
    assert.equal(usoIncrementado, true);
  });
});

describe("FASE F8.1 — seguridad / aislamiento multi-tenant", () => {
  it("11. el phone_number_id/tenant SIEMPRE vienen de request.conversation/request.tenantId, nunca del payload", async () => {
    let phoneNumberIdConsultado: string | undefined;
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        resolverClienteWhatsapp: async (_s, phoneNumberId) => {
          phoneNumberIdConsultado = phoneNumberId;
          return fakeCliente();
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "enviar_plantilla", templateName: "recordatorio_cita" },
        conversation,
        // Payload "malicioso": intenta colar otro número/tenant -- el
        // executor jamás lee estos campos de payload para decidir de dónde
        // enviar.
        payload: { phoneNumberId: "otro-numero", tenantId: TENANT_B, token: "token-robado" },
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(phoneNumberIdConsultado, conversation.phoneNumberId);
  });

  it("12. el authorizer rechaza -> SECURITY_REJECTED, nunca se resuelve cliente/token/plantilla", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        authorizer: { assertActivacionOwnedByTenant: async () => true, assertPhoneNumberOwnedByTenant: async () => false },
        resolverClienteWhatsapp: async () => {
          throw new Error("no debía llamarse -- el authorizer ya rechazó");
        },
      }),
    );
    const result = await executor.dispatch(
      baseRequest({ action: { actionType: "enviar_plantilla", templateName: "recordatorio_cita" }, conversation }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
  });

  it("13. cross-tenant: la fila de dulabs_clientes_config resuelta pertenece a OTRO tenant -> SECURITY_REJECTED (defensa en profundidad)", async () => {
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        resolverClienteWhatsapp: async () => fakeCliente({ id_tenant: TENANT_B }),
      }),
    );
    const result = await executor.dispatch(
      baseRequest({ action: { actionType: "enviar_plantilla", templateName: "recordatorio_cita" }, conversation, tenantId: TENANT_A }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.equal(result.error, "tenant_resource_mismatch");
  });

  it("14. resolverPlantillaAprobadaDelTenant se consulta SIEMPRE con request.tenantId (nunca con el tenant del payload)", async () => {
    let tenantConsultado: string | undefined;
    const executor = new InternalActionExecutor(
      baseInternalDeps({
        resolverPlantillaAprobadaDelTenant: async (_s, tenantId) => {
          tenantConsultado = tenantId;
          return fakePlantilla();
        },
      }),
    );
    await executor.dispatch(
      baseRequest({
        action: { actionType: "enviar_plantilla", templateName: "recordatorio_cita" },
        conversation,
        tenantId: TENANT_A,
        payload: { tenantId: TENANT_B },
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(tenantConsultado, TENANT_A);
  });
});

describe("FASE F8.1 — integración: EffectExecutorFramework -> IntegrationResolver -> InternalActionExecutor", () => {
  it("15. enviar_plantilla está registrado como acción interna real (no rechaza con integration_required)", async () => {
    const executor = new InternalActionExecutor(baseInternalDeps({ enviarPlantilla: async () => ({ wamid: "wamid.FRAMEWORK" }) }));
    const framework = createTestEffectExecutorFramework({ executors: [executor] });

    const result = await framework.execute(
      baseRequest({
        action: { actionType: "enviar_plantilla", templateName: "recordatorio_cita" },
        conversation,
      }),
    );

    assert.notEqual(result.error, "integration_required");
    assert.equal(result.success, true);
    assert.equal(result.data?.wamid, "wamid.FRAMEWORK");
  });

  it("16. control del mecanismo de rechazo: un actionType realmente no registrado en INTERNAL_ACTION_TYPES sí se rechaza con integration_required", async () => {
    // Prueba de control (no una regresión de F8.1): confirma que el mecanismo
    // de IntegrationResolver que acabamos de verificar para "enviar_plantilla"
    // sigue rechazando normalmente lo que de verdad no está registrado --
    // así el test 15 de arriba prueba algo real, no un framework que deja
    // pasar cualquier actionType. NOTA (hallazgo colateral, fuera de alcance
    // de F8.1, NO corregido acá): "asignar_miembro" tampoco está en
    // INTERNAL_ACTION_TYPES -- mismo patrón de bug ya documentado para
    // etiquetar_conversacion/get_contact/enviar_plantilla, pero no forma
    // parte de este bloque autorizado. Se usa aquí únicamente como ejemplo
    // de un actionType real que hoy SÍ está sin registrar, para no inventar
    // uno ficticio.
    const executor = new InternalActionExecutor(baseInternalDeps());
    const framework = createTestEffectExecutorFramework({ executors: [executor] });
    const result = await framework.execute(
      baseRequest({
        action: { actionType: "asignar_miembro", memberId: "1" },
        conversation,
      }),
    );
    assert.equal(result.error, "integration_required");
  });
});
