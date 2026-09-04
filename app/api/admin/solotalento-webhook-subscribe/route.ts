import { timingSafeEqual, createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { cifrarSecreto } from "@/lib/crypto";

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
const SOLOTALENTO_PHONE_NUMBER_ID = "1321997104321708";
const DULABS_APP_ID = "1358539879780370";
const DULABS_BUSINESS_ID = "364602210077972";
const DULABS_SYSTEM_USER_ID = "122105370837402596";

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
  const accesoWaba = wabaRes.ok
    ? { ok: true, http_status: wabaRes.status, id: wabaJson.id, name: wabaJson.name }
    : { ok: false, http_status: wabaRes.status, error: wabaJson.error?.message };

  // Números dentro del WABA (edge distinto de subscribed_apps -- puede
  // responder distinto según qué permiso exactamente falte).
  const phonesRes = await fetch(`${GRAPH}/${SOLOTALENTO_WABA_ID}/phone_numbers?fields=id,display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const phonesJson = (await phonesRes.json()) as {
    data?: { id?: string; display_phone_number?: string; verified_name?: string }[];
    error?: { message?: string };
  };
  const accesoNumeros = phonesRes.ok
    ? { ok: true, data: phonesJson.data ?? [] }
    : { ok: false, http_status: phonesRes.status, error: phonesJson.error?.message };

  // Relación Business DuLabs <-> WABAs -- qué ve realmente el Business
  // Manager de DuLabs, no solo el System User. `owned_` son los que
  // DuLabs es dueño directo; `client_` son los compartidos por otros
  // negocios como partner (si SOLOTALENTO alguna vez compartió el suyo,
  // debería aparecer acá aunque el token no tenga permiso operativo).
  type WabaListResponse = { data?: { id?: string; name?: string }[]; error?: { message?: string } };
  const consultarLista = async (edge: string) => {
    const res = await fetch(`${GRAPH}/${DULABS_BUSINESS_ID}/${edge}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as WabaListResponse;
    return res.ok ? { ok: true, data: json.data ?? [] } : { ok: false, error: json.error?.message };
  };
  const wabasPropiosDeDulabs = await consultarLista("owned_whatsapp_business_accounts");
  const wabasCompartidosADulabs = await consultarLista("client_whatsapp_business_accounts");

  // Info del propio System User -- qué activos tiene asignados según el
  // Business Manager (requiere business_management, que sabemos que este
  // token NO tiene -- se incluye igual porque el error mismo es diagnóstico).
  const systemUserRes = await fetch(
    `${GRAPH}/${DULABS_SYSTEM_USER_ID}?fields=id,name,assigned_whatsapp_business_accounts`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const systemUserJson = (await systemUserRes.json()) as { id?: string; name?: string; error?: { message?: string } };
  const infoSystemUser = systemUserRes.ok
    ? { ok: true, ...systemUserJson }
    : { ok: false, error: systemUserJson.error?.message };

  const diagnosticoRelacionBusiness = {
    business_dulabs: DULABS_BUSINESS_ID,
    wabas_propios_de_dulabs: wabasPropiosDeDulabs,
    wabas_compartidos_a_dulabs: wabasCompartidosADulabs,
    system_user_info: infoSystemUser,
  };

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
        http_status: antesRes.status,
        error: antesJson.error?.message ?? `HTTP ${antesRes.status}`,
        diagnostico_token: diagnosticoToken,
        acceso_waba_directo: accesoWaba,
        acceso_phone_numbers: accesoNumeros,
        diagnostico_relacion_business: diagnosticoRelacionBusiness,
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

/**
 * Inyección manual de un token externo (autorizado, temporal): recibe un
 * token EN EL BODY de la petición (nunca en query string, nunca logueado),
 * verifica que de verdad tenga acceso al WABA de SOLOTALENTO ANTES de
 * guardar nada, y solo si pasa esa verificación lo cifra y lo persiste en
 * la fila de SOLOTALENTO (única, filtrada por su phone_number_id -- nunca
 * toca Daniela ni el 314), y ejecuta la suscripción del webhook. Si la
 * verificación previa falla, no se guarda ni se suscribe nada.
 */
export async function POST(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (!claveValida(params.get("key"), process.env.SOLOTALENTO_SUBSCRIBE_KEY)) {
    return new Response("Forbidden", { status: 403 });
  }

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const token = body.token;
  if (!token || typeof token !== "string") {
    return Response.json({ error: "Falta 'token' en el body de la petición" }, { status: 400 });
  }

  // 1. Verificación previa -- nunca guardar un token sin confirmar acceso real.
  const wabaRes = await fetch(`${GRAPH}/${SOLOTALENTO_WABA_ID}?fields=id,name,owner_business_info`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const wabaJson = (await wabaRes.json()) as { id?: string; name?: string; error?: { message?: string } };
  if (!wabaRes.ok) {
    return Response.json({
      paso: "verificacion_previa",
      ok: false,
      guardado: false,
      suscrito: false,
      http_status: wabaRes.status,
      error: wabaJson.error?.message ?? `HTTP ${wabaRes.status}`,
    });
  }

  // 2. Guardar cifrado -- SOLO en la fila de SOLOTALENTO, filtrado por su
  // propio phone_number_id (no toca ningún otro cliente).
  const { error: dbError } = await supabaseAdmin()
    .from("dulabs_clientes_config")
    .update({ meta_permanent_token: cifrarSecreto(token), updated_at: new Date().toISOString() })
    .eq("phone_number_id", SOLOTALENTO_PHONE_NUMBER_ID);
  if (dbError) {
    return Response.json({
      paso: "guardado_bd",
      ok: false,
      guardado: false,
      suscrito: false,
      waba_verificado: { id: wabaJson.id, name: wabaJson.name },
      error: dbError.message,
    });
  }

  // 3. Suscribir la app al WABA.
  const postRes = await fetch(`${GRAPH}/${SOLOTALENTO_WABA_ID}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const postJson = (await postRes.json()) as { success?: boolean } & SubscribedAppsResponse;
  if (!postRes.ok || !postJson.success) {
    return Response.json({
      paso: "suscripcion",
      ok: false,
      guardado: true,
      suscrito: false,
      error: postJson.error?.message ?? `HTTP ${postRes.status}`,
    });
  }

  // 4. Verificar que quedó suscrita.
  const verifyRes = await fetch(`${GRAPH}/${SOLOTALENTO_WABA_ID}/subscribed_apps`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const verifyJson = (await verifyRes.json()) as SubscribedAppsResponse;
  const suscrita = verifyRes.ok && apliacionSuscrita(verifyJson);

  return Response.json({
    paso: "completo",
    ok: true,
    guardado: true,
    suscrito: suscrita,
    waba_id: SOLOTALENTO_WABA_ID,
    phone_number_id: SOLOTALENTO_PHONE_NUMBER_ID,
    waba_verificado: { id: wabaJson.id, name: wabaJson.name },
  });
}
