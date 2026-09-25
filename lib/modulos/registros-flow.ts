/**
 * Registro de manejadores de la acción genérica `registrar_en_modulo`, por módulo del tenant
 * (mismo mecanismo que MODULOS en lib/tenant-modulos.ts: agregar un módulo = agregar su línea).
 * El motor solo consulta este mapa; cada manejador vive en el espacio de su negocio.
 */
import type { ManejadorRegistroModulo } from "@/lib/flow/registro-modulo";
import type { ModuloId } from "@/lib/tenant-modulos";
import { registrarSolicitudPublibordados } from "@/lib/publibordados/solicitudes/registrar";

export const REGISTROS_FLOW_POR_MODULO: Readonly<Partial<Record<ModuloId, ManejadorRegistroModulo>>> = {
  publibordados_clientes: registrarSolicitudPublibordados,
};
