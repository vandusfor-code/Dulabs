/**
 * Cobros manuales — lo que hace el cron diario con las suscripciones que pagan FUERA de Wompi.
 *
 * Para cada suscripción manual activa (no cortesía) cuya fecha de cobro ya llegó y que tiene teléfono de cobro:
 *   1. reclama el CICLO (una fila por tenant + fecha de cobro: así el aviso sale UNA sola vez aunque el cron corra dos veces);
 *   2. la marca como suspendida por pago (el bot deja de responder) con una actualización condicionada a que SIGA siendo ese ciclo: si el pago se registró mientras tanto, no se toca;
 *   3. manda la plantilla `pendiente_pago` desde el número de Dulabs y guarda el resultado; si el envío falla se reintenta al día siguiente (tope MAX_INTENTOS_AVISO);
 *   4. le cuenta al dueño lo que pasó.
 * Sin teléfono de cobro NO se suspende ni se avisa: solo se le cuenta al dueño que falta ese dato. En modo «simulacion» (por defecto) no se escribe ni se envía NADA: solo se informa qué se haría.
 *
 * Toda la entrada/salida (base, Meta, avisos) entra por `deps`: las pruebas la reemplazan y la producción la cablea en cobros-supabase.ts.
 */
import type { ResultadoRecordatorio } from "./enviar-recordatorio";

export type ModoCobros = "simulacion" | "activo";
export const MAX_INTENTOS_AVISO = 5;

/** Solo «activo» (sin importar mayúsculas ni espacios) actúa de verdad; cualquier otro valor o la ausencia de la variable es simulación. */
export function modoCobros(valor: string | undefined | null): ModoCobros {
  return valor?.trim().toLowerCase() === "activo" ? "activo" : "simulacion";
}

export interface SuscripcionVencida {
  idTenant: string;
  plan: string;
  precioCop: number;
  /** Fecha de cobro (YYYY-MM-DD) que ya llegó. */
  fechaCobro: string;
  telefonoCobro: string | null;
  nombreCobro: string | null;
  suspendida: boolean;
}

export interface CicloExistente {
  estado: "pendiente" | "enviado" | "fallido" | "pagado" | "omitido";
  intentos: number;
}

export interface DepsCobros {
  /** Hoy en Colombia (YYYY-MM-DD). */
  hoy(): string;
  /** Suscripciones manuales activas, que no son cortesía, con fecha de cobro <= hoy. */
  listarVencidas(hoy: string): Promise<SuscripcionVencida[]>;
  obtenerCiclo(idTenant: string, fechaCobro: string): Promise<CicloExistente | null>;
  /** Crea el ciclo si no existe. true = lo creó esta llamada; false = ya existía (otra corrida lo reclamó). */
  reclamarCiclo(s: SuscripcionVencida): Promise<boolean>;
  /** Marca la suspensión SOLO si la suscripción sigue en ese ciclo, activa, manual y sin suspender. true = la marcó esta llamada. */
  suspender(idTenant: string, fechaCobro: string): Promise<boolean>;
  /** El ciclo ya no aplica (cambió mientras se procesaba): se deja como omitido si seguía pendiente. */
  marcarOmitido(idTenant: string, fechaCobro: string): Promise<void>;
  nombreNegocio(s: SuscripcionVencida): Promise<string>;
  enviar(input: { telefonoE164: string; nombreNegocio: string; montoCop: number }): Promise<ResultadoRecordatorio>;
  registrarEnvio(params: { idTenant: string; fechaCobro: string; resultado: ResultadoRecordatorio; intentos: number }): Promise<void>;
  avisarDueno(texto: string): Promise<void>;
}

export type TipoAccionCobro = "avisar" | "reintentar_aviso" | "sin_telefono" | "sin_precio" | "ya_procesado" | "ya_no_aplica" | "carrera_perdida" | "error";

export interface AccionCobro {
  idTenant: string;
  fechaCobro: string;
  accion: TipoAccionCobro;
  /** true = modo simulación: no se escribió ni se envió nada. */
  simulado: boolean;
  cliente?: string;
  /** Teléfono enmascarado («…4567»). */
  telefono?: string;
  /** true = esta corrida puso la marca de suspensión. */
  suspendido?: boolean;
  resultado?: "enviado" | "fallido";
  motivo?: string;
  estadoPrevio?: string;
}

export interface ResultadoCobros {
  modo: ModoCobros;
  hoy: string;
  revisadas: number;
  acciones: AccionCobro[];
}

export function enmascararTelefono(telefono: string): string {
  const digitos = telefono.replace(/\D/g, "");
  return digitos.length >= 4 ? `…${digitos.slice(-4)}` : "…";
}

export async function procesarCobrosManuales(deps: DepsCobros, opciones: { modo: ModoCobros; maxIntentos?: number }): Promise<ResultadoCobros> {
  const { modo } = opciones;
  const maxIntentos = opciones.maxIntentos ?? MAX_INTENTOS_AVISO;
  const simulado = modo === "simulacion";
  const hoy = deps.hoy();
  const vencidas = await deps.listarVencidas(hoy);
  const acciones: AccionCobro[] = [];

  for (const s of vencidas) {
    const base = { idTenant: s.idTenant, fechaCobro: s.fechaCobro, simulado };
    try {
      if (!s.telefonoCobro) {
        acciones.push({ ...base, accion: "sin_telefono" });
        continue;
      }
      if (!(s.precioCop > 0)) {
        acciones.push({ ...base, accion: "sin_precio" });
        continue;
      }

      const ciclo = await deps.obtenerCiclo(s.idTenant, s.fechaCobro);
      // «pendiente» (reclamado pero sin terminar, p. ej. la corrida se cortó) y «fallido» con intentos disponibles se reintentan; todo lo demás ya está resuelto.
      const yaResuelto =
        ciclo !== null &&
        (ciclo.estado === "pagado" || ciclo.estado === "omitido" || ciclo.estado === "enviado" || (ciclo.estado === "fallido" && ciclo.intentos >= maxIntentos));
      if (ciclo && yaResuelto) {
        acciones.push({ ...base, accion: "ya_procesado", estadoPrevio: ciclo.estado });
        continue;
      }
      const reintento = ciclo !== null;
      const telefono = enmascararTelefono(s.telefonoCobro);

      if (simulado) {
        acciones.push({ ...base, accion: reintento ? "reintentar_aviso" : "avisar", cliente: await deps.nombreNegocio(s), telefono });
        continue;
      }

      if (!ciclo && !(await deps.reclamarCiclo(s))) {
        acciones.push({ ...base, accion: "carrera_perdida" });
        continue;
      }

      const suspendidoAhora = await deps.suspender(s.idTenant, s.fechaCobro);
      if (!suspendidoAhora && !s.suspendida) {
        // La suscripción ya no está en ese ciclo (se registró el pago, se canceló, se volvió cortesía…): no se avisa a nadie.
        await deps.marcarOmitido(s.idTenant, s.fechaCobro);
        acciones.push({ ...base, accion: "ya_no_aplica" });
        continue;
      }

      const cliente = await deps.nombreNegocio(s);
      const resultado = await deps.enviar({ telefonoE164: s.telefonoCobro, nombreNegocio: cliente, montoCop: s.precioCop });
      await deps.registrarEnvio({ idTenant: s.idTenant, fechaCobro: s.fechaCobro, resultado, intentos: (ciclo?.intentos ?? 0) + 1 });
      acciones.push({
        ...base,
        accion: reintento ? "reintentar_aviso" : "avisar",
        cliente,
        telefono,
        suspendido: suspendidoAhora,
        resultado: resultado.enviado ? "enviado" : "fallido",
        motivo: resultado.enviado ? undefined : resultado.detalle ? `${resultado.motivo}: ${resultado.detalle}` : resultado.motivo,
      });
    } catch (err) {
      acciones.push({ ...base, accion: "error", motivo: err instanceof Error ? err.message : String(err) });
    }
  }

  if (!simulado) {
    const texto = resumenParaElDueno(hoy, acciones);
    if (texto) await deps.avisarDueno(texto).catch((err) => console.error("[cobros] no se pudo avisar al dueño:", err instanceof Error ? err.message : err));
  }
  return { modo, hoy, revisadas: vencidas.length, acciones };
}

/** El aviso al dueño: solo lo que cambió o necesita su atención. null = nada que contar. */
export function resumenParaElDueno(hoy: string, acciones: AccionCobro[]): string | null {
  const lineas: string[] = [];
  for (const a of acciones) {
    const quien = a.cliente ?? a.idTenant;
    if (a.accion === "avisar" || a.accion === "reintentar_aviso") {
      const suspension = a.suspendido ? "bot suspendido y " : "";
      lineas.push(
        a.resultado === "enviado"
          ? `• ${quien}: ${suspension}recordatorio enviado a ${a.telefono} (cobro del ${a.fechaCobro}).`
          : `• ${quien}: ${suspension}el recordatorio FALLÓ (${a.motivo}); se reintenta mañana.`,
      );
    } else if (a.accion === "sin_telefono") {
      lineas.push(`• ${quien}: venció el ${a.fechaCobro} y NO tiene teléfono de cobro: no se avisó ni se suspendió.`);
    } else if (a.accion === "sin_precio") {
      lineas.push(`• ${quien}: venció el ${a.fechaCobro} pero no tiene precio: no se avisó ni se suspendió.`);
    } else if (a.accion === "error") {
      lineas.push(`• ${quien}: error procesando el cobro del ${a.fechaCobro} (${a.motivo}).`);
    }
  }
  if (lineas.length === 0) return null;
  return `💳 Cobros manuales — ${hoy}\n${lineas.join("\n")}\nPara reactivar a alguien que ya pagó: Panel de Operaciones → el cliente → «Registrar pago».`;
}
