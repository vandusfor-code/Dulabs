// DuLabs Developer V1 -- Fase 10 (Onboarding + Conexión de WhatsApp,
// autorizado). Intercambio server-side del `code` de Embedded Signup por el
// token permanente del cliente, más el descubrimiento y verificación REAL
// del WABA/phone_number_id contra la Graph API de Meta.
//
// Espeja el flujo YA PROBADO EN PRODUCCIÓN de Business
// (app/api/auth/meta-callback/route.ts) SIN importarlo ni modificarlo --
// Business y Developer son productos separados. Reutiliza la ÚNICA Meta App
// verificada (NEXT_PUBLIC_META_APP_ID + META_APP_SECRET); lo único propio de
// Developer es el config_id de Embedded Signup (frontend) -- este módulo no
// necesita el config_id (Meta ya emitió el code).
//
// SEGURIDAD:
//   - `fetchImpl` inyectable: se testea TODA rama de Meta sin red real y sin
//     enviar ningún mensaje de WhatsApp.
//   - NUNCA se loguea el token permanente, el code, ni la URL del
//     intercambio (client_secret/code viajan en la query hacia Meta -- es
//     como funciona su endpoint OAuth, igual que Business; jamás se imprime).
//   - Devuelve un resultado tipado; el token solo se expone al caller
//     inmediato (la route), que lo cifra antes de persistir y nunca lo
//     devuelve al navegador.

export type ConfigMetaExchange = {
  appId: string;
  appSecret: string;
  /** Default https://graph.facebook.com -- inyectable para tests. Debe ser https en producción. */
  graphBaseUrl?: string;
  /** Default v23.0 -- mismo default que Business (META_GRAPH_VERSION). */
  graphVersion?: string;
  fetchImpl?: typeof fetch;
};

export type DatosNumeroMeta = {
  phoneNumberId: string;
  displayPhoneNumber: string;
  displayName: string | null;
  wabaId: string;
  /** Token permanente (Business Integration System User Token). El caller lo cifra de inmediato -- nunca se persiste ni se devuelve en claro. */
  tokenPermanente: string;
};

export type MotivoFalloExchange =
  | "code_invalido"
  | "waba_no_determinado"
  | "numeros_no_encontrados"
  | "phone_number_no_confirmado"
  | "numero_ambiguo"
  | "meta_error";

export type ResultadoExchange = { ok: true; datos: DatosNumeroMeta } | { ok: false; motivo: MotivoFalloExchange; detalle?: string };

type GraphError = { error?: { message?: string; code?: number } };

function baseGraph(config: ConfigMetaExchange): string {
  const raiz = config.graphBaseUrl ?? "https://graph.facebook.com";
  const version = config.graphVersion ?? "v23.0";
  return `${raiz.replace(/\/+$/, "")}/${version}`;
}

/**
 * Intercambia el `code` por el token permanente y descubre + verifica el
 * WABA y el número contra Meta. `wabaIdSugerido`/`phoneNumberIdSugerido`
 * vienen del postMessage del popup (session info) -- NUNCA se confían como
 * autoridad: el WABA se re-descubre vía debug_token si no llegó, y el número
 * se toma de la lista REAL que Meta devuelve para ese WABA (si el sugerido
 * no está en la lista real, se cae al primero real -- nunca se persiste un
 * phone_number_id que Meta no confirmó pertenece a ese WABA).
 */
export async function intercambiarYDescubrirNumeroMeta(params: {
  code: string;
  wabaIdSugerido?: string | null;
  phoneNumberIdSugerido?: string | null;
  config: ConfigMetaExchange;
}): Promise<ResultadoExchange> {
  const { config } = params;
  const doFetch = config.fetchImpl ?? fetch;
  const graph = baseGraph(config);
  const appToken = `${config.appId}|${config.appSecret}`;

  // A. code -> token permanente. (client_secret + code en query hacia Meta:
  //    su endpoint OAuth funciona así; nunca se loguea esta URL.)
  let tokenPermanente: string;
  try {
    const tokenRes = await doFetch(
      `${graph}/oauth/access_token?client_id=${encodeURIComponent(config.appId)}&client_secret=${encodeURIComponent(config.appSecret)}&code=${encodeURIComponent(params.code)}`
    );
    const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string } & GraphError;
    if (!tokenRes.ok || !tokenJson.access_token) {
      return { ok: false, motivo: "code_invalido", detalle: tokenJson.error?.message ?? `HTTP ${tokenRes.status}` };
    }
    tokenPermanente = tokenJson.access_token;
  } catch (err) {
    return { ok: false, motivo: "meta_error", detalle: err instanceof Error ? err.message : "fallo de red con Meta" };
  }

  try {
    // B. Determinar el WABA. Preferimos el del popup; si no llegó, vía
    //    debug_token -> granular_scopes -> whatsapp_business_management.
    let wabaId = params.wabaIdSugerido ?? undefined;
    if (!wabaId) {
      const dbgRes = await doFetch(`${graph}/debug_token?input_token=${encodeURIComponent(tokenPermanente)}&access_token=${encodeURIComponent(appToken)}`);
      const dbg = (await dbgRes.json().catch(() => ({}))) as { data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } } & GraphError;
      wabaId = dbg.data?.granular_scopes?.find((s) => s.scope === "whatsapp_business_management")?.target_ids?.[0];
    }
    if (!wabaId) {
      return { ok: false, motivo: "waba_no_determinado", detalle: "No se pudo determinar el whatsapp_business_account_id" };
    }

    // B2. Números REALES del WABA (verificación server-side: nunca se confía
    //     en que el navegador diga "este número es de este WABA").
    const phonesRes = await doFetch(`${graph}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${tokenPermanente}` },
    });
    const phones = (await phonesRes.json().catch(() => ({}))) as { data?: { id: string; display_phone_number: string; verified_name?: string }[] } & GraphError;
    if (!phonesRes.ok || !phones.data?.length) {
      return { ok: false, motivo: "numeros_no_encontrados", detalle: phones.error?.message ?? "El WABA no tiene números" };
    }

    // IDENTIDAD DEL NÚMERO = solo un phone_number_id CONFIRMADO por Meta.
    // Nunca "el primer número disponible" (fallback eliminado, corrección de
    // revisión de Fase 10).
    let phone: { id: string; display_phone_number: string; verified_name?: string };
    if (params.phoneNumberIdSugerido) {
      // Si el popup entregó un phone_number_id, DEBE existir en la lista real
      // del WABA. Si no está, se rechaza -- jamás se cae a otro número.
      const encontrado = phones.data.find((p) => p.id === params.phoneNumberIdSugerido);
      if (!encontrado) {
        return { ok: false, motivo: "phone_number_no_confirmado", detalle: "El phone_number_id del signup no pertenece a los números reales del WABA" };
      }
      phone = encontrado;
    } else if (phones.data.length === 1) {
      // Sin sugerencia pero el WABA tiene EXACTAMENTE un número -> identidad
      // inequívoca (no es "el primero de varios"). Se usa ese.
      phone = phones.data[0]!;
    } else {
      // Sin sugerencia y varios números -> ambiguo. No se elige arbitrariamente
      // ni se persiste ninguna conexión.
      return { ok: false, motivo: "numero_ambiguo", detalle: "El WABA tiene varios números y el signup no indicó cuál conectar" };
    }

    // Nombre del negocio: WABA.name, o verified_name del número como respaldo.
    const wabaRes = await doFetch(`${graph}/${encodeURIComponent(wabaId)}?fields=name`, { headers: { Authorization: `Bearer ${tokenPermanente}` } });
    const waba = (await wabaRes.json().catch(() => ({}))) as { name?: string } & GraphError;
    const displayName = waba.name || phone.verified_name || null;

    return {
      ok: true,
      datos: { phoneNumberId: phone.id, displayPhoneNumber: phone.display_phone_number, displayName, wabaId, tokenPermanente },
    };
  } catch (err) {
    return { ok: false, motivo: "meta_error", detalle: err instanceof Error ? err.message : "fallo de red con Meta" };
  }
}

/**
 * Suscribe NUESTRA Meta App a los webhooks de este WABA
 * (POST /{waba}/subscribed_apps) -- lo que hace que Meta enrute los eventos
 * de ese WABA a la callback URL configurada en la App. Best-effort desde el
 * punto de vista de la conexión: si falla, el número queda conectado igual
 * (el ruteo inbound de Developer es, además, una dependencia externa de Meta
 * ya pendiente por la App compartida -- ver reporte de Fase 10). El caller
 * decide qué hacer con el resultado; nunca loguea el token.
 */
export async function suscribirAppAlWaba(params: { wabaId: string; tokenPermanente: string; config: ConfigMetaExchange }): Promise<{ ok: boolean; detalle?: string }> {
  const doFetch = params.config.fetchImpl ?? fetch;
  const graph = baseGraph(params.config);
  try {
    const res = await doFetch(`${graph}/${encodeURIComponent(params.wabaId)}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${params.tokenPermanente}` },
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean } & GraphError;
    if (!res.ok || !json.success) return { ok: false, detalle: json.error?.message ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, detalle: err instanceof Error ? err.message : "fallo de red con Meta" };
  }
}
