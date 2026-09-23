/**
 * Servicio PRESENCIAL (walk-in) -- la clienta llegó al salón sin reserva y la administradora registra el servicio que
 * se le hizo: del catálogo o escrito a mano, con el valor real cobrado, quién lo hizo y el nombre de la clienta
 * (WhatsApp opcional).
 *
 * Se guarda como una cita YA COMPLETADA en dulabs_citas_especialista -- la misma tabla que usa Contabilidad
 * (lib/contabilidad/consultas.ts solo suma citas completadas) y comisiones, así que el ingreso aparece ahí sin ningún
 * cambio. El valor cobrado va en `precio_total` (la columna que Contabilidad ya prioriza sobre el precio del catálogo),
 * así un precio distinto al de lista o un servicio fuera del catálogo quedan con su valor real.
 *
 * No bloquea la agenda (`bloquea_horario = false`, y una cita completada tampoco entra en el EXCLUDE de solapes) ni
 * crea eventos en Google Calendar: es un registro de algo que ya pasó, no una reserva. Nunca envía mensajes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizarTelefono } from "@/lib/marketplace-store";
import { recordarNombreCliente } from "@/lib/clientes-conocidos";

export const PRECIO_MAXIMO = 50_000_000;
export const DURACION_POR_DEFECTO_MIN = 60;
/** Un servicio presencial ya ocurrió (o está ocurriendo): se aceptan hasta 15 min en el futuro por desfase de reloj, y hasta 60 días atrás. */
const TOLERANCIA_FUTURO_MS = 15 * 60 * 1000;
const MAXIMO_PASADO_MS = 60 * 24 * 60 * 60 * 1000;

export type BodyServicioPresencial = {
  servicioId?: unknown;
  servicioNombre?: unknown;
  precio?: unknown;
  especialistaId?: unknown;
  nombreCliente?: unknown;
  telefonoCliente?: unknown;
  guardarCliente?: unknown;
  realizadoEn?: unknown;
  idempotencyKey?: unknown;
};

export type DatosServicioPresencial = {
  servicioId: string | null;
  servicioNombre: string | null;
  precio: number | null;
  especialistaId: number;
  nombreCliente: string;
  telefonoCliente: string | null;
  guardarCliente: boolean;
  realizadoEn: Date;
  idempotencyKey: string;
};

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Validación pura del cuerpo (sin base de datos). */
export function validarServicioPresencial(body: BodyServicioPresencial, ahora: Date): { ok: true; datos: DatosServicioPresencial } | { ok: false; error: string } {
  const servicioId = texto(body.servicioId) || null;
  const servicioNombre = texto(body.servicioNombre) || null;
  if (!servicioId && !servicioNombre) return { ok: false, error: "Elige un servicio del catálogo o escribe cuál fue" };
  if (servicioNombre && servicioNombre.length > 120) return { ok: false, error: "El nombre del servicio es demasiado largo" };

  let precio: number | null = null;
  if (body.precio !== undefined && body.precio !== null && body.precio !== "") {
    const n = Number(body.precio);
    if (!Number.isInteger(n) || n < 0 || n > PRECIO_MAXIMO) return { ok: false, error: "El valor no es válido" };
    precio = n;
  }
  if (!servicioId && precio === null) return { ok: false, error: "Escribe el valor del servicio" };

  const especialistaId = Number(body.especialistaId);
  if (!Number.isInteger(especialistaId) || especialistaId <= 0) return { ok: false, error: "Elige quién realizó el servicio" };

  const nombreCliente = texto(body.nombreCliente);
  if (!nombreCliente) return { ok: false, error: "Escribe el nombre de la clienta" };
  if (nombreCliente.length > 120) return { ok: false, error: "El nombre de la clienta es demasiado largo" };

  let telefonoCliente: string | null = null;
  if (texto(body.telefonoCliente)) {
    const t = normalizarTelefono(texto(body.telefonoCliente));
    if (t.length < 10 || t.length > 15) return { ok: false, error: "El WhatsApp no es válido" };
    telefonoCliente = t;
  }

  let realizadoEn = ahora;
  if (texto(body.realizadoEn)) {
    const d = new Date(texto(body.realizadoEn));
    if (Number.isNaN(d.getTime())) return { ok: false, error: "La fecha u hora no es válida" };
    if (d.getTime() > ahora.getTime() + TOLERANCIA_FUTURO_MS) return { ok: false, error: "Un servicio presencial no puede quedar en el futuro -- para eso usa Nueva cita" };
    if (d.getTime() < ahora.getTime() - MAXIMO_PASADO_MS) return { ok: false, error: "La fecha es demasiado antigua" };
    realizadoEn = d;
  }

  const idempotencyKey = texto(body.idempotencyKey);
  if (!idempotencyKey || idempotencyKey.length > 200) return { ok: false, error: "Falta identificador de solicitud" };

  return {
    ok: true,
    datos: { servicioId, servicioNombre, precio, especialistaId, nombreCliente, telefonoCliente, guardarCliente: body.guardarCliente === true, realizadoEn, idempotencyKey },
  };
}

export type ServicioPresencialRegistrado = {
  id: number;
  servicio: string;
  precio: number | null;
  profesional: string;
  nombreCliente: string;
  inicio: string;
  clienteGuardado: boolean;
};

export type ResultadoServicioPresencial = { ok: true; registro: ServicioPresencialRegistrado } | { ok: false; status: number; error: string };

/**
 * Valida contra datos REALES del tenant (profesional activa, servicio activo del catálogo) e inserta la cita completada.
 * El precio del catálogo se usa solo si no se escribió otro; si el servicio del catálogo no tiene precio y tampoco se
 * escribió uno, se rechaza (nunca un ingreso inventado ni en $0 sin que la administradora lo diga).
 */
export async function registrarServicioPresencial(
  supabase: SupabaseClient,
  tenant: { idTenant: string; phoneNumberIdCliente: string },
  datos: DatosServicioPresencial,
): Promise<ResultadoServicioPresencial> {
  const { data: especialista } = await supabase
    .from("dulabs_especialistas")
    .select("id, nombre, activo")
    .eq("id_tenant", tenant.idTenant)
    .eq("id", datos.especialistaId)
    .maybeSingle();
  if (!especialista || especialista.activo === false) return { ok: false, status: 400, error: "Esa profesional no existe o no está activa" };

  let nombreServicio = datos.servicioNombre;
  let precio = datos.precio;
  let duracionMin = DURACION_POR_DEFECTO_MIN;
  if (datos.servicioId) {
    const { data: servicio } = await supabase
      .from("dulabs_servicios")
      .select("id, nombre, precio, duracion_min, activo")
      .eq("id_tenant", tenant.idTenant)
      .eq("id", datos.servicioId)
      .maybeSingle();
    if (!servicio || servicio.activo === false) return { ok: false, status: 400, error: "Ese servicio no existe o no está activo" };
    nombreServicio = servicio.nombre as string;
    if (precio === null) precio = typeof servicio.precio === "number" && servicio.precio > 0 ? servicio.precio : null;
    if (typeof servicio.duracion_min === "number" && servicio.duracion_min > 0) duracionMin = servicio.duracion_min;
  }
  if (precio === null) return { ok: false, status: 400, error: "Ese servicio no tiene precio en el catálogo -- escribe el valor cobrado" };

  // WhatsApp opcional. Si ya es una clienta registrada con ese número, NUNCA se le cambia el nombre guardado; si es
  // nueva y la administradora pidió guardarla, queda registrada con la MISMA identidad que usa el bot de WhatsApp.
  let clienteGuardado = false;
  let nombreCliente = datos.nombreCliente;
  if (datos.telefonoCliente) {
    const { data: existente } = await supabase
      .from("dulabs_clientes_conocidos")
      .select("nombre")
      .eq("id_tenant", tenant.idTenant)
      .eq("phone_number_id", tenant.phoneNumberIdCliente)
      .eq("telefono_cliente", datos.telefonoCliente)
      .maybeSingle();
    if (existente) {
      nombreCliente = (existente.nombre as string) || nombreCliente;
      clienteGuardado = true;
    } else if (datos.guardarCliente) {
      await recordarNombreCliente(supabase, {
        idTenant: tenant.idTenant,
        phoneNumberId: tenant.phoneNumberIdCliente,
        telefonoCliente: datos.telefonoCliente,
        nombre: nombreCliente,
      });
      clienteGuardado = true;
    }
  }

  const inicio = datos.realizadoEn;
  const fin = new Date(inicio.getTime() + duracionMin * 60 * 1000);
  const { data: cita, error } = await supabase
    .from("dulabs_citas_especialista")
    .insert({
      especialista_id: datos.especialistaId,
      id_tenant: tenant.idTenant,
      phone_number_id: tenant.phoneNumberIdCliente,
      telefono_cliente: datos.telefonoCliente,
      nombre_cliente: nombreCliente,
      servicio: nombreServicio,
      servicio_id: datos.servicioId,
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      estado: "completada",
      origen: "presencial",
      precio_total: precio,
      bloquea_horario: false,
    })
    .select("id, inicio")
    .single();
  if (error || !cita) {
    // Error TÉCNICO: se lanza (no se devuelve) para que la idempotencia libere la clave y un reintento pueda
    // registrarlo de verdad -- un resultado devuelto quedaría cacheado como fallo para siempre.
    throw new Error(`servicio_presencial_insert: ${error?.message ?? "sin fila"}`);
  }

  return {
    ok: true,
    registro: {
      id: cita.id as number,
      servicio: nombreServicio!,
      precio,
      profesional: especialista.nombre as string,
      nombreCliente,
      inicio: cita.inicio as string,
      clienteGuardado,
    },
  };
}
