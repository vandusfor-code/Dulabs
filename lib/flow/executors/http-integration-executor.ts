/**
 * HTTP Integration Executor — Fase 5 (Actions + Integrations, autorizado).
 *
 * Ejecuta acciones `webhook_http` GENUINAMENTE externas (context.internal
 * === false, resuelto por IntegrationResolver -- integración aprobada,
 * misma tenant, capability coincidente, credenciales descifradas). Antes de
 * esta fase, ese camino SIEMPRE fallaba con "external_action_not_routed"
 * dentro de InternalActionExecutor (ver internal-action-executor.ts,
 * NUNCA modificado por esta fase): no existía ningún executor real que
 * hiciera la llamada HTTP.
 *
 * `createActionExecutorWithHttpIntegration()` es un WRAPPER, no un
 * reemplazo: para cualquier acción que NO sea `webhook_http` externo,
 * delega tal cual al InternalActionExecutor ya existente (mismo objeto,
 * mismo comportamiento, cero cambios) -- así AMORE/Daniela/Solo
 * Talento/Charlotte/Agenda V2/Publibordados (que solo usan actionTypes
 * internos) no ven ningún cambio de comportamiento.
 */

import { assertNotAborted } from "@/lib/flow/executor-framework";
import { validateWebhookUrl } from "@/lib/flow/validate-security";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type EffectExecutorCapabilities,
  type InternalActionOperationClass,
} from "@/lib/flow/executor-types";
import type { WebhookHttpActionConfig } from "@/lib/flow/types";

export type FetchLike = typeof fetch;

export interface HttpIntegrationDeps {
  fetchImpl?: FetchLike;
}

function isWebhookHttpAction(action: EffectDispatchRequest["action"]): action is WebhookHttpActionConfig {
  return Boolean(action) && action!.actionType === "webhook_http";
}

/** Solo variables STRING/NUMBER/BOOLEAN del payload -- nunca objetos anidados en un body HTTP saliente sin control explícito. */
function buildRequestBody(
  payload: Record<string, unknown>,
  bodyVariableKeys: string[] | undefined,
): Record<string, unknown> | undefined {
  if (!bodyVariableKeys?.length) return undefined;
  const body: Record<string, unknown> = {};
  for (const key of bodyVariableKeys) {
    if (payload[key] !== undefined) body[key] = payload[key];
  }
  return body;
}

function classifyHttpStatus(status: number): {
  success: boolean;
  classification: (typeof EFFECT_RESULT_CLASSIFICATIONS)[keyof typeof EFFECT_RESULT_CLASSIFICATIONS];
} {
  if (status >= 200 && status < 300) {
    return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS };
  }
  if (status === 401 || status === 403) {
    return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR };
  }
  if (status === 429) {
    return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT };
  }
  if (status >= 400 && status < 500) {
    return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR };
  }
  // 5xx y cualquier otro código -- el origen externo puede estar caído de
  // forma transitoria, nunca se asume que el fallo es culpa del Flow.
  return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS };
}

async function parseResponseBody(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  try {
    const parsed = await response.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return {};
  }
}

/**
 * Executor REAL de `webhook_http` externo. Solo se invoca cuando
 * context.internal === false (nunca para las ~24 acciones internas
 * existentes) -- ver createActionExecutorWithHttpIntegration() más abajo.
 */
export class HttpIntegrationExecutor {
  readonly kind = "action" as const;
  readonly version = "1.0.0";
  readonly capabilities: EffectExecutorCapabilities = {
    supportsIntegration: true,
    supportsAsync: false,
    operationClasses: ["WRITE"] as InternalActionOperationClass[],
  };

  constructor(private readonly deps: HttpIntegrationDeps = {}) {}

  async dispatch(
    request: EffectDispatchRequest,
    context: EffectExecutionContext,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    assertNotAborted(signal);

    if (context.internal) {
      // Nunca debería llegar acá (el router solo delega aquí cuando
      // !context.internal) -- defensa en profundidad, no un caso esperado.
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
        error: "http_integration_requires_external_context",
      };
    }

    if (!isWebhookHttpAction(request.action)) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "http_integration_requires_webhook_http_action",
      };
    }

    if (!context.integrationUrl || !context.integrationHttpMethod) {
      // IntegrationResolver ya validó approved/tenant/capability/credenciales
      // antes de llegar acá -- si estos campos faltan es un estado interno
      // inconsistente, nunca un fallo de configuración del usuario.
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: "integration_context_incomplete",
      };
    }

    // Defensa en profundidad: re-valida SSRF sobre la URL resuelta de la
    // integración en el momento del despacho (obligatorio reutilizar
    // validate-security.ts, nunca una segunda implementación) -- protege
    // incluso si una integración fue aprobada antes de un endurecimiento
    // posterior de la política, o si el registro fue editado directo en DB.
    const ssrfError = validateWebhookUrl(context.integrationUrl);
    if (ssrfError) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
        error: `ssrf_rejected:${ssrfError}`,
      };
    }

    assertNotAborted(signal);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(context.integrationHeadersTemplate ?? {}),
      // Credenciales SIEMPRE tienen prioridad -- nunca deben poder
      // sobreescribirse desde el headers_template de la integración.
      ...(context.credentials ?? {}),
    };

    const body = buildRequestBody(request.payload, request.action.bodyVariableKeys);
    const method = context.integrationHttpMethod;
    const doFetch = this.deps.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await doFetch(context.integrationUrl, {
        method,
        headers,
        body: method !== "GET" && body ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      // Errores de red/timeout/abort: se dejan burbujear -- el Framework
      // (executor-framework.ts::classifyThrownError) ya los clasifica de
      // forma consistente (TIMEOUT/EXTERNAL_AMBIGUOUS), sin duplicar esa
      // lógica acá.
      throw err;
    }

    const data = await parseResponseBody(response);
    const { success, classification } = classifyHttpStatus(response.status);

    return {
      success,
      classification,
      data,
      appliedResult: data,
      rawResult: data,
      externalReference: response.headers.get("x-request-id") ?? undefined,
      error: success ? undefined : `http_status_${response.status}`,
    };
  }
}

/**
 * Router de composición para kind="action" (autorizado, Fase 5) — NO
 * reemplaza ni modifica InternalActionExecutor: para cualquier acción que
 * no sea `webhook_http` resuelta como externa, delega EXACTAMENTE al
 * executor interno ya existente, sin ninguna diferencia de comportamiento.
 * Solo intercepta el único caso que antes era un callejón sin salida
 * ("external_action_not_routed").
 */
export function createActionExecutorWithHttpIntegration(
  internalExecutor: EffectExecutor,
  httpDeps?: HttpIntegrationDeps,
): EffectExecutor {
  const httpExecutor = new HttpIntegrationExecutor(httpDeps);
  return {
    kind: "action",
    version: internalExecutor.version,
    capabilities: internalExecutor.capabilities,
    async dispatch(request, context, signal) {
      if (request.action?.actionType === "webhook_http" && !context.internal) {
        return httpExecutor.dispatch(request, context, signal);
      }
      return internalExecutor.dispatch(request, context, signal);
    },
  };
}
