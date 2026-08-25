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
  whatsapp_business_account_id?: string;
  phone_number_id?: string; // opcional: solo hace falta si el WABA tiene más de un número
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

  const { whatsapp_business_account_id: wabaId, tenant_email, nombre_negocio } = body;
  if (!wabaId || !tenant_email || !nombre_negocio) {
    return Response.json(
      { error: "Faltan 'whatsapp_business_account_id', 'tenant_email' o 'nombre_negocio'" },
      { status: 400 }
    );
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return Response.json({ error: "META_ACCESS_TOKEN no está configurado en el servidor" }, { status: 500 });
  }

  // 1. Descubrir el número dentro del WABA (o validar el indicado).
  const phonesRes = await fetch(`${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const phonesJson = (await phonesRes.json()) as {
    data?: { id: string; display_phone_number: string; verified_name?: string }[];
  } & GraphError;
  if (!phonesRes.ok) {
    // Diagnóstico: casi siempre este error es "el System User de
    // META_ACCESS_TOKEN no tiene el WABA asignado en Business Manager" --
    // devolvemos su identidad para saber a quién asignarle acceso.
    const meRes = await fetch(`${GRAPH}/me?fields=id,name`, { headers: { Authorization: `Bearer ${token}` } });
    const me = await meRes.json();
    return Response.json(
      {
        error: `Meta (phone_numbers) respondió ${phonesRes.status}: ${phonesJson.error?.message ?? "sin detalle"}`,
        pista: "Probablemente el System User de META_ACCESS_TOKEN no tiene este WABA asignado en Business Manager.",
        system_user_token_pertenece_a: me,
      },
      { status: 502 }
    );
  }
  const numeros = phonesJson.data ?? [];
  if (numeros.length === 0) {
    return Response.json({ error: "Ese WABA no tiene ningún número de WhatsApp" }, { status: 404 });
  }
  const numero = body.phone_number_id ? numeros.find((n) => n.id === body.phone_number_id) : numeros[0];
  if (!numero) {
    return Response.json({ error: "phone_number_id no encontrado en ese WABA", numeros }, { status: 404 });
  }
  if (!body.phone_number_id && numeros.length > 1) {
    return Response.json(
      { error: "El WABA tiene más de un número — especifica cuál con 'phone_number_id'", numeros },
      { status: 400 }
    );
  }

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
