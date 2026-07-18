import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";

export const runtime = "nodejs";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;

type GraphError = { error?: { message?: string; code?: number } };

export async function POST(request: NextRequest) {
  let body: {
    code?: string;
    waba_id?: string;
    phone_number_id?: string;
    plan?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "JSON inválido" }, { status: 400 });
  }

  const { code } = body;
  if (!code) {
    return Response.json({ success: false, error: "Falta 'code'" }, { status: 400 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const sessionToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!sessionToken) {
    return Response.json({ success: false, error: "Falta la sesión del usuario" }, { status: 401 });
  }
  const { data: userData, error: userError } = await supabaseAdmin().auth.getUser(sessionToken);
  if (userError || !userData.user) {
    return Response.json({ success: false, error: "Sesión inválida" }, { status: 401 });
  }

  const miembroExistente = await resolverMiembroEquipo(supabaseAdmin(), userData.user.id);
  let idTenant: string;
  if (miembroExistente) {
    if (!requireRol(miembroExistente, ["admin"])) {
      return Response.json(
        { success: false, error: "Solo un administrador del equipo puede conectar números de WhatsApp" },
        { status: 403 }
      );
    }
    idTenant = miembroExistente.tenantId;
  } else {
    // Primer contacto de este usuario con la plataforma: se convierte en
    // admin de su propio tenant nuevo (mismo comportamiento de hoy).
    idTenant = userData.user.id;
    const { error: provisionError } = await supabaseAdmin().from("dulabs_miembros_equipo").upsert(
      { tenant_id: idTenant, user_id: idTenant, email: userData.user.email ?? "", rol: "admin", estado: "activo" },
      { onConflict: "user_id", ignoreDuplicates: true }
    );
    if (provisionError) {
      console.error("[meta-callback] error provisionando miembro de equipo:", provisionError.message);
    }
  }

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return Response.json(
      { success: false, error: "Faltan NEXT_PUBLIC_META_APP_ID o META_APP_SECRET en el servidor" },
      { status: 500 }
    );
  }

  try {
    // A. Intercambio del code por el Business Integration System User Token
    //    (larga duración — es el token permanente del tenant).
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`
    );
    const tokenJson = (await tokenRes.json()) as { access_token?: string } & GraphError;
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(`Intercambio de token falló: ${tokenJson.error?.message ?? tokenRes.status}`);
    }
    const tenantToken = tokenJson.access_token;

    // B. Identificar el WABA. Preferimos el que reportó el popup (session info);
    //    si no llegó, lo descubrimos vía debug_token (granular_scopes).
    let wabaId = body.waba_id;
    if (!wabaId) {
      const dbgRes = await fetch(
        `${GRAPH}/debug_token?input_token=${encodeURIComponent(tenantToken)}&access_token=${appId}|${appSecret}`
      );
      const dbg = (await dbgRes.json()) as {
        data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] };
      } & GraphError;
      wabaId = dbg.data?.granular_scopes?.find(
        (s) => s.scope === "whatsapp_business_management"
      )?.target_ids?.[0];
    }
    if (!wabaId) {
      throw new Error("No se pudo determinar el whatsapp_business_account_id del cliente");
    }

    // B2. Números del WABA (id + display) y nombre del negocio.
    const phonesRes = await fetch(
      `${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${tenantToken}` } }
    );
    const phones = (await phonesRes.json()) as {
      data?: { id: string; display_phone_number: string; verified_name?: string }[];
    } & GraphError;
    if (!phonesRes.ok || !phones.data?.length) {
      throw new Error(
        `No se encontraron números en el WABA ${wabaId}: ${phones.error?.message ?? "sin datos"}`
      );
    }
    const phone =
      phones.data.find((p) => p.id === body.phone_number_id) ?? phones.data[0];

    const wabaRes = await fetch(`${GRAPH}/${wabaId}?fields=name`, {
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
    const waba = (await wabaRes.json()) as { name?: string } & GraphError;
    const nombreNegocio = waba.name || phone.verified_name || "Negocio sin nombre";

    // C. Persistencia multi-tenant (upsert por phone_number_id). La tabla tiene
    //    RLS activo sin políticas: solo este backend (service role) la toca.
    const supabase = supabaseAdmin();
    const { error: dbError } = await supabase
      .from("dulabs_clientes_config")
      .upsert(
        {
          id_tenant: idTenant,
          phone_number_id: phone.id,
          whatsapp_business_account_id: wabaId,
          meta_permanent_token: tenantToken,
          nombre_negocio: nombreNegocio,
          telefono_negocio: phone.display_phone_number.replace(/\D/g, ""),
          updated_at: new Date().toISOString(),
          // Solo se sobreescribe si el front mandó un plan elegido en esta
          // conexión; si no, el upsert no toca la columna (conserva el actual).
          ...(body.plan ? { plan: body.plan } : {}),
        },
        { onConflict: "phone_number_id" }
      );
    if (dbError) {
      throw new Error(`Error guardando en Supabase: ${dbError.message}`);
    }

    // D. Suscribir nuestra app a los webhooks de este WABA para que Meta
    //    enrute sus mensajes al webhook central (/webhook-dulabs).
    const subRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
    const sub = (await subRes.json()) as { success?: boolean } & GraphError;
    if (!subRes.ok || !sub.success) {
      throw new Error(
        `El negocio quedó guardado pero falló la suscripción al webhook: ${sub.error?.message ?? subRes.status}`
      );
    }

    console.log(
      `[meta-callback] tenant conectado: "${nombreNegocio}" (waba ${wabaId}, phone ${phone.id})`
    );
    return Response.json({
      success: true,
      negocio: nombreNegocio,
      telefono: phone.display_phone_number,
      phone_number_id: phone.id,
    });
  } catch (err) {
    console.error("[meta-callback] error:", err);
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
