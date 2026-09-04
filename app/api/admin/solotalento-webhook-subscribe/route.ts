import { timingSafeEqual, createHash } from "node:crypto";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Endpoint administrativo TEMPORAL (autorizado, para eliminar tras su uso).
 * Único propósito: suscribir la app Du Labs Platform a los webhooks del WABA
 * real de SOLOTALENTO, usando META_SOLOTALENTO_TOKEN (variable de entorno
 * dedicada a este WABA, distinta de META_ACCESS_TOKEN -- no se toca el
 * token global de la plataforma). Nunca lee, registra ni devuelve el valor
 * del token -- solo el resultado de la operación contra Meta.
 */

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;
const SOLOTALENTO_WABA_ID = "251086998390445";
const DULABS_APP_ID = "1358539879780370";

function claveValida(recibida: string | null, esperada: string | undefined): boolean {
  if (!recibida || !esperada) return false;
  const a = createHash("sha256").update(recibida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

type SubscribedAppsResponse = {
  data?: { id?: string; whatsapp_business_api_data?: { id?: string; name?: string } }[];
  error?: { message?: string };
};

function apliacionSuscrita(json: SubscribedAppsResponse): boolean {
  return (json.data ?? []).some(
    (a) => a.id === DULABS_APP_ID || a.whatsapp_business_api_data?.id === DULABS_APP_ID,
  );
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (!claveValida(params.get("key"), process.env.SOLOTALENTO_SUBSCRIBE_KEY)) {
    return new Response("Forbidden", { status: 403 });
  }

  const token = process.env.META_SOLOTALENTO_TOKEN;
  if (!token) {
    return Response.json({ error: "META_SOLOTALENTO_TOKEN no está configurado en el servidor" }, { status: 500 });
  }

  // Diagnóstico del token en sí (nunca su valor) -- mismo patrón que
  // /api/diagnostics/token-status: solo si hay appId/appSecret para
  // autenticar la llamada a debug_token.
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  let diagnosticoToken: unknown = null;
  if (appId && appSecret) {
    const dbgRes = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${appId}|${appSecret}`,
    );
    const dbgJson = (await dbgRes.json()) as {
      data?: { type?: string; app_id?: string; application?: string; is_valid?: boolean; scopes?: string[] };
      error?: { message?: string };
    };
    diagnosticoToken = dbgRes.ok ? dbgJson.data : { error: dbgJson.error?.message };
  }

  // Acceso directo al objeto WABA (más permisivo que subscribed_apps -- a
  // veces WABA-level GET funciona con menos permiso que gestionar apps).
  const wabaRes = await fetch(`${GRAPH}/${SOLOTALENTO_WABA_ID}?fields=id,name,owner_business_info`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const wabaJson = (await wabaRes.json()) as { id?: string; name?: string; error?: { message?: string } };
  const accesoWaba = wabaRes.ok ? { ok: true, id: wabaJson.id, name: wabaJson.name } : { ok: false, error: wabaJson.error?.message };

  const consultar = () =>
    fetch(`${GRAPH}/${SOLOTALENTO_WABA_ID}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${token}` },
    });

  const antesRes = await consultar();
  const antesJson = (await antesRes.json()) as SubscribedAppsResponse;
  if (!antesRes.ok) {
    return Response.json(
      {
        paso: "GET_inicial",
        ok: false,
        error: antesJson.error?.message ?? `HTTP ${antesRes.status}`,
        diagnostico_token: diagnosticoToken,
        acceso_waba_directo: accesoWaba,
      },
      { status: 200 },
    );
  }

  const yaEstaba = apliacionSuscrita(antesJson);
  if (yaEstaba) {
    return Response.json({
      waba_id: SOLOTALENTO_WABA_ID,
      app_id: DULABS_APP_ID,
      suscrita: true,
      accion: "ya_estaba_suscrita",
    });
  }

  const postRes = await fetch(`${GRAPH}/${SOLOTALENTO_WABA_ID}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const postJson = (await postRes.json()) as { success?: boolean } & SubscribedAppsResponse;
  if (!postRes.ok || !postJson.success) {
    return Response.json(
      { paso: "POST_suscripcion", ok: false, error: postJson.error?.message ?? `HTTP ${postRes.status}` },
      { status: 200 },
    );
  }

  const despuesRes = await consultar();
  const despuesJson = (await despuesRes.json()) as SubscribedAppsResponse;
  const quedoSuscrita = despuesRes.ok && apliacionSuscrita(despuesJson);

  return Response.json({
    waba_id: SOLOTALENTO_WABA_ID,
    app_id: DULABS_APP_ID,
    suscrita: quedoSuscrita,
    accion: quedoSuscrita ? "suscripcion_ejecutada" : "suscripcion_fallida_tras_post",
  });
}
