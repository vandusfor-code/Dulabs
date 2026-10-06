/**
 * AMORE — «MI CITA»: el enlace personal y seguro con el que una clienta ve, reprograma o cancela SU cita.
 *
 * Reglas de seguridad (todas verificadas por pruebas):
 *   - El token es ALEATORIO (32 bytes de CSPRNG, 256 bits, base64url = 43 caracteres). No se deriva del id de la cita ni de nada predecible, no lleva
 *     información embebida y no se puede enumerar ni adivinar.
 *   - El id de la cita NUNCA viaja en la URL ni lo envía el cliente: el servidor lo resuelve SIEMPRE a partir del token (por su hash).
 *   - En la base se guarda el HASH (sha256) para validar y una copia CIFRADA (AES-256-GCM, TOKEN_ENCRYPTION_KEY) solo para poder reenviar el MISMO enlace en
 *     los recordatorios. Una copia de la base por sí sola no revela ningún enlace.
 *   - Un solo enlace activo por cita; revocable; con vencimiento (14 días después de la cita). Un token mal formado, inexistente, revocado o vencido se
 *     responde igual (sin pistas sobre cuál fue el motivo).
 *   - Nada de esto lanza: ante cualquier problema (p. ej. la migración todavía no aplicada) devuelve «sin enlace» y registra el motivo; una reserva NUNCA falla
 *     por no poder crear su enlace.
 */
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cifrarSecreto, descifrarSecreto } from "@/lib/crypto";

/** Base pública de los enlaces de AMORE (dominio canónico). */
export const AMORE_SITIO_BASE = "https://www.dulabs.co";
/** Enlace de reserva de citas NUEVAS (único camino para reservar). */
export const URL_RESERVA_AMORE = `${AMORE_SITIO_BASE}/reservar/amore`;

export const TABLA_ENLACES = "dulabs_cita_enlaces";
/** El enlace sigue abriendo (para ver el resultado, reprogramar o cancelar) hasta 14 días después del fin de la cita. */
export const GRACIA_TRAS_LA_CITA_MS = 14 * 24 * 60 * 60 * 1000;

const TOKEN_FORMATO = /^[A-Za-z0-9_-]{43}$/;

export const generarToken = (): string => randomBytes(32).toString("base64url");
export const hashDeToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
export const esTokenBienFormado = (valor: unknown): valor is string => typeof valor === "string" && TOKEN_FORMATO.test(valor);
export const urlDeEnlace = (token: string, base: string = AMORE_SITIO_BASE): string => `${base}/mi-cita/${token}`;
export const vencimientoDeEnlace = (citaFinISO: string, ahora: Date): Date => new Date(Math.max(Date.parse(citaFinISO) || 0, ahora.getTime()) + GRACIA_TRAS_LA_CITA_MS);

export interface FilaEnlace {
  id: string;
  idTenant: string;
  citaId: number;
  tokenHash: string;
  tokenCifrado: string;
  createdAt: string;
  expiraAt: string;
  revocadoAt: string | null;
}

export type ResultadoInsertarEnlace = { ok: true; fila: FilaEnlace } | { ok: false; motivo: "ya_existe_activo" | "sin_tabla" | "error"; detalle?: string };

/** Almacén de enlaces: Supabase en producción, memoria en pruebas. */
export interface EnlacesStore {
  porHash(tokenHash: string): Promise<FilaEnlace | null>;
  activoDeCita(idTenant: string, citaId: number): Promise<FilaEnlace | null>;
  insertar(fila: { idTenant: string; citaId: number; tokenHash: string; tokenCifrado: string; expiraAt: string }): Promise<ResultadoInsertarEnlace>;
  revocar(id: string, ahoraISO: string): Promise<void>;
  extenderVigencia(id: string, expiraAtISO: string): Promise<void>;
  registrarUso(id: string, ahoraISO: string): Promise<void>;
}

interface FilaBD {
  id: string;
  id_tenant: string;
  cita_id: number | string;
  token_hash: string;
  token_cifrado: string;
  created_at: string;
  expira_at: string;
  revocado_at: string | null;
}

const COLUMNAS = "id, id_tenant, cita_id, token_hash, token_cifrado, created_at, expira_at, revocado_at";
const SIN_TABLA = new Set(["42P01", "PGRST205", "PGRST204"]);

const aFila = (f: FilaBD): FilaEnlace => ({ id: f.id, idTenant: f.id_tenant, citaId: Number(f.cita_id), tokenHash: f.token_hash, tokenCifrado: f.token_cifrado, createdAt: f.created_at, expiraAt: f.expira_at, revocadoAt: f.revocado_at });

export function createSupabaseEnlacesStore(supabase: SupabaseClient): EnlacesStore {
  const tabla = () => supabase.from(TABLA_ENLACES);
  return {
    async porHash(tokenHash) {
      const { data, error } = await tabla().select(COLUMNAS).eq("token_hash", tokenHash).maybeSingle();
      if (error) {
        if (SIN_TABLA.has(error.code ?? "")) return null;
        throw new Error(`[mi-cita] porHash: ${error.code ?? "?"}`);
      }
      return data ? aFila(data as FilaBD) : null;
    },
    async activoDeCita(idTenant, citaId) {
      const { data, error } = await tabla().select(COLUMNAS).eq("id_tenant", idTenant).eq("cita_id", citaId).is("revocado_at", null).maybeSingle();
      if (error) {
        if (SIN_TABLA.has(error.code ?? "")) return null;
        throw new Error(`[mi-cita] activoDeCita: ${error.code ?? "?"}`);
      }
      return data ? aFila(data as FilaBD) : null;
    },
    async insertar(f) {
      const { data, error } = await tabla()
        .insert({ id_tenant: f.idTenant, cita_id: f.citaId, token_hash: f.tokenHash, token_cifrado: f.tokenCifrado, expira_at: f.expiraAt })
        .select(COLUMNAS)
        .maybeSingle();
      if (!error && data) return { ok: true, fila: aFila(data as FilaBD) };
      if (error && SIN_TABLA.has(error.code ?? "")) return { ok: false, motivo: "sin_tabla" };
      if (error?.code === "23505") return { ok: false, motivo: "ya_existe_activo" };
      return { ok: false, motivo: "error", detalle: error?.code ?? "sin_fila" };
    },
    async revocar(id, ahoraISO) {
      await tabla().update({ revocado_at: ahoraISO }).eq("id", id).is("revocado_at", null);
    },
    async extenderVigencia(id, expiraAtISO) {
      await tabla().update({ expira_at: expiraAtISO }).eq("id", id).is("revocado_at", null);
    },
    async registrarUso(id, ahoraISO) {
      await tabla().update({ ultimo_uso_at: ahoraISO }).eq("id", id);
    },
  };
}

/** Almacén en memoria (pruebas): mismas reglas que los índices únicos de la migración. */
export function createMemoryEnlacesStore(opts: { sinTabla?: boolean } = {}): EnlacesStore & { filas: FilaEnlace[]; usos: string[] } {
  const filas: FilaEnlace[] = [];
  const usos: string[] = [];
  let seq = 0;
  return {
    filas,
    usos,
    async porHash(h) {
      if (opts.sinTabla) return null;
      return filas.find((f) => f.tokenHash === h) ?? null;
    },
    async activoDeCita(idTenant, citaId) {
      if (opts.sinTabla) return null;
      return filas.find((f) => f.idTenant === idTenant && f.citaId === citaId && f.revocadoAt === null) ?? null;
    },
    async insertar(f) {
      if (opts.sinTabla) return { ok: false, motivo: "sin_tabla" };
      if (filas.some((x) => x.tokenHash === f.tokenHash) || filas.some((x) => x.citaId === f.citaId && x.revocadoAt === null)) return { ok: false, motivo: "ya_existe_activo" };
      const fila: FilaEnlace = { id: `enlace-${++seq}`, idTenant: f.idTenant, citaId: f.citaId, tokenHash: f.tokenHash, tokenCifrado: f.tokenCifrado, createdAt: new Date().toISOString(), expiraAt: f.expiraAt, revocadoAt: null };
      filas.push(fila);
      return { ok: true, fila };
    },
    async revocar(id, ahoraISO) {
      const f = filas.find((x) => x.id === id);
      if (f && f.revocadoAt === null) f.revocadoAt = ahoraISO;
    },
    async extenderVigencia(id, expiraAtISO) {
      const f = filas.find((x) => x.id === id && x.revocadoAt === null);
      if (f) f.expiraAt = expiraAtISO;
    },
    async registrarUso(id) {
      usos.push(id);
    },
  };
}

export interface OpcionesEnlace {
  ahora?: () => Date;
  /** Base de la URL (pruebas); por defecto el dominio canónico. */
  base?: string;
  log?: (mensaje: string, detalle?: unknown) => void;
}

const logPorDefecto = (mensaje: string, detalle?: unknown) => console.error(`[mi-cita] ${mensaje}`, detalle ?? "");

/**
 * El enlace personal de UNA cita: si ya tiene uno activo (y no vencido) devuelve ESE MISMO (así el recordatorio y la confirmación llevan el mismo enlace);
 * si no, emite uno nuevo. Nunca lanza: devuelve `null` si no se pudo (y registra por qué). Es seguro llamarlo varias veces o en paralelo.
 */
export async function obtenerOCrearEnlace(store: EnlacesStore, params: { idTenant: string; citaId: number; citaFinISO: string }, opts: OpcionesEnlace = {}): Promise<{ token: string; url: string } | null> {
  const ahora = (opts.ahora ?? (() => new Date()))();
  const log = opts.log ?? logPorDefecto;
  const respuesta = (token: string) => ({ token, url: urlDeEnlace(token, opts.base) });
  try {
    const activo = await store.activoDeCita(params.idTenant, params.citaId);
    if (activo) {
      const vigente = Date.parse(activo.expiraAt) > ahora.getTime();
      if (vigente) {
        const token = tokenDeFila(activo);
        if (token) {
          // Si el enlace guardado vive menos que la cita (p. ej. la cita se movió), se extiende; nunca se acorta.
          const objetivo = vencimientoDeEnlace(params.citaFinISO, ahora);
          if (objetivo.getTime() > Date.parse(activo.expiraAt)) await store.extenderVigencia(activo.id, objetivo.toISOString());
          return respuesta(token);
        }
        log("el enlace guardado no se pudo descifrar o no coincide con su hash: se revoca y se emite otro", { citaId: params.citaId });
      }
      await store.revocar(activo.id, ahora.toISOString());
    }

    for (let intento = 0; intento < 3; intento++) {
      const token = generarToken();
      const r = await store.insertar({
        idTenant: params.idTenant,
        citaId: params.citaId,
        tokenHash: hashDeToken(token),
        tokenCifrado: cifrarSecreto(token),
        expiraAt: vencimientoDeEnlace(params.citaFinISO, ahora).toISOString(),
      });
      if (r.ok) return respuesta(token);
      if (r.motivo === "ya_existe_activo") {
        // Otro proceso lo creó en paralelo: se usa ese.
        const otro = await store.activoDeCita(params.idTenant, params.citaId);
        const t = otro ? tokenDeFila(otro) : null;
        if (t) return respuesta(t);
        continue;
      }
      log(r.motivo === "sin_tabla" ? "no existe dulabs_cita_enlaces (¿migración 20261209 sin aplicar?): la cita queda sin enlace de gestión" : "no se pudo guardar el enlace", { motivo: r.motivo, detalle: r.detalle });
      return null;
    }
    log("no se pudo emitir un enlace tras varios intentos", { citaId: params.citaId });
    return null;
  } catch (err) {
    log("error obteniendo o creando el enlace de la cita", err instanceof Error ? err.message : "error desconocido");
    return null;
  }
}

/** El token en claro de una fila guardada (descifrado y verificado contra su hash), o null si no se puede. */
function tokenDeFila(fila: FilaEnlace): string | null {
  try {
    const token = descifrarSecreto(fila.tokenCifrado);
    return esTokenBienFormado(token) && hashDeToken(token) === fila.tokenHash ? token : null;
  } catch {
    return null;
  }
}

export type ResultadoResolverEnlace = { ok: true; enlace: FilaEnlace } | { ok: false; motivo: "formato" | "no_existe" | "revocado" | "vencido" | "error" };

/**
 * Valida un token que llegó por la URL y devuelve su fila. El motivo del rechazo es solo para registro: la API responde IGUAL a todos (sin pistas).
 * Nunca lanza.
 */
export async function resolverEnlace(store: EnlacesStore, tokenCrudo: unknown, ahora: Date, opts: Pick<OpcionesEnlace, "log"> = {}): Promise<ResultadoResolverEnlace> {
  if (!esTokenBienFormado(tokenCrudo)) return { ok: false, motivo: "formato" };
  try {
    const fila = await store.porHash(hashDeToken(tokenCrudo));
    if (!fila) return { ok: false, motivo: "no_existe" };
    if (fila.revocadoAt !== null) return { ok: false, motivo: "revocado" };
    if (!(Date.parse(fila.expiraAt) > ahora.getTime())) return { ok: false, motivo: "vencido" };
    return { ok: true, enlace: fila };
  } catch (err) {
    (opts.log ?? logPorDefecto)("error validando el enlace", err instanceof Error ? err.message : "error desconocido");
    return { ok: false, motivo: "error" };
  }
}
