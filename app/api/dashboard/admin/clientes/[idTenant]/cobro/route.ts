import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";
import { enmascararTelefono, modoCobros } from "@/lib/cobros/procesar-cobros-manuales";
import { olvidarSuspensiones } from "@/lib/cobros/suspension";
import { normalizarTelefono } from "@/lib/marketplace-store";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { WHATSAPP_VENTAS_NUMERO } from "@/lib/site-contact";

export const runtime = "nodejs";

// Cobros manuales (Panel de Operaciones) -- ver, configurar y registrar el pago de un cliente que paga FUERA de Wompi. La lógica del cobro diario vive en lib/cobros; esta ruta solo
// muestra el estado y ejecuta las tres acciones del operador. Igual que el resto del Panel: autorizada con verificarAccesoAdminDulabs, auditada y con límite de tasa.
// El PRECIO nunca se cambia desde acá (decisión de seguridad de F15.2: el body no puede fijar montos; el precio sale del plan o de precio_negociado_cop). `monto_cop` solo deja
// registrar lo que de verdad se recibió en un pago.

const CODIGOS_MIGRACION_PENDIENTE = new Set(["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"]);
const ISO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(texto: unknown): texto is string {
  if (typeof texto !== "string" || !ISO_FECHA.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

type FilaSuscripcion = {
  plan: string;
  precio_cop: number;
  estado: string;
  cortesia: boolean;
  wompi_payment_source_id: string | null;
  fecha_proximo_cobro: string;
  dia_cobro: number | null;
  telefono_cobro: string | null;
  nombre_cobro: string | null;
  suspendida_por_pago_at: string | null;
};

const COLUMNAS = "plan, precio_cop, estado, cortesia, wompi_payment_source_id, fecha_proximo_cobro, dia_cobro, telefono_cobro, nombre_cobro, suspendida_por_pago_at";

function motivoQueNoAplica(s: FilaSuscripcion | null): "sin_suscripcion" | "cortesia" | "wompi" | "no_activa" | null {
  if (!s) return "sin_suscripcion";
  if (s.cortesia) return "cortesia";
  if (s.wompi_payment_source_id) return "wompi";
  if (s.estado !== "activa") return "no_activa";
  return null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;
  const modo = modoCobros(process.env.COBROS_MANUALES_MODO);

  const { data, error } = await supabase.from("dulabs_suscripciones").select(COLUMNAS).eq("id_tenant", idTenant).maybeSingle();
  if (error) {
    if (CODIGOS_MIGRACION_PENDIENTE.has(error.code ?? "")) return Response.json({ migracionPendiente: true, modo });
    return Response.json({ error: error.message }, { status: 500 });
  }
  const sus = (data as FilaSuscripcion | null) ?? null;

  const { data: ciclos, error: errorCiclos } = await supabase
    .from("dulabs_cobros_ciclos")
    .select("fecha_cobro, monto_cop, estado, intentos, suspendido_at, recordatorio_enviado_at, ultimo_error, pagado_at, registrado_por, nota")
    .eq("id_tenant", idTenant)
    .order("fecha_cobro", { ascending: false })
    .limit(12);
  if (errorCiclos && CODIGOS_MIGRACION_PENDIENTE.has(errorCiclos.code ?? "")) return Response.json({ migracionPendiente: true, modo });

  return Response.json({
    modo,
    aplica: motivoQueNoAplica(sus) === null,
    motivoNoAplica: motivoQueNoAplica(sus),
    suscripcion: sus && {
      plan: sus.plan,
      precioCop: sus.precio_cop,
      fechaProximoCobro: String(sus.fecha_proximo_cobro).slice(0, 10),
      diaCobro: sus.dia_cobro,
      telefonoCobro: sus.telefono_cobro,
      nombreCobro: sus.nombre_cobro,
      suspendidaPorPagoAt: sus.suspendida_por_pago_at,
    },
    ciclos: (ciclos ?? []).map((c) => ({
      fechaCobro: String(c.fecha_cobro).slice(0, 10),
      montoCop: c.monto_cop,
      estado: c.estado,
      intentos: c.intentos,
      suspendidoAt: c.suspendido_at,
      recordatorioEnviadoAt: c.recordatorio_enviado_at,
      ultimoError: c.ultimo_error,
      pagadoAt: c.pagado_at,
      registradoPor: c.registrado_por,
      nota: c.nota,
    })),
  });
}

type Body = {
  accion?: "configurar" | "registrar_pago" | "levantar_suspension";
  telefono_cobro?: string | null;
  nombre_cobro?: string | null;
  dia_cobro?: number | null;
  fecha_proximo_cobro?: string;
  fecha_cobro?: string;
  monto_cop?: number | null;
  nota?: string | null;
};

/** Errores de dulabs_cobro_registrar_pago → respuesta HTTP clara para el operador. */
const ERRORES_PAGO: Record<string, { status: number; error: string }> = {
  cobro_sin_suscripcion: { status: 404, error: "Este cliente no tiene suscripción." },
  cobro_suscripcion_no_activa: { status: 409, error: "La suscripción no está activa (vencida, cancelada o con pago pendiente)." },
  cobro_es_cortesia: { status: 400, error: "Este cliente está en cortesía: no tiene cobro que registrar." },
  cobro_no_es_manual: { status: 400, error: "Este cliente paga con tarjeta por Wompi: su pago se registra solo." },
  cobro_ciclo_desactualizado: { status: 409, error: "La fecha de cobro cambió mientras tenías la pantalla abierta (¿ya se registró este pago?). Recarga la página." },
  cobro_ciclo_ya_pagado: { status: 409, error: "Ese ciclo ya tiene un pago registrado." },
  cobro_monto_invalido: { status: 400, error: "El monto debe ser mayor que cero." },
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;
  const operadorEmail = (await supabase.auth.admin.getUserById(acceso.miembro.userId)).data.user?.email ?? null;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "admin_cobro", tenantId: acceso.miembro.userId, categoria: "escritura" });
  if (limite) return limite;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.accion === "configurar") return configurar(body, idTenant, supabase, acceso.miembro, operadorEmail);
  if (body.accion === "registrar_pago") return registrarPago(body, idTenant, supabase, acceso.miembro, operadorEmail);
  if (body.accion === "levantar_suspension") return levantarSuspension(idTenant, supabase, acceso.miembro, operadorEmail);
  return Response.json({ error: "Acción desconocida (configurar | registrar_pago | levantar_suspension)" }, { status: 400 });
}

type Contexto = Awaited<ReturnType<typeof verificarAccesoAdminDulabs>>;
type Ok = Extract<Contexto, { ok: true }>;

async function configurar(body: Body, idTenant: string, supabase: Ok["supabase"], miembro: Ok["miembro"], operadorEmail: string | null): Promise<Response> {
  const cambios: Record<string, unknown> = {};

  if (body.telefono_cobro !== undefined) {
    if (body.telefono_cobro === null || String(body.telefono_cobro).trim() === "") {
      cambios.telefono_cobro = null;
    } else {
      const telefono = normalizarTelefono(String(body.telefono_cobro));
      if (!/^\d{10,15}$/.test(telefono)) return Response.json({ error: "El teléfono de cobro debe tener entre 10 y 15 dígitos con indicativo (ej. 573001234567)." }, { status: 400 });
      if (telefono === WHATSAPP_VENTAS_NUMERO) return Response.json({ error: "Ese es el número de Dulabs (el que ENVÍA el recordatorio): pon el WhatsApp de quien paga." }, { status: 400 });
      cambios.telefono_cobro = telefono;
    }
  }
  if (body.nombre_cobro !== undefined) {
    const nombre = body.nombre_cobro === null ? "" : String(body.nombre_cobro).replace(/\s+/g, " ").trim();
    if (nombre.length > 60) return Response.json({ error: "El nombre del saludo admite hasta 60 caracteres." }, { status: 400 });
    cambios.nombre_cobro = nombre === "" ? null : nombre;
  }
  if (body.dia_cobro !== undefined) {
    if (body.dia_cobro === null) cambios.dia_cobro = null;
    else if (!Number.isInteger(body.dia_cobro) || body.dia_cobro < 1 || body.dia_cobro > 31) return Response.json({ error: "El día de cobro va de 1 a 31." }, { status: 400 });
    else cambios.dia_cobro = body.dia_cobro;
  }
  if (body.fecha_proximo_cobro !== undefined) {
    if (!fechaValida(body.fecha_proximo_cobro)) return Response.json({ error: "La fecha de cobro debe ser una fecha real en formato AAAA-MM-DD." }, { status: 400 });
    cambios.fecha_proximo_cobro = body.fecha_proximo_cobro;
  }
  if (Object.keys(cambios).length === 0) return Response.json({ error: "No hay nada que cambiar." }, { status: 400 });

  const { data: actual, error: errorLectura } = await supabase.from("dulabs_suscripciones").select(COLUMNAS).eq("id_tenant", idTenant).maybeSingle();
  if (errorLectura) {
    if (CODIGOS_MIGRACION_PENDIENTE.has(errorLectura.code ?? "")) return Response.json({ error: "Falta correr la migración de cobros manuales." }, { status: 503 });
    return Response.json({ error: errorLectura.message }, { status: 500 });
  }
  const sus = (actual as FilaSuscripcion | null) ?? null;
  if (!sus) return Response.json({ error: "Este cliente no tiene suscripción." }, { status: 404 });
  // La fecha de cobro de una suscripción con tarjeta la maneja Wompi; las de cortesía no cobran.
  if (cambios.fecha_proximo_cobro !== undefined && (sus.wompi_payment_source_id || sus.cortesia)) {
    return Response.json({ error: "La fecha de cobro solo se edita en suscripciones manuales (no en Wompi ni en cortesía)." }, { status: 400 });
  }

  const { error } = await supabase.from("dulabs_suscripciones").update({ ...cambios, updated_at: new Date().toISOString() }).eq("id_tenant", idTenant);
  const metadata = { ...cambios, ...(typeof cambios.telefono_cobro === "string" ? { telefono_cobro: enmascararTelefono(cambios.telefono_cobro) } : {}) };
  if (error) {
    await registrarAuditoriaAdmin(supabase, { operador: miembro, operadorEmail, accion: "COBRO_CONFIGURAR", idTenant, resultado: "error", motivo: error.message, metadata });
    return Response.json({ error: error.message }, { status: 500 });
  }
  await registrarAuditoriaAdmin(supabase, { operador: miembro, operadorEmail, accion: "COBRO_CONFIGURAR", idTenant, resultado: "ok", metadata });
  return Response.json({ success: true });
}

async function registrarPago(body: Body, idTenant: string, supabase: Ok["supabase"], miembro: Ok["miembro"], operadorEmail: string | null): Promise<Response> {
  if (!fechaValida(body.fecha_cobro)) return Response.json({ error: "Falta la fecha de cobro que se está pagando (AAAA-MM-DD)." }, { status: 400 });
  if (body.monto_cop !== undefined && body.monto_cop !== null && (!Number.isInteger(body.monto_cop) || body.monto_cop <= 0)) {
    return Response.json({ error: "El monto debe ser un número entero mayor que cero." }, { status: 400 });
  }
  const nota = body.nota ? String(body.nota).trim().slice(0, 300) : null;

  const { data, error } = await supabase.rpc("dulabs_cobro_registrar_pago", {
    p_tenant: idTenant,
    p_fecha_cobro: body.fecha_cobro,
    p_monto_cop: body.monto_cop ?? null,
    p_operador: operadorEmail,
    p_nota: nota,
  });
  const metadata = { fecha_cobro: body.fecha_cobro, monto_cop: body.monto_cop ?? null };
  if (error) {
    if (CODIGOS_MIGRACION_PENDIENTE.has(error.code ?? "")) return Response.json({ error: "Falta correr la migración de cobros manuales." }, { status: 503 });
    const conocido = ERRORES_PAGO[error.message];
    await registrarAuditoriaAdmin(supabase, { operador: miembro, operadorEmail, accion: "COBRO_REGISTRAR_PAGO", idTenant, resultado: "error", motivo: conocido?.error ?? error.message, metadata });
    if (conocido) return Response.json({ error: conocido.error }, { status: conocido.status });
    return Response.json({ error: error.message }, { status: 500 });
  }
  olvidarSuspensiones(idTenant);
  const fila = (Array.isArray(data) ? data[0] : data) as { fecha_pagada: string; proximo_cobro: string; monto_registrado: number; estaba_suspendida: boolean } | null;
  await registrarAuditoriaAdmin(supabase, { operador: miembro, operadorEmail, accion: "COBRO_REGISTRAR_PAGO", idTenant, resultado: "ok", motivo: nota, metadata: { ...metadata, proximo_cobro: fila?.proximo_cobro } });
  return Response.json({
    success: true,
    fechaPagada: fila?.fecha_pagada ?? body.fecha_cobro,
    proximoCobro: fila?.proximo_cobro ?? null,
    montoRegistrado: fila?.monto_registrado ?? null,
    reactivado: Boolean(fila?.estaba_suspendida),
  });
}

async function levantarSuspension(idTenant: string, supabase: Ok["supabase"], miembro: Ok["miembro"], operadorEmail: string | null): Promise<Response> {
  const { data, error } = await supabase
    .from("dulabs_suscripciones")
    .update({ suspendida_por_pago_at: null, updated_at: new Date().toISOString() })
    .eq("id_tenant", idTenant)
    .not("suspendida_por_pago_at", "is", null)
    .select("fecha_proximo_cobro");
  if (error) {
    if (CODIGOS_MIGRACION_PENDIENTE.has(error.code ?? "")) return Response.json({ error: "Falta correr la migración de cobros manuales." }, { status: 503 });
    await registrarAuditoriaAdmin(supabase, { operador: miembro, operadorEmail, accion: "COBRO_LEVANTAR_SUSPENSION", idTenant, resultado: "error", motivo: error.message });
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) return Response.json({ error: "Este cliente no estaba suspendido por falta de pago." }, { status: 409 });

  // El ciclo en curso deja de reintentarse: si no, el cron lo volvería a suspender mañana y esta decisión del operador no valdría nada.
  // (Un ciclo ya «enviado» o «pagado» el cron no lo toca.) El siguiente ciclo, tras registrar el pago, sigue su curso normal.
  const fechaCiclo = String((data[0] as { fecha_proximo_cobro: string }).fecha_proximo_cobro).slice(0, 10);
  await supabase
    .from("dulabs_cobros_ciclos")
    .update({ estado: "omitido", updated_at: new Date().toISOString() })
    .eq("id_tenant", idTenant)
    .eq("fecha_cobro", fechaCiclo)
    .in("estado", ["pendiente", "fallido"]);
  olvidarSuspensiones(idTenant);
  await registrarAuditoriaAdmin(supabase, { operador: miembro, operadorEmail, accion: "COBRO_LEVANTAR_SUSPENSION", idTenant, resultado: "ok", metadata: { fecha_cobro: fechaCiclo } });
  return Response.json({ success: true });
}
