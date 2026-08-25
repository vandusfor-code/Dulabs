import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;

type GraphError = { error?: { message?: string; code?: number } };

// Reconecta un número de WhatsApp que YA es propiedad de la cuenta de Meta
// Business de Du Labs (no de un cliente externo) -- ej. un número que se
// desconectó por error vía "Eliminar datos" y perdió su fila y token
// guardados, pero sigue vivo y verificado en Meta. A diferencia del
// Embedded Signup normal (app/api/auth/meta-callback), este NO pide un
// `code` de OAuth interactivo: usa directamente META_ACCESS_TOKEN (System
// User de la plataforma), porque el WABA ya pertenece al mismo Business
// Manager que ese System User administra. Gateado por PLATFORM_ADMIN_SECRET
// -- mismo criterio que /api/admin/activar-suscripcion.
//
// Siempre deja ia_pausada=true: este endpoint es para números de uso
// interno (ej. envío de alertas), nunca para números que van a atender
// clientes reales sin que alguien les configure antes un agente.
function autorizado(request: NextRequest): boolean {
  const secreto = process.env.PLATFORM_ADMIN_SECRET;
  if (!secreto) return false;
  const provisto = request.headers.get("x-platform-admin-secret");
  if (!provisto) return false;
  const a = Buffer.from(provisto);
  const b = Buffer.from(secreto);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type Body = {
  phone_number_id?: string;
  tenant_email?: string;
  nombre_negocio?: string;
};

export async function POST(request: NextRequest) {
  if (!autorizado(request)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { phone_number_id: phoneNumberId, tenant_email, nombre_negocio } = body;
  if (!phoneNumberId || !tenant_email || !nombre_negocio) {
    return Response.json({ error: "Faltan 'phone_number_id', 'tenant_email' o 'nombre_negocio'" }, { status: 400 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return Response.json({ error: "META_ACCESS_TOKEN no está configurado en el servidor" }, { status: 500 });
  }

  // 1. Consultar el número por su propio ID -- whatsapp_business_account_id
  //    no es un campo válido sobre este nodo, así que solo pedimos lo que
  //    lib/meta-numero.ts ya usa con éxito en el resto de la app.
  const numeroRes = await fetch(
    `${GRAPH}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const numero = (await numeroRes.json()) as {
    id: string;
    display_phone_number: string;
    verified_name?: string;
  } & GraphError;
  if (!numeroRes.ok) {
    const meRes = await fetch(`${GRAPH}/me?fields=id,name`, { headers: { Authorization: `Bearer ${token}` } });
    const me = await meRes.json();
    return Response.json(
      {
        error: `Meta (phone_number) respondió ${numeroRes.status}: ${numero.error?.message ?? "sin detalle"}`,
        system_user_token_pertenece_a: me,
      },
      { status: 502 }
    );
  }

  // 2. Descubrir el WABA. El ID que se ve en Business Settings
  //    ("Identificador") resultó ser el del Business Manager (nodo tipo
  //    Business, sin edge /phone_numbers), no el del WABA en sí -- lo
  //    correcto es pedirle al Business sus WABA propios.
  const businessId = process.env.META_BUSINESS_ID_HINT ?? "1826177175068470";
  const wabasRes = await fetch(
    `${GRAPH}/${businessId}/owned_whatsapp_business_accounts?fields=id,name`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const wabasJson = (await wabasRes.json()) as { data?: { id: string; name: string }[] } & GraphError;
  if (!wabasRes.ok || !wabasJson.data?.length) {
    return Response.json(
      {
        error: `No se pudo listar owned_whatsapp_business_accounts de ${businessId}`,
        detalle: wabasJson,
      },
      { status: 502 }
    );
  }
  if (wabasJson.data.length > 1) {
    return Response.json(
      { error: "El Business tiene más de un WABA — hace falta lógica para elegir cuál", wabas: wabasJson.data },
      { status: 400 }
    );
  }
  const wabaId = wabasJson.data[0].id;

  const supabase = supabaseAdmin();

  // 2. Mismo guardrail que meta-callback: no reasignar en silencio un número
  //    que ya pertenece a otro tenant.
  const { data: existente } = await supabase
    .from("dulabs_clientes_config")
    .select("id_tenant")
    .eq("phone_number_id", numero.id)
    .maybeSingle();

  const { data: miembro, error: miembroError } = await supabase
    .from("dulabs_miembros_equipo")
    .select("tenant_id")
    .eq("email", tenant_email)
    .maybeSingle();
  if (miembroError) return Response.json({ error: miembroError.message }, { status: 500 });
  if (!miembro) {
    return Response.json({ error: `No existe ningún miembro de equipo con el correo '${tenant_email}'` }, { status: 404 });
  }
  if (existente && existente.id_tenant !== miembro.tenant_id) {
    return Response.json({ error: "Ese número ya está conectado a OTRO tenant de Du Labs" }, { status: 409 });
  }

  // 3. Re-suscribir la app al WABA (esto es lo que "Eliminar datos" había
  //    revocado -- sin esto, Meta no nos vuelve a mandar sus webhooks).
  const subRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const subJson = (await subRes.json()) as { success?: boolean } & GraphError;
  if (!subRes.ok || !subJson.success) {
    return Response.json(
      { error: `Falló la suscripción al webhook: ${subJson.error?.message ?? subRes.status}` },
      { status: 502 }
    );
  }

  // 4. Upsert de la fila. Sin meta_permanent_token propio -- el resto del
  //    código ya sabe caer a META_ACCESS_TOKEN cuando esta columna es NULL
  //    (mismo fallback que usan app/api/dashboard/negocio y /cuenta).
  const { data: cliente, error: upsertError } = await supabase
    .from("dulabs_clientes_config")
    .upsert(
      {
        id_tenant: miembro.tenant_id,
        phone_number_id: numero.id,
        whatsapp_business_account_id: wabaId,
        telefono_negocio: numero.display_phone_number.replace(/\D/g, ""),
        nombre_negocio,
        meta_permanent_token: null,
        ia_pausada: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number_id" }
    )
    .select("*")
    .single();
  if (upsertError) return Response.json({ error: upsertError.message }, { status: 500 });

  return Response.json({ success: true, cliente, meta_subscribed_apps: subJson });
}
