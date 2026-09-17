import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { intercambiarYDescubrirNumeroMeta, suscribirAppAlWaba } from "@/lib/developer/meta-embedded-signup-exchange";
import { cifradoCanonicoDisponible } from "@/lib/developer/secure-crypto";
import { registrarNumeroConLimite } from "@/lib/developer/whatsapp-numbers-store";
import { resolverLimitesDelWorkspace } from "@/lib/developer/plans";

// DuLabs Developer V1 -- Fase 10 (Onboarding + Conexión de WhatsApp,
// autorizado). Completa la conexión REAL de un número tras el Embedded
// Signup: recibe el `code` (+ hints del popup), lo intercambia server-side
// por el token permanente, verifica el WABA/número contra Meta, cifra el
// token y lo registra atómicamente respetando el límite del plan (Fase 7).
//
// El navegador NUNCA envía ni recibe el token de Meta. El workspace se
// resuelve server-side (conSesionDeveloper: Bearer + X-Dulabs-Workspace
// validado) -- jamás se confía en un workspace_id del cuerpo. Solo OWNER/
// ADMIN (MEMBER es read-only).

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const cuerpo = (await request.json().catch(() => null)) as { code?: string; wabaId?: string; phoneNumberId?: string } | null;
    if (!cuerpo?.code || typeof cuerpo.code !== "string") {
      return jsonError(400, "invalid_request", ctx.requestId, "Falta 'code'");
    }

    const appId = process.env.NEXT_PUBLIC_META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      // Config del servidor ausente -- error de configuración, nunca se filtra al detalle.
      console.error(`[dev-whatsapp-connect] faltan NEXT_PUBLIC_META_APP_ID/META_APP_SECRET (request_id=${ctx.requestId})`);
      return jsonError(500, "meta_config_missing", ctx.requestId);
    }
    // Fail-closed: sin el mecanismo de cifrado CANÓNICO disponible NO se toca
    // Meta ni se persiste nada (evita obtener un token que no podríamos cifrar
    // en el formato canónico). Fase 20 (B2): exige el canónico configurado, no
    // "cualquier clave" -- así un runtime en modo kms sin KMS_KEY_NAME nunca
    // obtiene un token de Meta que luego no podría cifrar como dev2.
    if (!cifradoCanonicoDisponible()) {
      console.error(`[dev-whatsapp-connect] cifrado canónico no disponible (request_id=${ctx.requestId})`);
      return jsonError(500, "encryption_unavailable", ctx.requestId);
    }

    // 1-3. Intercambio + descubrimiento/verificación server-side contra Meta.
    const meta = await intercambiarYDescubrirNumeroMeta({
      code: cuerpo.code,
      wabaIdSugerido: cuerpo.wabaId ?? null,
      phoneNumberIdSugerido: cuerpo.phoneNumberId ?? null,
      config: { appId, appSecret, graphVersion: process.env.META_GRAPH_VERSION, graphBaseUrl: process.env.META_GRAPH_API_BASE_URL },
    });
    if (!meta.ok) {
      // Fallos de identidad/entrada (code inválido, phone no confirmado por
      // Meta, número ambiguo) => 400. Fallos de Meta/red/descubrimiento => 502.
      const esFalloDeEntrada = meta.motivo === "code_invalido" || meta.motivo === "phone_number_no_confirmado" || meta.motivo === "numero_ambiguo";
      return jsonError(esFalloDeEntrada ? 400 : 502, meta.motivo, ctx.requestId, meta.detalle);
    }

    // 4-5. Cifrar el token y registrar con límite atómico (Fase 7). El token
    //      se cifra dentro de registrarNumeroConLimite (recibe el valor en
    //      claro solo para cifrarlo en TS antes de tocar Postgres).
    const limites = await resolverLimitesDelWorkspace(ctx.supabase, ctx.workspaceId);
    let resultado;
    try {
      resultado = await registrarNumeroConLimite(ctx.supabase, {
        workspaceId: ctx.workspaceId,
        phoneNumberId: meta.datos.phoneNumberId,
        wabaId: meta.datos.wabaId,
        displayName: meta.datos.displayName,
        metaToken: meta.datos.tokenPermanente,
        limiteNumeros: limites.numerosIncluidos,
      });
    } catch (err) {
      // Fallo real de persistencia -- nunca deja fila/token parcial (el RPC
      // es atómico). No se filtra el detalle interno al cliente.
      console.error(`[dev-whatsapp-connect] error registrando (request_id=${ctx.requestId}):`, err instanceof Error ? err.message : String(err));
      return jsonError(500, "internal_error", ctx.requestId);
    }
    if (!resultado.ok) {
      if (resultado.motivo === "limite_numeros_excedido") {
        return jsonError(403, "number_limit_exceeded", ctx.requestId, `El plan ${limites.planCodigo} incluye ${limites.numerosIncluidos} números`);
      }
      // numero_ya_conectado_a_otro_workspace -- no se revela a qué workspace.
      return jsonError(409, "number_already_connected", ctx.requestId);
    }

    // 6. Suscripción de la App al WABA (ruteo de webhooks). Best-effort: el
    //    número ya quedó conectado; con la App compartida con Business el
    //    ruteo inbound de Developer es una dependencia externa de Meta ya
    //    pendiente (ver reporte de Fase 10), así que un fallo aquí NO revierte
    //    la conexión -- solo se reporta como advertencia.
    const suscripcion = await suscribirAppAlWaba({
      wabaId: meta.datos.wabaId,
      tokenPermanente: meta.datos.tokenPermanente,
      config: { appId, appSecret, graphVersion: process.env.META_GRAPH_VERSION, graphBaseUrl: process.env.META_GRAPH_API_BASE_URL },
    });
    if (!suscripcion.ok) {
      console.warn(`[dev-whatsapp-connect] subscribed_apps falló (no fatal, request_id=${ctx.requestId}): ${suscripcion.detalle ?? "sin detalle"}`);
    }

    // Respuesta: SOLO metadata pública -- jamás el token de Meta.
    return jsonOk(
      {
        id: resultado.fila.id,
        phoneNumberId: resultado.fila.phone_number_id,
        displayName: resultado.fila.display_name,
        displayPhoneNumber: meta.datos.displayPhoneNumber,
        status: resultado.fila.estado,
        reconnected: resultado.reconectado,
        webhookSubscribed: suscripcion.ok,
        createdAt: resultado.fila.created_at,
      },
      ctx.requestId,
      resultado.reconectado ? 200 : 201
    );
  });
}
