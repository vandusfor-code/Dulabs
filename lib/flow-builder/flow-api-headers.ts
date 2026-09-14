/**
 * F15.1 (Admin Flow Studio, autorizado) — construye los headers que ya usaba
 * cada wrapper de lib/flow-builder/*.ts (Authorization Bearer, +
 * Content-Type en POST/PATCH), agregando opcionalmente
 * `x-admin-tenant-id` -- el header que lib/flow/api-auth.ts (requireFlowAccess
 * con allowAdminOverride) exige para que un admin de DuLabs pueda operar
 * sobre el tenant de un cliente. Sin `adminTenantId`, el comportamiento es
 * IDÉNTICO al de antes (mismo header shape exacto) -- ningún llamador
 * existente que no pase este campo se ve afectado.
 */
export function flowApiHeaders(accessToken: string, opts?: { adminTenantId?: string; json?: boolean }): HeadersInit {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (opts?.json) headers["Content-Type"] = "application/json";
  if (opts?.adminTenantId) headers["x-admin-tenant-id"] = opts.adminTenantId;
  return headers;
}
