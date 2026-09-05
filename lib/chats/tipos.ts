// Chats AMORE (autorizado) — tipos compartidos del módulo, genérico (no
// exclusivo de AMORE). Reflejan exactamente las columnas reales de
// dulabs_chat_conversaciones/dulabs_chat_mensajes -- ningún campo se
// inventa acá que no exista en la migración.
export type EstadoConversacion = "automatico" | "manual" | "requiere_atencion" | "archivada";
export type TipoMensajeChat = "texto" | "audio";
export type EstadoMensajeChat = "enviando" | "enviado" | "entregado" | "leido" | "error";

export type ConversacionResumen = {
  id: number;
  telefono: string;
  nombreVisible: string;
  clienteId: number | null;
  ultimoMensaje: string | null;
  ultimaActividad: string;
  noLeidos: number;
  estado: EstadoConversacion;
};

export type MensajeChat = {
  id: number;
  direccion: "entrante" | "saliente";
  tipo: TipoMensajeChat;
  texto: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  duracionSeg: number | null;
  estado: EstadoMensajeChat;
  enviadoEn: string;
};

export type CitaResumenChat = {
  id: number;
  servicio: string;
  profesional: string;
  inicio: string;
  estado: string;
};

export type ClienteVinculado = {
  id: number;
  nombre: string;
  telefono: string;
  correo: string | null;
  cumpleDia: number | null;
  cumpleMes: number | null;
  fechaRegistro: string;
} | null;
