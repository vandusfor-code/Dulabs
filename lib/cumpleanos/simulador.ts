import type { EnviadorWhatsApp } from "./motor";

// Cumpleaños automáticos (Fase 6B, genérico, autorizado) — enviador de
// dry-run para el endpoint del cron: deja constancia en logs de qué se
// habría enviado (tenant/cliente/teléfono/mensaje) y NUNCA llama a
// enviarWhatsApp ni a Meta. El motor igual registra el resultado real de la
// simulación en dulabs_cumpleanos_procesados (estado="simulado", con el
// mensaje ya renderizado) -- este simulador solo se encarga de la parte
// "muéstralo/loguéalo".
export function crearSimuladorLog(idTenant: string): EnviadorWhatsApp {
  return async ({ clienteId, telefono, mensaje }) => {
    console.log(`[cumpleanos-dry-run] tenant=${idTenant} cliente=${clienteId} telefono=${telefono} mensaje=${JSON.stringify(mensaje)}`);
  };
}
