import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { registrarNumeroEnDumo, resolverTokenMeta } from "@/lib/dumo";
import { formatearTelefono } from "@/lib/format";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";

export const runtime = "nodejs";

async function autenticarAdmin(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return { error: Response.json({ error: "Falta el token de sesión" }, { status: 401 }) };

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: Response.json({ error: "Sesión inválida" }, { status: 401 }) };
  }
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin"])) {
    return { error: Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 }) };
  }
  return { supabase, miembro };
}

/** Conecta un número a DuMo: registra token, activa reenvío y pausa la IA de dulabs. */
export async function POST(request: NextRequest) {
  const auth = await autenticarAdmin(request);
  if ("error" in auth) return auth.error;
  const { supabase, miembro } = auth;

  let body: { phone_number_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const phoneNumberId = body.phone_number_id?.trim();
  if (!phoneNumberId) {
    return Response.json({ error: "Falta phone_number_id" }, { status: 400 });
  }

  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select(
      "phone_number_id, nombre_negocio, telefono_negocio, whatsapp_business_account_id, meta_permanent_token, forward_to_dumo",
    )
    .eq("phone_number_id", phoneNumberId)
    .eq("id_tenant", miembro.tenantId)
    .maybeSingle();

  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const accessToken = resolverTokenMeta(cliente);
  if (!accessToken) {
    return Response.json(
      { error: "Este número no tiene token de Meta. Conéctalo primero con Facebook." },
      { status: 422 },
    );
  }

  try {
    await registrarNumeroEnDumo({
      phoneNumberId: cliente.phone_number_id,
      displayPhone: formatearTelefono(cliente.telefono_negocio),
      wabaId: cliente.whatsapp_business_account_id,
      label: cliente.nombre_negocio,
      accessToken,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error registrando en DuMo";
    return Response.json({ error: msg }, { status: 502 });
  }

  const { error: updateError } = await supabase
    .from("dulabs_clientes_config")
    .update({
      forward_to_dumo: true,
      ia_pausada: true,
      updated_at: new Date().toISOString(),
    })
    .eq("phone_number_id", phoneNumberId)
    .eq("id_tenant", miembro.tenantId);

  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  return Response.json({ ok: true, forward_to_dumo: true, ia_pausada: true });
}

/** Desconecta un número de DuMo: deja de reenviar (la IA sigue pausada hasta que la reanudes). */
export async function DELETE(request: NextRequest) {
  const auth = await autenticarAdmin(request);
  if ("error" in auth) return auth.error;
  const { supabase, miembro } = auth;

  let body: { phone_number_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const phoneNumberId = body.phone_number_id?.trim();
  if (!phoneNumberId) {
    return Response.json({ error: "Falta phone_number_id" }, { status: 400 });
  }

  const { error } = await supabase
    .from("dulabs_clientes_config")
    .update({
      forward_to_dumo: false,
      updated_at: new Date().toISOString(),
    })
    .eq("phone_number_id", phoneNumberId)
    .eq("id_tenant", miembro.tenantId);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, forward_to_dumo: false });
}
