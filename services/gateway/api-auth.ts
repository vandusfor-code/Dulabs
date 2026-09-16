import type { SupabaseClient } from "@supabase/supabase-js";
import { autenticarApiKey } from "@/lib/developer/api-keys-store";
import { errorApi, retryAfterHeader, type RespuestaApi } from "./errors";
import { verificarLimiteTasa } from "@/lib/rate-limit";

// DuLabs Developer V1 -- Fase 4 (autorizado, sección "AUTHENTICATION").
// Capa de autenticación por API key para la Developer API pública --
// análoga a conWorkspaceAutenticado (services/gateway/management-handler.ts,
// autenticación por sesión de Supabase Auth) pero GENUINAMENTE separada:
// una API key nunca autentica una ruta de sesión, y viceversa (ninguna de
// las dos funciones acepta el token de la otra -- son dos mecanismos
// distintos, no una rama condicional compartida).
//
// Reusa autenticarApiKey (lib/developer/api-keys-store.ts) sin tocar su
// lógica criptográfica/de comparación en tiempo constante.

export type ContextoApiKey = { workspaceId: string; apiKeyId: string; apiKeyPrefix: string; apiKeyName: string };

function extraerBearer(header: string | undefined): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const valor = header.slice("Bearer ".length).trim();
  return valor.length > 0 ? valor : null;
}

/**
 * Protección contra fuerza bruta de API keys (sección "SEGURIDAD",
 * amenaza #1 del threat model de Fase 4) -- ANTES de siquiera intentar
 * autenticar, se verifica un límite de intentos por IP. Usa el mismo
 * mecanismo genérico de rate limiting (Postgres, ya existente, fail-open)
 * -- nunca bloquea la request real si el propio rate limiter falla.
 */
async function limiteDeIntentosFallidosExcedido(supabase: SupabaseClient, ip: string | undefined): Promise<boolean> {
  if (!ip) return false; // sin IP disponible (ej. tests locales) -- no se puede limitar por IP, no se bloquea.
  const resultado = await verificarLimiteTasa(supabase, { recurso: "dev-auth-fail", tenantId: ip, categoria: "devAuthFallida" });
  return !resultado.permitido;
}

export async function conWorkspaceAutenticadoPorApiKey(
  deps: { supabase: SupabaseClient },
  autorizacion: string | undefined,
  requestId: string,
  ipRemota: string | undefined,
  fn: (ctx: ContextoApiKey) => Promise<RespuestaApi>
): Promise<RespuestaApi> {
  const clave = extraerBearer(autorizacion);
  if (!clave) return errorApi(401, "missing_api_key", "Falta el header Authorization: Bearer dl_live_...", requestId);

  if (await limiteDeIntentosFallidosExcedido(deps.supabase, ipRemota)) {
    return errorApi(429, "rate_limit_exceeded", "Demasiados intentos de autenticación fallidos. Reintenta más tarde.", requestId);
  }

  const auth = await autenticarApiKey(deps.supabase, clave);
  if (!auth.autenticado) {
    // Mismo mensaje genérico para "no encontrada" y "revocada" -- nunca
    // revelar cuál de los dos casos aplica (amenaza #16 del threat model).
    return errorApi(401, "invalid_api_key", "API key inválida o revocada", requestId);
  }

  return fn({ workspaceId: auth.workspaceId, apiKeyId: auth.apiKeyId, apiKeyPrefix: auth.apiKeyPrefix, apiKeyName: auth.apiKeyName });
}

/**
 * Fase 4, corrección puntual (auditoría final -- categoría devLectura ya
 * existía en lib/rate-limit.ts pero ningún handler de lectura la
 * invocaba). Envuelve conWorkspaceAutenticadoPorApiKey SOLO para los 6
 * endpoints GET de la Developer API -- nunca para POST /api/v1/messages
 * ni POST /api/v1/webhooks, que ya tienen sus propios límites específicos
 * y no deben ganar un límite adicional no pedido. Mismo mecanismo Postgres
 * real ya usado (dulabs_rate_limit_incrementar), sin inventar nada nuevo.
 * Bucket por workspace (mismo criterio de aislamiento que
 * devOutboundPorWorkspace) -- dos workspaces distintos nunca comparten
 * contador, sin importar cuántas API keys tenga cada uno.
 */
export async function conLecturaAutenticadaPorApiKey(
  deps: { supabase: SupabaseClient },
  autorizacion: string | undefined,
  requestId: string,
  ipRemota: string | undefined,
  fn: (ctx: ContextoApiKey) => Promise<RespuestaApi>
): Promise<RespuestaApi> {
  return conWorkspaceAutenticadoPorApiKey(deps, autorizacion, requestId, ipRemota, async (ctx) => {
    const limite = await verificarLimiteTasa(deps.supabase, { recurso: "dev-lectura", tenantId: ctx.workspaceId, categoria: "devLectura" });
    if (!limite.permitido) {
      return errorApi(429, "rate_limit_exceeded", "Límite de 300 lecturas/minuto por workspace excedido", requestId, retryAfterHeader(limite.reiniciaEn));
    }
    return fn(ctx);
  });
}
