// DuLabs Developer -- guion de ejemplo del bloque Webhooks (compartido por WebhookFlow, EventStream y el inspector de entrega).
// Todo es DEMO DATA rotulada en la página, pero la mecánica es la real del producto:
//   - tipos de evento: message.received / message.status (lib/developer/inbound-event-mapper.ts, cuerpo snake_case)
//   - política de entrega: hasta 5 intentos con backoff 30 s -> 60 s -> 120 s -> 240 s; agotados, el evento pasa a la DLQ
//     (MAX_INTENTOS_ENTREGA y backoffEntregaMs en lib/developer/events-store.ts)
//   - un 5xx/timeout se reintenta; un 4xx es terminal (va directo a la DLQ).

export type Escenario = "ok" | "retry" | "dlq";
export type Tono = "ok" | "warn" | "danger" | "neutro";

/** Pasos (ms): Meta · verifica · normaliza · deduplica · firma · entrega · reintento · resultado · reposo · reinicio. */
export const PASOS_WEBHOOK = [450, 450, 450, 450, 750, 700, 900, 1100, 700, 300] as const;
export const PASO_FIRMA = 4;
export const PASO_ENTREGA = 5;
export const PASO_REPOSO = 8;
export const PASO_REINICIO = 9;

/** Orden de escenarios por vuelta: la mayoría se entrega al primer intento; los fallos aparecen con su significado. */
const ORDEN: Escenario[] = ["ok", "retry", "ok", "ok", "dlq", "ok"];
const LATENCIAS = [44, 36, 52, 41, 38, 47, 55, 39];
const SEGUNDOS = [4, 5, 3, 6, 4, 5];

function modulo(n: number, m: number) {
  return ((n % m) + m) % m;
}

export function escenarioDe(k: number): Escenario {
  return ORDEN[modulo(k, ORDEN.length)]!;
}

export type EventoEjemplo = { tipo: "message.received" | "message.status"; detalle: string; cuerpo: string };

export function eventoDe(k: number, eventId: string): EventoEjemplo {
  const i = modulo(k, 3);
  if (i === 1) {
    return {
      tipo: "message.received",
      detalle: "text",
      cuerpo: `{
  "event_type": "message.received",
  "event_id": "${eventId}",
  "wamid": "wamid.HBgM…",
  "from": "573000000000",
  "message_type": "text",
  "text": "Hola",
  "timestamp": "1712000270"
}`,
    };
  }
  const status = i === 0 ? "delivered" : "read";
  return {
    tipo: "message.status",
    detalle: status,
    cuerpo: `{
  "event_type": "message.status",
  "event_id": "${eventId}",
  "wamid": "wamid.HBgM…",
  "status": "${status}",
  "timestamp": "1712000270"
}`,
  };
}

/** Resultado de la entrega en el endpoint del developer, según el escenario y el paso de la secuencia (o final si `paso` es null). */
export function entregaDe(escenario: Escenario, paso: number | null, k: number): { codigo: string; texto: string; tono: Tono } {
  const ms = LATENCIAS[modulo(k, LATENCIAS.length)]!;
  const final = paso === null || paso >= 7;
  if (escenario === "ok") return { codigo: "200", texto: `200 · ${ms} ms`, tono: "ok" };
  if (escenario === "retry") {
    if (final) return { codigo: "200", texto: `200 · 2/5 · ${ms} ms`, tono: "ok" };
    if (paso === 6) return { codigo: "503", texto: "503 · retry 2/5", tono: "warn" };
    return { codigo: "503", texto: "503 · 1/5", tono: "danger" };
  }
  if (final) return { codigo: "503", texto: "DLQ · 5/5", tono: "danger" };
  if (paso === 6) return { codigo: "503", texto: "503 · retry 5/5", tono: "warn" };
  return { codigo: "503", texto: "503 · 1/5", tono: "danger" };
}

/** Hora de ejemplo del evento k (monótona, con intervalos de 3–6 s). */
export function horaDe(k: number): string {
  let s = 12 * 3600 + 4 * 60 + 30;
  if (k >= 0) for (let j = 0; j < k; j++) s += SEGUNDOS[modulo(j, SEGUNDOS.length)]!;
  else for (let j = -1; j >= k; j--) s -= SEGUNDOS[modulo(j, SEGUNDOS.length)]!;
  const hh = Math.floor(s / 3600) % 24;
  const mm = Math.floor(s / 60) % 60;
  const ss = s % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** Clase de color (solo estado) para un tono. */
export function claseTono(tono: Tono): string {
  return tono === "ok" ? "text-dp-ok" : tono === "warn" ? "text-dp-warn" : tono === "danger" ? "text-dp-danger" : "text-dp-text-2";
}
