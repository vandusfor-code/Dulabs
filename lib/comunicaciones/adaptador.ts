import type { AdaptadorCanal } from "./tipos";

// Confirmaciones y recordatorios (Fase 8, genérico, autorizado) —
// abstracción del canal de salida:
//
//   motor de comunicación -> adaptador de canal -> WhatsApp QR (Fase 9)
//
// El motor (motor.ts) NUNCA conoce Meta, WhatsApp ni ningún proveedor --
// solo conoce `AdaptadorCanal` (tipos.ts): una función que recibe una
// TareaComunicacion y la "entrega". En esta fase el ÚNICO adaptador que
// existe es este simulador: nunca hace red, nunca toca Meta/WhatsApp, solo
// deja constancia en logs de qué se habría enviado. La Fase 9 añade un
// adaptador real (WhatsApp por QR) que implementa la MISMA interfaz sin
// tocar el motor ni un archivo de este módulo.
export function crearAdaptadorSimulado(): AdaptadorCanal {
  return async (tarea) => {
    console.log(
      `[comunicaciones-simulado] tenant=${tarea.idTenant} cita=${tarea.citaId} tipo=${tarea.tipo} telefono=${tarea.telefonoCliente} mensaje=${JSON.stringify(tarea.mensaje)}`
    );
  };
}
