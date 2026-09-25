/**
 * Publi Bordados — manejador del módulo para la acción genérica `registrar_en_modulo`.
 *
 * El Flow (lib/flows/publibordados.flow.ts) lo invoca justo antes del traspaso a la asesora con
 * los datos ya validados. Toda la lógica de datos vive en la BD (dulabs_pb_registrar_solicitud):
 * reutiliza el contacto (cliente), crea UNA solicitud por ejecución real del Flow (idempotente) y
 * guarda la trazabilidad. Aquí solo se valida la forma y se traducen los errores.
 */
import type { ManejadorRegistroModulo, RegistroModuloResultado } from "@/lib/flow/registro-modulo";

/** Errores de negocio/seguridad (reintentar no cambia nada). */
const RECHAZOS_DEFINITIVOS = new Set(["pb_numero_ajeno", "pb_contacto_ajeno", "pb_ejecucion_inexistente"]);

export const registrarSolicitudPublibordados: ManejadorRegistroModulo = async (input) => {
  const { tipo_cliente, nombre, nombre_empresa, producto, cantidad } = input.campos;
  if (typeof tipo_cliente !== "string" || typeof nombre !== "string" || typeof producto !== "string" || (typeof cantidad !== "string" && typeof cantidad !== "number")) {
    return { ok: false, motivo: "datos_incompletos", reintentable: false };
  }
  const { data, error } = await input.supabase.rpc("dulabs_pb_registrar_solicitud", {
    p_tenant: input.tenantId,
    p_phone_number_id: input.phoneNumberId,
    p_telefono: input.telefonoCliente,
    p_flow_execution_id: input.flowExecutionId,
    p_datos: {
      tipo_cliente,
      nombre,
      nombre_empresa: typeof nombre_empresa === "string" ? nombre_empresa : "",
      producto,
      cantidad: String(cantidad),
    },
  });
  if (error) return traducirError(error);
  const fila = (Array.isArray(data) ? data[0] : data) as { solicitud_id?: number; creada?: boolean } | null;
  if (!fila?.solicitud_id) return { ok: false, motivo: "sin_resultado", reintentable: true };
  return { ok: true, registroId: fila.solicitud_id, creado: Boolean(fila.creada) };
};

function traducirError(error: { code?: string; message?: string }): RegistroModuloResultado {
  const mensaje = error.message ?? "";
  if (RECHAZOS_DEFINITIVOS.has(mensaje)) return { ok: false, motivo: mensaje, reintentable: false };
  // Datos que la BD rechaza (check / not null): nunca se guardan a medias.
  if (error.code === "23514" || error.code === "23502") return { ok: false, motivo: "datos_invalidos", reintentable: false };
  // Migración sin aplicar: la función o la tabla no existen.
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") return { ok: false, motivo: "migracion_pendiente", reintentable: false };
  return { ok: false, motivo: "error_bd", reintentable: true };
}
