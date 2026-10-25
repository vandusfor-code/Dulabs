import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarTemplateDulabs, type ResultadoEnvioTemplate } from "@/lib/developer/dulabs-whatsapp";
import { verificarLimiteTasa, type ResultadoLimiteTasa } from "@/lib/rate-limit";

// Integración Du_Explora -> DuLabs Business (sin API keys del Developer API).
// Du_Explora (fábrica de videos, proyecto hermano) avisa cada día por WhatsApp
// al dueño. El envío reutiliza el número oficial de DuLabs y
// enviarTemplateDulabs (que valida la plantilla APPROVED, nº de variables e
// idioma real). Superficie ESTRECHA a propósito: el cliente solo informa
// {ready, date, runId}; plantilla, idioma, parámetros y destinatario los fija
// el servidor -- el cliente no puede elegir ninguno.
//
// Limitación conocida (idempotencia): el repo no tiene un almacén de
// idempotencia durable de uso general (el contador de rate limit se purga a
// la hora), así que `runId` NO deduplica -- solo se registra para trazabilidad.
// Un reintento tras un timeout posterior al envío podría duplicar el aviso; el
// cliente debe reintentar únicamente ante 502/5xx/error de red ANTES de recibir
// respuesta y es un aviso informativo diario, no una operación financiera.

export const PLANTILLA_DU_EXPLORA = "du_explora_videos_listos";
export const IDIOMA_DU_EXPLORA = "es_CO";

const CLAVES_PERMITIDAS = new Set(["ready", "date", "runId"]);
const RUN_ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;
const FECHA_VALIDA = /^(\d{2})-(\d{2})-(\d{4})$/;
const DESTINO_VALIDO = /^\d{8,15}$/;
export const TAMANO_MAXIMO_CUERPO = 2048;

export type DependenciasNotificarDuExplora = {
  /** Se invoca DESPUÉS de autenticar: sin secreto válido nunca se toca la base. */
  crearSupabase: () => SupabaseClient;
  env: { secreto: string | undefined; destino: string | undefined };
  enviar?: typeof enviarTemplateDulabs;
  limitar?: (supabase: SupabaseClient) => Promise<ResultadoLimiteTasa>;
};

export type RespuestaNotificar = { status: number; cuerpo: Record<string, unknown>; headers?: Record<string, string> };

function claveValida(recibida: string | null, esperada: string | undefined): boolean {
  if (!recibida || !esperada) return false;
  const a = createHash("sha256").update(recibida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

export function fechaDDMMAAAAReal(valor: string): boolean {
  const m = FECHA_VALIDA.exec(valor);
  if (!m) return false;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anio = Number(m[3]);
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  return f.getUTCFullYear() === anio && f.getUTCMonth() === mes - 1 && f.getUTCDate() === dia;
}

function validarCuerpo(crudo: string): { ok: true; ready: number; date: string; runId: string } | { ok: false; motivo: string } {
  if (crudo.length > TAMANO_MAXIMO_CUERPO) return { ok: false, motivo: "cuerpo_demasiado_grande" };
  let json: unknown;
  try {
    json = JSON.parse(crudo);
  } catch {
    return { ok: false, motivo: "json_invalido" };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, motivo: "cuerpo_debe_ser_objeto" };
  const c = json as Record<string, unknown>;
  for (const k of Object.keys(c)) {
    if (!CLAVES_PERMITIDAS.has(k)) return { ok: false, motivo: `campo_no_permitido:${k.slice(0, 32)}` };
  }
  if (typeof c.ready !== "number" || !Number.isInteger(c.ready) || c.ready < 0 || c.ready > 3) return { ok: false, motivo: "ready_invalido" };
  if (typeof c.date !== "string" || !fechaDDMMAAAAReal(c.date)) return { ok: false, motivo: "date_invalida" };
  if (typeof c.runId !== "string" || !RUN_ID_VALIDO.test(c.runId)) return { ok: false, motivo: "runId_invalido" };
  return { ok: true, ready: c.ready, date: c.date, runId: c.runId };
}

/** Quita del detalle de Meta cualquier rastro del destinatario o de un token: la respuesta y los logs nunca los exponen. */
export function depurarDetalle(detalle: string | undefined, destino: string): string | undefined {
  if (!detalle) return undefined;
  let d = detalle.split(destino).join("[destino]");
  d = d.replace(/\+?\d{10,15}/g, "[numero]");
  d = d.replace(/Bearer\s+\S+/gi, "Bearer [oculto]");
  d = d.replace(/EA[A-Za-z0-9]{20,}/g, "[token]");
  return d.slice(0, 500);
}

export async function manejarNotificarDuExplora(
  deps: DependenciasNotificarDuExplora,
  req: { authorization: string | null; cuerpoCrudo: string },
): Promise<RespuestaNotificar> {
  const bearer = req.authorization?.startsWith("Bearer ") ? req.authorization.slice(7).trim() : null;
  if (!claveValida(bearer, deps.env.secreto)) return { status: 403, cuerpo: { ok: false, motivo: "forbidden" } };

  const limitar =
    deps.limitar ??
    ((sb: SupabaseClient) => verificarLimiteTasa(sb, { recurso: "du_explora_notificar", tenantId: "global", categoria: "costosa" }));
  const supabase = deps.crearSupabase();
  const limite = await limitar(supabase);
  if (!limite.permitido) {
    const seg = limite.reiniciaEn ? Math.max(1, Math.ceil((new Date(limite.reiniciaEn).getTime() - Date.now()) / 1000)) : 60;
    return { status: 429, cuerpo: { ok: false, motivo: "rate_limited" }, headers: { "Retry-After": String(seg) } };
  }

  const cuerpo = validarCuerpo(req.cuerpoCrudo);
  if (!cuerpo.ok) return { status: 400, cuerpo: { ok: false, motivo: cuerpo.motivo } };

  const destino = (deps.env.destino ?? "").trim();
  if (!DESTINO_VALIDO.test(destino)) {
    console.error(`[du-explora-notificar] runId=${cuerpo.runId} destino_no_configurado`);
    return { status: 503, cuerpo: { ok: false, motivo: "destino_no_configurado" } };
  }

  const enviar = deps.enviar ?? enviarTemplateDulabs;
  let r: ResultadoEnvioTemplate;
  try {
    r = await enviar(supabase, {
      nombrePlantilla: PLANTILLA_DU_EXPLORA,
      idioma: IDIOMA_DU_EXPLORA,
      destinoE164: destino,
      params: [String(cuerpo.ready), cuerpo.date],
    });
  } catch (err) {
    r = { enviado: false, motivo: "error_inesperado", detalle: err instanceof Error ? err.message : String(err) };
  }

  if (r.enviado) {
    console.log(`[du-explora-notificar] runId=${cuerpo.runId} enviado`);
    return { status: 200, cuerpo: { ok: true, wamid: r.wamid } };
  }
  const detalle = depurarDetalle(r.detalle, destino);
  console.error(`[du-explora-notificar] runId=${cuerpo.runId} fallo motivo=${r.motivo}`);
  return { status: 502, cuerpo: { ok: false, motivo: r.motivo, ...(detalle ? { detalle } : {}) } };
}
