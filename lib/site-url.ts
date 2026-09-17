// URL base pública del sitio, para redirects de auth (confirmación de correo,
// recuperación de contraseña) y enlaces en correos. Prioridad:
//   1. NEXT_PUBLIC_SITE_URL -- dominio canónico de producción, fijado por entorno.
//   2. window.location.origin -- el origen real desde el que navega el usuario
//      (correcto tanto en producción como en desarrollo local: nunca fuerza
//      localhost en prod ni prod en local).
//   3. https://www.dulabs.co -- último recurso en SSR sin la env.
//
// El punto es que un `emailRedirectTo` NUNCA quede apuntando a localhost cuando
// el registro ocurre en producción (bug real de confirmación de correo).

const DEFECTO = "https://www.dulabs.co";

export function siteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return DEFECTO;
}

/** Une siteUrl() con un path (asegura exactamente una barra). */
export function siteUrlCon(path: string): string {
  const base = siteUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
