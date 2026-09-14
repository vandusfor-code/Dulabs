/**
 * FASE F8.6 (Final Hardening, autorizado) — Meta Graph API mock reutilizable
 * para el harness Full E2E. Intercepta `fetch` SOLO hacia
 * `graph.facebook.com` (cualquier otro host se delega al fetch real -- así
 * nunca bloquea las llamadas internas de Supabase/@supabase/auth-js que
 * corren en paralelo dentro del mismo proceso de test); nunca se usa fuera
 * de tests -- ver app/webhook-dulabs/e2e-*.test.ts y lib/flow/e2e-*.test.ts.
 *
 * Solo existe en este archivo bajo lib/testing/ (nunca importado desde
 * ningún archivo de producción, ver grep de la auditoría de Fase 8.6) --
 * no hay forma de que esto se ejecute accidentalmente fuera de tests.
 */

export type MetaMockRespuesta =
  | { tipo: "ok"; status?: number; body?: unknown }
  | { tipo: "error"; status: number; errorMessage?: string; errorCode?: number; retryAfterSegundos?: number }
  | { tipo: "timeout" }
  | { tipo: "network_error" };

export interface MetaMockLlamada {
  url: string;
  method: string;
  /** Cuerpo JSON parseado de la petición saliente (nunca contiene el token -- ese va en el header, ver `autorizacionPresente`). */
  body: unknown;
  /** true si la petición incluyó un header Authorization -- nunca se guarda el valor real. */
  autorizacionPresente: boolean;
}

/** Solo se llama para las variantes "ok"/"error" -- "timeout"/"network_error" se resuelven antes, en instalarMetaGraphMock. */
function respuestaHttpDeMock(r: Extract<MetaMockRespuesta, { tipo: "ok" } | { tipo: "error" }>): Response {
  if (r.tipo === "ok") {
    return new Response(JSON.stringify(r.body ?? { messages: [{ id: `wamid.mock-${Date.now()}-${Math.random().toString(36).slice(2)}` }] }), {
      status: r.status ?? 200,
    });
  }
  const headers = new Headers();
  if (r.retryAfterSegundos != null) headers.set("Retry-After", String(r.retryAfterSegundos));
  return new Response(
    JSON.stringify({ error: { message: r.errorMessage ?? "mock error", code: r.errorCode ?? 1 } }),
    { status: r.status, headers },
  );
}

/**
 * Instala el mock. `cola` se consume en orden (shift) para cada request
 * hacia `/messages` (envío real) -- así un test puede simular
 * "503, 503, 200" para probar el retry real de F8.3 sin tocar Meta. Cuando
 * la cola se vacía, repite la ÚLTIMA respuesta puesta (evita que una
 * llamada de más rompa el test por quedarse sin mock). Otros endpoints
 * (subscribed_apps, phone_numbers, oauth/access_token, media upload) usan
 * `respuestasPorRuta` -- cada entry se prueba en orden, el primero cuyo
 * `match` acepta la URL decide la respuesta (también consumida en orden si
 * es un array).
 */
export function instalarMetaGraphMock(opts?: {
  colaMessages?: MetaMockRespuesta[];
  respuestasPorRuta?: { match: (url: string) => boolean; respuestas: MetaMockRespuesta[] }[];
}) {
  const original = global.fetch;
  const llamadas: MetaMockLlamada[] = [];
  const colaMessages = [...(opts?.colaMessages ?? [{ tipo: "ok" as const }])];
  const porRuta = (opts?.respuestasPorRuta ?? []).map((r) => ({ match: r.match, respuestas: [...r.respuestas] }));

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("graph.facebook.com")) return original(input, init);

    const method = init?.method ?? "GET";
    let bodyParsed: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        bodyParsed = JSON.parse(init.body);
      } catch {
        bodyParsed = init.body;
      }
    }
    const headers = init?.headers as Record<string, string> | Headers | undefined;
    const auth = headers instanceof Headers ? headers.get("Authorization") : headers?.Authorization;
    llamadas.push({ url, method, body: bodyParsed, autorizacionPresente: Boolean(auth) });

    let respuesta: MetaMockRespuesta;
    const ruta = porRuta.find((r) => r.match(url));
    if (ruta) {
      respuesta = ruta.respuestas.length > 1 ? ruta.respuestas.shift()! : ruta.respuestas[0];
    } else if (url.includes("/messages") && method === "POST") {
      respuesta = colaMessages.length > 1 ? colaMessages.shift()! : colaMessages[0];
    } else {
      respuesta = { tipo: "ok" };
    }

    if (respuesta.tipo === "timeout") {
      return new Promise<Response>((_, reject) => {
        const err = new DOMException("aborted", "AbortError");
        if (init?.signal) {
          init.signal.addEventListener("abort", () => reject(err));
          if (init.signal.aborted) reject(err);
        }
        // Sin AbortSignal en la llamada real: nunca resuelve (simula un
        // timeout real que el caller debe cortar con su propio AbortController).
      });
    }
    if (respuesta.tipo === "network_error") {
      throw new TypeError("fetch failed (mock: network_error)");
    }
    return respuestaHttpDeMock(respuesta);
  }) as typeof fetch;

  return {
    llamadas,
    restaurar: () => {
      global.fetch = original;
    },
  };
}
