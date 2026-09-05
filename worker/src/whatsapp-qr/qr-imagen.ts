import QRCode from "qrcode";

// Convierte el string crudo del QR de WhatsApp en una imagen data URL lista
// para <img src=...>. No es información sensible -- es exactamente lo mismo
// que WhatsApp Web mostraría en pantalla para ser escaneado con la cámara.
export async function generarImagenQr(contenidoQr: string): Promise<string> {
  return QRCode.toDataURL(contenidoQr, { margin: 1, width: 280 });
}
