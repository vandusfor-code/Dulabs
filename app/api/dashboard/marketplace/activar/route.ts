import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { crearTransaccion } from "@/lib/wompi";
import { cargarLibroExcel, TAMANO_MAXIMO_BYTES } from "@/lib/archivo-texto";
import { parseConfigAgente } from "@/lib/agente-config";
import { agentePorSlug, precioMarketplace, type TipoPlanMarketplace } from "@/lib/marketplace";

export const runtime = "nodejs";
export const maxDuration = 60;

// Activa un agente del Marketplace en un número del tenant: cobra el plan
// (recurrente o 1 mes) reutilizando la fuente de pago de Wompi que ya tiene
// el tenant de su suscripción, lee la plantilla de configuración (número
// admin + info del negocio), crea la activación y la "enciende" en el número
// (marketplace_activacion_id) sin tocar su config propia.
//
// Multipart: campos slug, phone_number_id, tipo_plan + archivo "config".
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

    const supabase = supabaseAdmin();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return Response.json({ error: "Sesión inválida" }, { status: 401 });
    const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
    if (!requireRol(miembro, ["admin"])) {
      return Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 });
    }

    const form = await request.formData();
    const slug = String(form.get("slug") ?? "");
    const phoneNumberId = String(form.get("phone_number_id") ?? "");
    const tipoPlan = String(form.get("tipo_plan") ?? "") as TipoPlanMarketplace;
    const archivo = form.get("config");

    const agente = agentePorSlug(slug);
    if (!agente) return Response.json({ error: "Agente no encontrado" }, { status: 404 });
    if (tipoPlan !== "recurrente" && tipoPlan !== "mes") {
      return Response.json({ error: "Plan de pago inválido" }, { status: 400 });
    }
    if (!phoneNumberId) return Response.json({ error: "Falta el número de WhatsApp" }, { status: 400 });
    if (!(archivo instanceof File) || archivo.size === 0) {
      return Response.json({ error: "Falta la plantilla de configuración. Descárgala, llénala y súbela." }, { status: 400 });
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return Response.json({ error: "El archivo supera el límite de 4 MB" }, { status: 400 });
    }

    // El número debe ser del tenant y no tener ya un agente del marketplace activo.
    const { data: cliente } = await supabase
      .from("dulabs_clientes_config")
      .select("id, phone_number_id, marketplace_activacion_id")
      .eq("phone_number_id", phoneNumberId)
      .eq("id_tenant", miembro.tenantId)
      .maybeSingle();
    if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });
    if (cliente.marketplace_activacion_id) {
      return Response.json(
        { error: "Este número ya tiene un agente del marketplace activo. Desactívalo antes de activar otro." },
        { status: 400 }
      );
    }

    // Se cobra reutilizando la fuente de pago de la suscripción del tenant
    // (ya la tiene de su plan) — no volvemos a pedir la tarjeta.
    const { data: suscripcion } = await supabase
      .from("dulabs_suscripciones")
      .select("wompi_payment_source_id, wompi_customer_email")
      .eq("id_tenant", miembro.tenantId)
      .maybeSingle();
    if (!suscripcion?.wompi_payment_source_id || !suscripcion.wompi_customer_email) {
      return Response.json(
        { error: "Necesitas un método de pago registrado. Activa o actualiza tu plan primero y vuelve a intentar." },
        { status: 400 }
      );
    }

    // Configuración del negocio (número admin + texto para base de conocimiento).
    const buffer = Buffer.from(await archivo.arrayBuffer());
    const libro = await cargarLibroExcel(archivo.name, buffer);
    if (!libro) {
      return Response.json({ error: "Sube la plantilla oficial en formato .xlsx (columnas Campo / Valor)." }, { status: 400 });
    }
    const config = parseConfigAgente(libro);
    if (!config) {
      return Response.json(
        { error: "No pudimos leer la plantilla. Descarga la plantilla oficial y llénala sin cambiar las columnas Campo / Valor." },
        { status: 400 }
      );
    }

    const precio = precioMarketplace(tipoPlan);

    // Cobro en Wompi. recurrent:true reutiliza la fuente de pago guardada.
    const referencia = `dulabs-mkt-${miembro.tenantId}-${Date.now()}`;
    const transaccion = await crearTransaccion({
      amount_in_cents: precio * 100,
      customer_email: suscripcion.wompi_customer_email,
      reference: referencia,
      payment_source_id: Number(suscripcion.wompi_payment_source_id),
      recurrent: true,
    });
    if (transaccion.status === "DECLINED" || transaccion.status === "ERROR" || transaccion.status === "VOIDED") {
      return Response.json({ error: `El pago no se pudo procesar (estado: ${transaccion.status}).` }, { status: 402 });
    }

    await supabase.from("dulabs_pagos").insert({
      id_tenant: miembro.tenantId,
      wompi_transaction_id: transaccion.id,
      monto_cop: precio,
      estado: transaccion.status,
    });

    // Fechas: recurrente -> próximo cobro en 1 mes; mes -> vence en 1 mes.
    const enUnMes = new Date();
    enUnMes.setMonth(enUnMes.getMonth() + 1);
    const fecha = enUnMes.toISOString().slice(0, 10);

    const { data: activacion, error: insertError } = await supabase
      .from("dulabs_marketplace_activaciones")
      .insert({
        id_tenant: miembro.tenantId,
        phone_number_id: phoneNumberId,
        agente_slug: slug,
        tipo_plan: tipoPlan,
        estado: "activa",
        precio_cop: precio,
        fecha_proximo_cobro: tipoPlan === "recurrente" ? fecha : null,
        vence_at: tipoPlan === "mes" ? fecha : null,
        numero_admin: config.numeroAdmin,
        nombre_admin: config.nombreAdmin,
        config_texto: config.textoNegocio,
        config_nombre_archivo: archivo.name,
        recursos_disponibles: config.recursosDisponibles,
        duracion_estandar_min: config.duracionEstandarMin,
        wompi_payment_source_id: String(suscripcion.wompi_payment_source_id),
        wompi_customer_email: suscripcion.wompi_customer_email,
      })
      .select("id, fecha_proximo_cobro, vence_at, tipo_plan")
      .single();
    if (insertError) {
      return Response.json({ error: `No se pudo activar: ${insertError.message}` }, { status: 503 });
    }

    // Enciende el agente en el número (sombrea la config propia, no la borra).
    const { error: updateError } = await supabase
      .from("dulabs_clientes_config")
      .update({ marketplace_activacion_id: activacion.id })
      .eq("id", cliente.id);
    if (updateError) {
      return Response.json({ error: `No se pudo activar en el número: ${updateError.message}` }, { status: 503 });
    }

    return Response.json({ success: true, activacion });
  } catch (err) {
    console.error("[marketplace/activar] error inesperado:", err instanceof Error ? err.stack ?? err.message : err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Error inesperado activando el agente" },
      { status: 500 }
    );
  }
}
