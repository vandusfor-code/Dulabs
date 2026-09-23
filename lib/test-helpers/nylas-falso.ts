// API de Nylas SIMULADA a nivel HTTP, solo para tests: sustituye `fetch` únicamente para api.us.nylas.com, así corre el
// cliente HTTP REAL (lib/nylas/nylas-client.ts) con sus respuestas de verdad (JSON, códigos de error). Cualquier otra URL
// falla ruidosamente: ningún test sale a la red.

export type RespuestaNylas = (q: { calendarId: string; start: number; end: number }) => { status: number; body: unknown };

export function instalarNylasFalso(responder: RespuestaNylas): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== "api.us.nylas.com") throw new Error(`fetch inesperado a ${url.hostname}`);
    const { status, body } = responder({
      calendarId: url.searchParams.get("calendar_id") ?? "",
      start: Number(url.searchParams.get("start")),
      end: Number(url.searchParams.get("end")),
    });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** Un evento marcado LIBRE (busy:false) cubriendo el rango pedido en `libres`, más los ocupados que se indiquen. */
export function calendarioNylas(opciones: { libresEn?: string[]; ocupados?: Record<string, { start: number; end: number }[]> } = {}): RespuestaNylas {
  return ({ calendarId, start, end }) => ({
    status: 200,
    body: {
      data: [
        ...((opciones.libresEn ?? []).includes(calendarId) ? [{ id: "libre", status: "confirmed", busy: false, when: { object: "timespan", start_time: start, end_time: end } }] : []),
        ...(opciones.ocupados?.[calendarId] ?? []).map((o, i) => ({ id: `ocupado-${i}`, status: "confirmed", busy: true, when: { object: "timespan", start_time: o.start, end_time: o.end } })),
      ],
    },
  });
}
