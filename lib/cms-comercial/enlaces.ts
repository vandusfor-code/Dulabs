/**
 * CMS comercial — ENLACES del pie de página (redes sociales y direcciones externas). PURO.
 *
 * Un botón de la portada solo puede llevar a destinos de la propia tienda (destinoSchema: lista cerrada). El pie sí necesita salir de la tienda (Instagram, TikTok, el sitio de la
 * marca…), así que aquí se pone el cinturón: solo `https`, sin usuario ni clave dentro de la dirección, sin puertos raros, sin direcciones numéricas ni nombres internos, sin dominios
 * con letras disfrazadas (punycode) y, para una red social, el dominio TIENE que ser el de esa red. Con esto, que alguien tome la cuenta de la administradora no le sirve para
 * mandar a los clientes a un sitio cualquiera desde un icono de Instagram. Todo se evalúa sobre el texto tal como se guarda.
 */
import { REDES_SOCIALES, type RedSocial } from "@/lib/cms-comercial/contrato";
import { tieneControlOInvisible } from "@/lib/cms-comercial/texto-seguro";

/** Tope de una dirección web guardada. */
export const MAX_LARGO_URL = 300;

/** Espacios, saltos de línea, controles y caracteres invisibles o de dirección de texto: ninguno cabe en una dirección ni en un correo. */
const tieneEspacioOControl = (valor: string): boolean => /\s/.test(valor) || tieneControlOInvisible(valor);
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** Sufijos que solo existen dentro de una red local o en pruebas: nunca son un sitio público. */
const SUFIJOS_INTERNOS = /\.(?:local|localhost|internal|intranet|lan|home|corp|test|invalid|example)$/;

/** Dominios de cada red (el de la red misma o cualquiera de sus subdominios: www., m., vm., chat., api.…). */
export const DOMINIOS_RED: Readonly<Record<RedSocial, readonly string[]>> = {
  instagram: ["instagram.com", "instagr.am"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.com", "fb.me"],
  youtube: ["youtube.com", "youtu.be"],
  x: ["x.com", "twitter.com"],
  pinterest: ["pinterest.com", "pin.it"],
  linkedin: ["linkedin.com"],
  telegram: ["t.me", "telegram.me"],
  whatsapp: ["wa.me", "whatsapp.com"],
};

/**
 * ¿Es una dirección web que se puede poner en la tienda? Exige `https://` escrito tal cual (sin barras invertidas ni mayúsculas raras que cada navegador entienda distinto),
 * un dominio público de verdad y nada de usuario, clave o puerto dentro de la dirección.
 */
export function esUrlHttpsSegura(valor: string): boolean {
  if (typeof valor !== "string" || valor.length === 0 || valor.length > MAX_LARGO_URL) return false;
  if (tieneEspacioOControl(valor) || valor.includes("\\")) return false;
  if (!/^https:\/\//i.test(valor)) return false;
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.port !== "") return false;
  const host = u.hostname.toLowerCase();
  if (host === "" || host.startsWith("[") || host.includes(":") || IPV4.test(host)) return false;
  if (!host.includes(".") || host.endsWith(".") || SUFIJOS_INTERNOS.test(host)) return false;
  // Un dominio con letras disfrazadas (punycode) puede imitar a otro: no se admite.
  if (host.split(".").some((parte) => parte === "" || parte.length > 63 || parte.startsWith("xn--"))) return false;
  return /^[a-z0-9.-]+$/.test(host);
}

const hostDe = (valor: string): string | null => {
  try {
    return new URL(valor).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** ¿La dirección es del dominio de esa red social? (la propia red o uno de sus subdominios) */
export function perteneceARed(red: RedSocial, valor: string): boolean {
  const host = hostDe(valor);
  if (host === null) return false;
  return DOMINIOS_RED[red].some((dominio) => host === dominio || host.endsWith(`.${dominio}`));
}

/** Rutas de cada red que NO son un perfil (publicaciones, búsquedas, compartir…). */
const NO_PERFIL = new Set(["p", "reel", "reels", "explore", "stories", "tv", "share", "intent", "i", "home", "search", "hashtag", "watch", "playlist", "results", "channel", "c", "user"]);

/** El usuario visible de un perfil («@delacour.joyeria») si la dirección es de un perfil de Instagram, TikTok, X o YouTube; null en cualquier otro caso. */
export function usuarioDeRed(red: RedSocial, valor: string): string | null {
  const host = hostDe(valor);
  if (host === null || !perteneceARed(red, valor)) return null;
  let segmentos: string[];
  try {
    segmentos = new URL(valor).pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  const primero = segmentos[0];
  if (!primero) return null;
  const limpio = primero.replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,40}$/.test(limpio)) return null;
  switch (red) {
    case "instagram":
    case "x":
      return NO_PERFIL.has(limpio.toLowerCase()) ? null : `@${limpio}`;
    case "tiktok":
    case "youtube":
      return primero.startsWith("@") ? `@${limpio}` : null;
    default:
      return null;
  }
}

/**
 * Lo que escribió la administradora → una dirección completa. Una dirección ya completa se deja tal cual (la revisa el esquema); un usuario («@delacour.joyeria» o
 * «delacour.joyeria») se convierte en la dirección del perfil de esa red. null = no se puede deducir (por ejemplo, un usuario con caracteres no permitidos o una red que
 * necesita la dirección completa).
 */
export function urlDesdeUsuario(red: RedSocial, escrito: string): string | null {
  const t = escrito.trim();
  if (t === "") return null;
  if (/^https?:\/\//i.test(t)) return t;
  const usuario = t.replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,40}$/.test(usuario)) return null;
  switch (red) {
    case "instagram":
      return `https://instagram.com/${usuario}`;
    case "tiktok":
      return `https://tiktok.com/@${usuario}`;
    case "x":
      return `https://x.com/${usuario}`;
    case "youtube":
      return `https://youtube.com/@${usuario}`;
    case "facebook":
      return `https://facebook.com/${usuario}`;
    case "pinterest":
      return `https://pinterest.com/${usuario}`;
    case "telegram":
      return `https://t.me/${usuario}`;
    default:
      return null;
  }
}

/** ¿Es un número de teléfono razonable para mostrar? (entre 7 y 15 dígitos; solo dígitos, espacios, +, guiones, puntos y paréntesis) */
export function esTelefonoValido(valor: string): boolean {
  if (!/^\+?[\d\s().-]{7,30}$/.test(valor)) return false;
  const digitos = valor.replace(/\D/g, "").length;
  return digitos >= 7 && digitos <= 15;
}

/** `tel:` de un teléfono ya validado: solo dígitos y un + inicial. */
export const hrefTelefono = (valor: string): string => `tel:${valor.trim().startsWith("+") ? "+" : ""}${valor.replace(/\D/g, "")}`;

/** ¿Es un correo con forma de correo? (una sola arroba, dominio con punto, sin espacios ni caracteres de control) */
export function esCorreoValido(valor: string): boolean {
  if (valor.length < 6 || valor.length > 120 || tieneEspacioOControl(valor)) return false;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(valor);
}

export const hrefCorreo = (valor: string): string => `mailto:${valor}`;

export const esRedSocial = (valor: unknown): valor is RedSocial => typeof valor === "string" && (REDES_SOCIALES as readonly string[]).includes(valor);

/** Cuántas líneas tiene un texto (una dirección puede ir en varias: «Centro Comercial Galerías» / «Carrera 26 # 18-71» / «Pasto, Nariño»). */
export const numeroDeLineas = (valor: string): number => valor.split("\n").length;
