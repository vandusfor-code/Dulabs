import type { SupabaseClient } from "@supabase/supabase-js";

// FASE F15 (Operations Center, autorizado) -- alertas derivadas EN VIVO de
// señales reales ya existentes (Fase 17 del pedido). Nunca se almacena la
// alerta en sí -- solo su estado (nueva/vista/resuelta) en
// dulabs_alertas_estado, identificado por una `clave` determinística, para
// no construir un sistema de eventos paralelo (Fase 26: "no sobreconstruir").
export type TipoAlerta =
  | "pago_fallido"
  | "pago_pendiente"
  | "suscripcion_vencida"
  | "whatsapp_desconectado"
  | "bot_pausado"
  | "flow_con_errores";

export type Alerta = {
  clave: string;
  tipo: TipoAlerta;
  idTenant: string;
  nombre: string | null;
  recurso: string | null;
  detalle: string;
  severidad: "critica" | "advertencia";
  creadaEn: string;
  estado: "nueva" | "vista" | "resuelta";
};

export async function calcularAlertas(supabase: SupabaseClient): Promise<Alerta[]> {
  const alertas: Alerta[] = [];

  const [{ data: suscripciones }, { data: numeros }, { data: pagosFallidos }, { data: ejecucionesFallidas }] = await Promise.all([
    supabase.from("dulabs_suscripciones").select("id_tenant, estado, updated_at").in("estado", ["vencida", "pendiente_pago"]),
    supabase.from("dulabs_clientes_config").select("id_tenant, phone_number_id, nombre_negocio, ia_pausada, estado_conexion, meta_permanent_token, updated_at"),
    supabase.from("dulabs_pagos").select("id, id_tenant, estado, created_at").eq("tipo", "suscripcion").eq("estado", "DECLINED").order("created_at", { ascending: false }).limit(100),
    // dulabs_flow_executions usa "tenant_id", NO "id_tenant" -- inconsistencia
    // real de nombres entre tablas, confirmada empíricamente esta fase (a
    // diferencia de dulabs_clientes_config/dulabs_suscripciones/dulabs_pagos/
    // dulabs_fallos_ia, que sí usan "id_tenant").
    supabase.from("dulabs_flow_executions").select("tenant_id, phone_number_id, status, last_activity_at").eq("status", "failed").order("last_activity_at", { ascending: false }).limit(200),
  ]);

  const { data: usuarios } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const nombrePorTenant = new Map((usuarios?.users ?? []).map((u) => [u.id, (u.user_metadata?.nombre as string | undefined) ?? u.email ?? null]));

  for (const s of suscripciones ?? []) {
    if (s.estado === "vencida") {
      alertas.push({
        clave: `suscripcion_vencida:${s.id_tenant}`,
        tipo: "suscripcion_vencida",
        idTenant: s.id_tenant,
        nombre: nombrePorTenant.get(s.id_tenant) ?? null,
        recurso: null,
        detalle: "Suscripción vencida (pago rechazado o cobro recurrente fallido).",
        severidad: "critica",
        creadaEn: s.updated_at,
        estado: "nueva",
      });
    } else {
      alertas.push({
        clave: `pago_pendiente:${s.id_tenant}`,
        tipo: "pago_pendiente",
        idTenant: s.id_tenant,
        nombre: nombrePorTenant.get(s.id_tenant) ?? null,
        recurso: null,
        detalle: "Pago pendiente de confirmación (challenge 3DS o similar).",
        severidad: "advertencia",
        creadaEn: s.updated_at,
        estado: "nueva",
      });
    }
  }

  for (const n of numeros ?? []) {
    if (n.ia_pausada) {
      alertas.push({
        clave: `bot_pausado:${n.phone_number_id}`,
        tipo: "bot_pausado",
        idTenant: n.id_tenant,
        nombre: nombrePorTenant.get(n.id_tenant) ?? n.nombre_negocio,
        recurso: n.phone_number_id,
        detalle: `IA pausada manualmente en ${n.nombre_negocio}.`,
        severidad: "advertencia",
        creadaEn: n.updated_at,
        estado: "nueva",
      });
    }
    const desconectado = n.estado_conexion === "desconectado" || (!n.estado_conexion && !n.meta_permanent_token);
    if (desconectado) {
      alertas.push({
        clave: `whatsapp_desconectado:${n.phone_number_id}`,
        tipo: "whatsapp_desconectado",
        idTenant: n.id_tenant,
        nombre: nombrePorTenant.get(n.id_tenant) ?? n.nombre_negocio,
        recurso: n.phone_number_id,
        detalle: `WhatsApp desconectado en ${n.nombre_negocio}.`,
        severidad: "critica",
        creadaEn: n.updated_at,
        estado: "nueva",
      });
    }
  }

  for (const p of pagosFallidos ?? []) {
    alertas.push({
      clave: `pago_fallido:${p.id}`,
      tipo: "pago_fallido",
      idTenant: p.id_tenant,
      nombre: nombrePorTenant.get(p.id_tenant) ?? null,
      recurso: String(p.id),
      detalle: "Un cobro fue rechazado por Wompi.",
      severidad: "advertencia",
      creadaEn: p.created_at,
      estado: "nueva",
    });
  }

  const flowErrorPorTenant = new Map<string, { count: number; ultimaEn: string; recurso: string }>();
  for (const e of ejecucionesFallidas ?? []) {
    const actual = flowErrorPorTenant.get(e.tenant_id);
    if (!actual || e.last_activity_at > actual.ultimaEn) {
      flowErrorPorTenant.set(e.tenant_id, { count: (actual?.count ?? 0) + 1, ultimaEn: e.last_activity_at, recurso: e.phone_number_id });
    } else {
      flowErrorPorTenant.set(e.tenant_id, { ...actual, count: actual.count + 1 });
    }
  }
  for (const [idTenant, info] of flowErrorPorTenant) {
    alertas.push({
      clave: `flow_con_errores:${idTenant}`,
      tipo: "flow_con_errores",
      idTenant,
      nombre: nombrePorTenant.get(idTenant) ?? null,
      recurso: info.recurso,
      detalle: `${info.count} ejecución${info.count === 1 ? "" : "es"} de Flow con error reciente.`,
      severidad: info.count >= 3 ? "critica" : "advertencia",
      creadaEn: info.ultimaEn,
      estado: "nueva",
    });
  }

  // Estado guardado (nueva/vista/resuelta) por clave -- fail-safe si la
  // migración 20260914110000 todavía no corrió.
  const claves = alertas.map((a) => a.clave);
  if (claves.length > 0) {
    const { data: estados, error } = await supabase.from("dulabs_alertas_estado").select("clave, estado").in("clave", claves);
    if (!error) {
      const estadoPorClave = new Map((estados ?? []).map((e) => [e.clave, e.estado as Alerta["estado"]]));
      for (const a of alertas) a.estado = estadoPorClave.get(a.clave) ?? "nueva";
    }
  }

  return alertas.sort((a, b) => new Date(b.creadaEn).getTime() - new Date(a.creadaEn).getTime());
}
