import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { crearFuentePago, crearTransaccion } from "@/lib/wompi";
import { precioPlan } from "@/lib/planes";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";

export const runtime = "nodejs";

// Recibe el token de tarjeta ya tokenizado por Wompi desde el navegador
// (nunca vemos el número de tarjeta en nuestro servidor), crea una fuente
// de pago reutilizable y cobra el primer mes marcando recurrent: true.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const sessionToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!sessionToken) {
    return Response.json({ error: "Falta el token de sesión" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(sessionToken);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }

  const miembroExistente = await resolverMiembroEquipo(supabase, userData.user.id);
  let idTenant: string;
  if (miembroExistente) {
    if (!requireRol(miembroExistente, ["admin"])) {
      return Response.json({ error: "Solo un administrador del equipo puede gestionar la suscripción" }, { status: 403 });
    }
    idTenant = miembroExistente.tenantId;
  } else {
    idTenant = userData.user.id;
    const { error: provisionError } = await supabase.from("dulabs_miembros_equipo").upsert(
      { tenant_id: idTenant, user_id: idTenant, email: userData.user.email ?? "", rol: "admin", estado: "activo" },
      { onConflict: "user_id", ignoreDuplicates: true }
    );
    if (provisionError) {
      console.error("[pagos/suscribir] error provisionando miembro de equipo:", provisionError.message);
    }
  }

  let body: {
    token?: string;
    plan?: string;
    customer_email?: string;
    acceptance_token?: string;
    accept_personal_auth?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { token, plan, customer_email, acceptance_token, accept_personal_auth } = body;
  if (!token || !plan || !customer_email || !acceptance_token || !accept_personal_auth) {
    return Response.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const precioCop = precioPlan(plan);

  try {
    const fuente = await crearFuentePago({
      token,
      customer_email,
      acceptance_token,
      accept_personal_auth,
    });
    if (fuente.status !== "AVAILABLE") {
      throw new Error(`La fuente de pago quedó en estado ${fuente.status}`);
    }

    const referencia = `dulabs-${idTenant}-${Date.now()}`;
    const transaccion = await crearTransaccion({
      amount_in_cents: precioCop * 100,
      customer_email,
      reference: referencia,
      payment_source_id: fuente.id,
      recurrent: true,
    });

    const proximoMes = new Date();
    proximoMes.setMonth(proximoMes.getMonth() + 1);

    const { error: dbError } = await supabase.from("dulabs_suscripciones").upsert(
      {
        id_tenant: idTenant,
        plan,
        precio_cop: precioCop,
        wompi_payment_source_id: String(fuente.id),
        wompi_customer_email: customer_email,
        estado: transaccion.status === "DECLINED" ? "vencida" : "activa",
        fecha_proximo_cobro: proximoMes.toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id_tenant" }
    );
    if (dbError) throw new Error(`Error guardando suscripción: ${dbError.message}`);

    await supabase.from("dulabs_pagos").insert({
      id_tenant: idTenant,
      wompi_transaction_id: transaccion.id,
      monto_cop: precioCop,
      estado: transaccion.status,
    });

    return Response.json({ success: true, estado_transaccion: transaccion.status });
  } catch (err) {
    console.error("[pagos/suscribir] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
