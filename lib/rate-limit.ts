import type { SupabaseClient } from "@supabase/supabase-js";

// Fase 11 (Completion & Debt Zero, autorizado) — rate limiting real para las
// APIs de dashboard, reutilizando la función RPC dulabs_rate_limit_incrementar
// (20261001000000_dulabs_rate_limit.sql). Aislamiento por TENANT (no por
// usuario ni IP): el riesgo real que esto protege es un tenant con un bug de
// integración/loop propio saturando la base o gastando cuota de forma
// descontrolada, nunca un actor anónimo (todas estas rutas ya exigen sesión
// válida antes de llegar acá) -- por tenant es lo que da aislamiento real
// entre clientes sin, por ejemplo, penalizar a un equipo de 5 personas
// usando el dashboard activamente desde 5 sesiones distintas.

export type ResultadoLimiteTasa = {
  permitido: boolean;
  conteo: number;
  limite: number;
  reiniciaEn: string | null;
};

// Presets por categoría (sección 8 del spec F11: diferenciar lectura,
// escritura y operaciones costosas). Ventana fija de 60s en todos los
// casos -- suficiente granularidad para "protección razonable contra
// abuso", sin inventar límites arbitrarios que rompan un uso normal del
// dashboard (un equipo activo refrescando el Inbox no debería nunca
// acercarse a estos números).
export const LIMITES_TASA = {
  lectura: { ventanaSeg: 60, limite: 120 },
  escritura: { ventanaSeg: 60, limite: 60 },
  costosa: { ventanaSeg: 60, limite: 10 },
  // Fase 4 (Developer API, autorizado, decisión D8) -- mismo mecanismo
  // genérico (RPC dulabs_rate_limit_incrementar, ya real y distribuido vía
  // Postgres), nuevas categorías. Límite de Fase 0: 2 mensajes/segundo por
  // whatsapp_number_id. No sustituye al límite de workspace -- ambos se
  // verifican, el más restrictivo de los dos aplica.
  devOutboundPorNumero: { ventanaSeg: 1, limite: 2 },
  devOutboundPorWorkspace: { ventanaSeg: 60, limite: 1200 },
  devAuthFallida: { ventanaSeg: 60, limite: 20 },
  devLectura: { ventanaSeg: 60, limite: 300 },
  // Bloque 18 -- endpoints PÚBLICOS del catálogo (ver lib/catalogo/limites-publicos.ts).
  catalogoPedidoIp: { ventanaSeg: 600, limite: 20 },
  catalogoPedidoCatalogo: { ventanaSeg: 3600, limite: 1000 },
  catalogoSeleccionIp: { ventanaSeg: 60, limite: 120 },
} as const;

export type CategoriaLimiteTasa = keyof typeof LIMITES_TASA;

// Nunca bloquea la petición real si el propio rate limiter falla (RPC no
// disponible porque la migración de F11 no está aplicada todavía, error de
// red, timeout) -- mismo criterio "fail-open" que el resto de mecanismos
// tolerantes del proyecto (lib/chat-lock.ts, lib/conversacion-estado.ts):
// un candado de protección que en sí mismo tumba el producto es peor que no
// tenerlo.
export async function verificarLimiteTasa(
  supabase: SupabaseClient,
  input: { recurso: string; tenantId: string; categoria: CategoriaLimiteTasa },
): Promise<ResultadoLimiteTasa> {
  const { ventanaSeg, limite } = LIMITES_TASA[input.categoria];
  const clave = `${input.recurso}:${input.tenantId}`;

  const { data, error } = await supabase.rpc("dulabs_rate_limit_incrementar", {
    p_clave: clave,
    p_ventana_seg: ventanaSeg,
    p_limite: limite,
  });
  if (error || !data || !Array.isArray(data) || data.length === 0) {
    if (error) {
      console.error(
        "[rate-limit] RPC dulabs_rate_limit_incrementar no disponible (¿falta aplicar la migración de F11?), permitiendo la petición:",
        error.message,
      );
    }
    return { permitido: true, conteo: 0, limite, reiniciaEn: null };
  }

  const fila = data[0] as { permitido: boolean; conteo: number; reinicia_en: string };
  return { permitido: fila.permitido, conteo: fila.conteo, limite, reiniciaEn: fila.reinicia_en };
}

// Envoltorio listo para usar al inicio de un route handler: devuelve un
// Response 429 (con Retry-After y X-RateLimit-* reales) si el límite ya se
// superó, o null si la petición puede continuar. El caller solo necesita
// `if (limite) return limite;` como primera línea después de resolver el
// tenant de la sesión.
export async function respuestaSiLimiteTasaExcedido(
  supabase: SupabaseClient,
  input: { recurso: string; tenantId: string; categoria: CategoriaLimiteTasa },
): Promise<Response | null> {
  const resultado = await verificarLimiteTasa(supabase, input);
  if (resultado.permitido) return null;

  const retryAfterSeg = resultado.reiniciaEn
    ? Math.max(1, Math.ceil((new Date(resultado.reiniciaEn).getTime() - Date.now()) / 1000))
    : 60;

  return Response.json(
    { error: "Demasiadas solicitudes. Intenta de nuevo en unos segundos." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeg),
        "X-RateLimit-Limit": String(resultado.limite),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}
