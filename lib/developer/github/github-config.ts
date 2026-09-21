// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// Configuración de la GitHub App leída SOLO de variables de entorno del
// servidor. La private key y el webhook secret son secretos: NUNCA se exponen
// al frontend, ni se loguean, ni viajan en respuestas de API.
//
// Variables (ver docs/GITHUB_INTEGRATION_SETUP.md y .env.example):
//   GITHUB_APP_ID          -- App ID numérico (público, pero se agrupa acá).
//   GITHUB_APP_SLUG        -- slug de la App, para armar la URL de instalación
//                             https://github.com/apps/<slug>/installations/new
//   GITHUB_PRIVATE_KEY     -- private key PEM de la App (RS256). Puede venir con
//                             saltos de línea reales o escapados como "\n".
//   GITHUB_WEBHOOK_SECRET  -- secreto HMAC del webhook de la App.
//
// NO se usan GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET: el flujo de Fase 1 es
// instalación de App + estado single-use propio (ver github-connect-state-store),
// no un OAuth de identidad de usuario. Se documentan como opcionales/futuros.

export type GithubAppConfig = {
  appId: string;
  appSlug: string;
  privateKey: string;
  webhookSecret: string;
};

/** Normaliza una private key PEM que en el entorno puede traer "\n" escapados. */
export function normalizarPrivateKey(valor: string): string {
  const v = valor.trim();
  // Si vino con secuencias "\n" literales (típico en Vercel/CI de una sola línea).
  return v.includes("\\n") && !v.includes("\n") ? v.replace(/\\n/g, "\n") : v;
}

/**
 * Devuelve la config si TODAS las variables necesarias están presentes; null si
 * falta alguna. null = "GitHub aún no configurado en este entorno": las rutas
 * responden un error claro y la UI muestra el estado apropiado, en vez de
 * reventar. Nunca incluye el secreto en ningún mensaje.
 */
export function obtenerGithubConfig(): GithubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const appSlug = process.env.GITHUB_APP_SLUG?.trim();
  const privateKeyRaw = process.env.GITHUB_PRIVATE_KEY;
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!appId || !appSlug || !privateKeyRaw || !webhookSecret) return null;
  const privateKey = normalizarPrivateKey(privateKeyRaw);
  if (!privateKey.includes("BEGIN") || !privateKey.includes("PRIVATE KEY")) return null;
  return { appId, appSlug, privateKey, webhookSecret };
}

/** true si la GitHub App está configurada en este entorno. */
export function githubConfigurado(): boolean {
  return obtenerGithubConfig() !== null;
}

/** URL de instalación de la App para un `state` dado (nonce single-use). */
export function urlInstalacionGithub(appSlug: string, state: string): string {
  const s = encodeURIComponent(state);
  return `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new?state=${s}`;
}
