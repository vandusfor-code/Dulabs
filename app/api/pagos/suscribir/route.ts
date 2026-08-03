import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { crearFuentePago, crearTransaccion, resolverEstadoPago } from "@/lib/wompi";
import { PLANES, type PlanId } from "@/lib/planes";
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
  if (!(plan in PLANES)) {
    return Response.json({ error: "Plan inválido" }, { status: 400 });
  }
  const planDef = PLANES[plan as PlanId];
  if (planDef.precioCop === null) {
    return Response.json({ error: "El plan Enterprise se activa por cotización, contacta a soporte" }, { status: 400 });
  }
  const precioCop = planDef.precioCop;

  const proximoMes = new Date();
  proximoMes.setMonth(proximoMes.getMonth() + 1);
  const fechaProximoCobro = proximoMes.toISOString().slice(0, 10);

  // Reserva atómica ANTES de cobrar: si el tenant ya tiene una suscripción
  // activa o una reserva en curso (otra pestaña, un reintento de red), esto
  // devuelve 0 filas y abortamos sin haber llamado a Wompi — cierra la
  // ventana de doble cobro real que tenía esta ruta.
  const { data: reserva, error: reservaError } = await supabase.rpc("dulabs_reservar_suscripcion", {
    p_tenant: idTenant,
    p_plan: plan,
    p_precio_cop: precioCop,
    p_fecha_proximo_cobro: fechaProximoCobro,
  });
  if (reservaError) {
    console.error("[pagos/suscribir] error reservando suscripción:", reservaError.message);
    return Response.json({ error: "No se pudo procesar la suscripción, intenta de nuevo" }, { status: 500 });
  }
  if (!reserva || reserva.length === 0) {
    return Response.json(
      { error: "Ya tienes una suscripción activa o un pago en proceso. Espera un momento y vuelve a intentar." },
      { status: 409 }
    );
  }

  // Se resuelve dentro del try y se lee en el catch para saber si la
  // liberación de la reserva está pisando un cobro que Wompi ya aprobó.
  let transaccion: Awaited<ReturnType<typeof crearTransaccion>> | null = null;

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
    transaccion = await crearTransaccion({
      amount_in_cents: precioCop * 100,
      customer_email,
      reference: referencia,
      payment_source_id: fuente.id,
      recurrent: true,
    });

    // Confirma la fila ya reservada (no un upsert nuevo: la fila ya existe
    // en pendiente_pago desde la reserva de arriba). Solo APPROVED activa de
    // inmediato; PENDING (challenge 3DS en curso, confirmado real en
    // producción — ver dulabs_pagos id=1) deja la fila en pendiente_pago,
    // igual que la dejó la reserva, hasta que el webhook confirme el
    // resultado final; DECLINED/ERROR/VOIDED marcan vencida.
    const estadoFinal = resolverEstadoPago(transaccion.status);
    const { error: dbError } = await supabase
      .from("dulabs_suscripciones")
      .update({
        wompi_payment_source_id: String(fuente.id),
        wompi_customer_email: customer_email,
        estado: estadoFinal,
        updated_at: new Date().toISOString(),
      })
      .eq("id_tenant", idTenant);
    if (dbError) throw new Error(`Error guardando suscripción: ${dbError.message}`);

    const { error: pagoInsertError } = await supabase.from("dulabs_pagos").insert({
      id_tenant: idTenant,
      wompi_transaction_id: transaccion.id,
      monto_cop: precioCop,
      estado: transaccion.status,
      tipo: "suscripcion",
    });
    if (pagoInsertError) {
      console.error(
        `[pagos/suscribir] ALERTA: se cobró a Wompi (transacción ${transaccion.id}, tenant ${idTenant}, $${precioCop} COP) pero no se pudo registrar en dulabs_pagos — revisar si falta correr la migración de tipo/marketplace_activacion_id:`,
        pagoInsertError.message
      );
    }

    if (estadoFinal === "pendiente_pago") {
      console.log(
        `[pagos/suscribir] transacción ${transaccion.id} quedó PENDING (tenant ${idTenant}) — suscripción en pendiente_pago hasta que el webhook de Wompi confirme el resultado final.`
      );
    }

    return Response.json({ success: true, estado_transaccion: transaccion.status });
  } catch (err) {
    // Libera la reserva para que el tenant pueda reintentar — si se queda en
    // pendiente_pago, dulabs_reservar_suscripcion bloquearía todos los
    // intentos futuros de este tenant. El .eq("estado","pendiente_pago")
    // evita pisar un estado que ya haya quedado resuelto por otro camino
    // (p. ej. si el UPDATE de arriba sí llegó a aplicar pese al error).
    //
    // Caso raro pero real que esto NO resuelve, solo alerta: si Wompi dejó
    // el cobro en un estado que NO es rechazo (aprobado, o pendiente de
    // confirmación real vía 3DS) y el UPDATE que debía guardar eso falló,
    // esta liberación marca la fila "vencida" — el tenant queda viendo su
    // suscripción como no pagada pese a que Wompi sí procesó (o podría
    // terminar procesando) el cobro. No hay forma segura de reintentar
    // automáticamente sin arriesgar un estado peor, así que se deja
    // logueado como alerta explícita para revisión manual.
    const estadoAlCaer = transaccion ? resolverEstadoPago(transaccion.status) : null;
    if (estadoAlCaer === "activa" || estadoAlCaer === "pendiente_pago") {
      console.error(
        `[pagos/suscribir] ALERTA: transacción ${transaccion!.id} quedó en estado Wompi "${transaccion!.status}" (tenant ${idTenant}, $${precioCop} COP) pero falló el paso posterior — la reserva se libera a 'vencida' y requiere arreglo manual:`,
        err instanceof Error ? err.message : err
      );
    }
    await supabase
      .from("dulabs_suscripciones")
      .update({ estado: "vencida", updated_at: new Date().toISOString() })
      .eq("id_tenant", idTenant)
      .eq("estado", "pendiente_pago");
    console.error("[pagos/suscribir] error:", err instanceof Error ? err.message : err);
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
