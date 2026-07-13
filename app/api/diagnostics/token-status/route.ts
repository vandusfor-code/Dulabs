import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;

type DebugTokenResponse = {
  data?: {
    app_id?: string;
    type?: string;
    application?: string;
    is_valid?: boolean;
    issued_at?: number;
    expires_at?: number;
    scopes?: string[];
    error?: { message?: string; code?: number };
  };
  error?: { message?: string; code?: number };
};

// Diagnóstico server-side de un token de Meta: nunca recibe, registra ni
// devuelve el token en sí, solo su estado (válido/expirado, scopes, dueño).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const key = params.get("key");
  if (!process.env.META_VERIFY_TOKEN || key !== process.env.META_VERIFY_TOKEN) {
    return new Response("Forbidden", { status: 403 });
  }

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return Response.json(
      { error: "Faltan NEXT_PUBLIC_META_APP_ID o META_APP_SECRET en el servidor" },
      { status: 500 }
    );
  }

  const phoneNumberId = params.get("phone_number_id");
  let tokenToInspect: string | null = null;
  let source: string;

  if (phoneNumberId) {
    const { data, error } = await supabaseAdmin()
      .from("dulabs_clientes_config")
      .select("meta_permanent_token, nombre_negocio")
      .eq("phone_number_id", phoneNumberId)
      .maybeSingle();
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    if (!data?.meta_permanent_token) {
      return Response.json(
        { error: `Sin meta_permanent_token para phone_number_id ${phoneNumberId}` },
        { status: 404 }
      );
    }
    tokenToInspect = data.meta_permanent_token;
    source = `tenant:${data.nombre_negocio ?? phoneNumberId}`;
  } else {
    tokenToInspect = process.env.META_ACCESS_TOKEN ?? null;
    source = "platform:META_ACCESS_TOKEN";
    if (!tokenToInspect) {
      return Response.json(
        { error: "META_ACCESS_TOKEN no está configurado en el servidor" },
        { status: 500 }
      );
    }
  }
  if (!tokenToInspect) {
    return Response.json({ error: "No se encontró un token para inspeccionar" }, { status: 500 });
  }

  const debugRes = await fetch(
    `${GRAPH}/debug_token?input_token=${encodeURIComponent(tokenToInspect)}&access_token=${appId}|${appSecret}`
  );
  const debugJson = (await debugRes.json()) as DebugTokenResponse;

  if (!debugRes.ok || debugJson.error) {
    return Response.json(
      { source, valid: false, error: debugJson.error?.message ?? `HTTP ${debugRes.status}` },
      { status: 200 }
    );
  }

  const info = debugJson.data ?? {};
  return Response.json({
    source,
    valid: info.is_valid ?? false,
    type: info.type,
    app_id: info.app_id,
    application: info.application,
    scopes: info.scopes,
    issued_at: info.issued_at ? new Date(info.issued_at * 1000).toISOString() : null,
    expires_at:
      info.expires_at === 0
        ? "no expira"
        : info.expires_at
          ? new Date(info.expires_at * 1000).toISOString()
          : null,
    error: info.error?.message ?? null,
  });
}
