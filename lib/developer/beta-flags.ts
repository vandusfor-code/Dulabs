// DuLabs Developer V1 -- Fase 19 (Controlled Beta, 19.5). Kill switch operativo
// del API público. Permite deshabilitar TODA la superficie autenticada de
// /api/v1 en una emergencia (abuso, incidente, mantenimiento) cambiando una
// variable de entorno y reiniciando el gateway -- sin un deploy de código.
//
// Fail-SAFE hacia "habilitado": el API queda operativo salvo que se apague
// EXPLÍCITAMENTE. Así, una variable ausente o mal escrita nunca deja el API
// caído por accidente; apagarlo es siempre una acción deliberada.

/** true salvo que DEVELOPER_API_ENABLED sea explícitamente falsy ("false"/"0"/"off"/"no"). */
export function apiPublicaHabilitada(): boolean {
  const v = (process.env.DEVELOPER_API_ENABLED ?? "").toLowerCase().trim();
  return !(v === "false" || v === "0" || v === "off" || v === "no");
}
