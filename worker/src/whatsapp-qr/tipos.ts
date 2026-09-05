// WhatsApp por QR (Fase 9A/9B, autorizado) — contrato GENÉRICO que separa el
// manager (manager.ts) de la tecnología real de conexión (Baileys, ver
// socket-baileys.ts). El manager nunca importa Baileys directamente -- solo
// conoce esta forma, así que las pruebas inyectan una FabricaSocket falsa
// que jamás toca la red real de WhatsApp.

export type EstadoConexion = "desconectado" | "conectando" | "conectado";

/** Forma segura para el navegador -- nunca incluye creds/claves. */
export type EstadoPublico = {
  idTenant: string;
  estado: EstadoConexion;
  numeroConectado: string | null;
  conectadoEn: string | null;
  /** Data URL de la imagen del QR vigente, o null si no aplica. */
  qr: string | null;
  /** Código de 8 caracteres para "Vincular con número de teléfono" (alternativa al QR), o null si no aplica. Mutuamente excluyente con `qr` -- una conexión usa uno u otro, nunca ambos a la vez. */
  codigoVinculacion: string | null;
};

export type EventoConexion =
  | { tipo: "qr"; qr: string }
  | { tipo: "codigo_vinculacion"; codigo: string }
  | { tipo: "conectado"; numero: string | null }
  /** motivoFinal=true (ej. logout real) => no reintentar, hace falta un QR nuevo. */
  | { tipo: "desconectado"; motivoFinal: boolean; error?: string };

export interface SocketWhatsApp {
  onEvento(cb: (evento: EventoConexion) => void): void;
  enviarMensaje(telefono: string, mensaje: string): Promise<void>;
  /** Chats AMORE (autorizado) — envía una nota de audio real. El propio evento messages.upsert (ver socket-baileys.ts) persiste este mismo mensaje como saliente, así que esta función no inserta ninguna fila -- solo manda el audio real por WhatsApp. */
  enviarAudio(telefono: string, audio: Buffer, mimeType: string): Promise<void>;
  cerrar(): Promise<void>;
}

/**
 * Construye la sesión real (o falsa, en pruebas) de un tenant específico.
 * `telefono` (opcional, solo dígitos con indicativo de país) activa el modo
 * "vincular con número" -- si se omite, el flujo por defecto sigue siendo
 * QR, exactamente como antes de esta fase.
 */
export type FabricaSocket = (params: { idTenant: string; telefono?: string }) => Promise<SocketWhatsApp>;
