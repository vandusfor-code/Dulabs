import { randomUUID } from "node:crypto";

// DuLabs Developer V1 -- Fase 4 (autorizado, sección "REQUEST ID"). Un
// request_id por request pública, propagado en headers, en el body de
// error, y como atributo de Pub/Sub cuando aplica. Sin tabla nueva, sin
// infraestructura de tracing nueva -- es solo una cadena que viaja con la
// request.

export function generarRequestId(): string {
  return `req_${randomUUID()}`;
}
