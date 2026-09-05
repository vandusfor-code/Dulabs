import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "node:crypto";

export const COOKIE_SESION = "dulabs_sesion";
const DIAS_EXPIRACION = 30;

export type UsuarioSesion = {
  usuarioId: number;
  idTenant: string;
  especialistaId: number | null;
  rol: "administrador" | "colaboradora";
  nombre: string;
  username: string;
  activo: boolean;
};

// Login AMORE (autorizado) — sesiones OPACAS respaldadas por Supabase (no
// JWT): la cookie solo guarda un token aleatorio, la fila real
// (dulabs_usuarios_sesiones) es la única fuente de verdad de si sigue
// siendo válida -- así "cerrar sesión" y "revocar todo" son un DELETE/UPDATE
// real, no "esperar a que expire un JWT que ya se firmó". Nunca se guarda
// el token crudo en la base -- solo su hash (sha256): si alguien leyera la
// tabla no podría reconstruir cookies válidas.
function hashToken(tokenCrudo: string): string {
  return createHash("sha256").update(tokenCrudo).digest("hex");
}

export async function crearSesion(supabase: SupabaseClient, usuarioId: number): Promise<string> {
  const tokenCrudo = randomBytes(32).toString("hex");
  const expiraEn = new Date(Date.now() + DIAS_EXPIRACION * 24 * 60 * 60 * 1000);
  await supabase.from("dulabs_usuarios_sesiones").insert({
    usuario_id: usuarioId,
    token_hash: hashToken(tokenCrudo),
    expira_en: expiraEn.toISOString(),
  });
  return tokenCrudo;
}

export async function revocarSesion(supabase: SupabaseClient, tokenCrudo: string): Promise<void> {
  await supabase
    .from("dulabs_usuarios_sesiones")
    .update({ revocada_en: new Date().toISOString() })
    .eq("token_hash", hashToken(tokenCrudo))
    .is("revocada_en", null);
}

type FilaSesionUsuario = {
  usuario_id: number;
  expira_en: string;
  revocada_en: string | null;
  dulabs_usuarios: {
    id: number;
    id_tenant: string;
    especialista_id: number | null;
    rol: "administrador" | "colaboradora";
    nombre: string;
    username: string;
    activo: boolean;
  } | null;
};

// Resuelve la sesión completa (con el usuario ya unido) a partir del token
// crudo que llega en la cookie. null en CUALQUIER caso no válido (sesión
// inexistente, expirada, revocada, o usuario desactivado) -- el llamador
// nunca necesita distinguir el motivo, solo "sesión válida o no".
export async function resolverSesion(supabase: SupabaseClient, tokenCrudo: string): Promise<UsuarioSesion | null> {
  const { data } = await supabase
    .from("dulabs_usuarios_sesiones")
    .select("usuario_id, expira_en, revocada_en, dulabs_usuarios(id, id_tenant, especialista_id, rol, nombre, username, activo)")
    .eq("token_hash", hashToken(tokenCrudo))
    .maybeSingle<FilaSesionUsuario>();

  if (!data || data.revocada_en) return null;
  if (new Date(data.expira_en).getTime() <= Date.now()) return null;

  const usuario = data.dulabs_usuarios;
  if (!usuario || !usuario.activo) return null;

  return {
    usuarioId: usuario.id,
    idTenant: usuario.id_tenant,
    especialistaId: usuario.especialista_id,
    rol: usuario.rol,
    nombre: usuario.nombre,
    username: usuario.username,
    activo: usuario.activo,
  };
}

export function extraerTokenCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const parte of cookieHeader.split(";")) {
    const [nombre, ...resto] = parte.trim().split("=");
    if (nombre === COOKIE_SESION) return resto.join("=") || null;
  }
  return null;
}

// Set-Cookie: httpOnly (JS del navegador nunca la lee) + Secure (solo HTTPS,
// producción siempre lo es) + SameSite=Lax (basta para same-site, y permite
// llegar desde un link externo sin exponerla a CSRF cross-site real).
export function construirSetCookie(tokenCrudo: string): string {
  const maxAge = DIAS_EXPIRACION * 24 * 60 * 60;
  return `${COOKIE_SESION}=${tokenCrudo}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function construirClearCookie(): string {
  return `${COOKIE_SESION}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
