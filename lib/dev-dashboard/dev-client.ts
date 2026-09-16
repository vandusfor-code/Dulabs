// DuLabs Developer V1 -- Fase 9 (Developer Dashboard, autorizado). Cliente
// API centralizado del Dashboard. Framework-agnóstico y testeable con un
// `fetchImpl` inyectado. Inyecta SIEMPRE: Authorization Bearer (sesión) y
// X-Dulabs-Workspace (workspace seleccionado, validado por el backend, nunca
// confiado a ciegas). Uniforma errores (401/403/404/429/red/servidor) con
// request_id. NUNCA persiste secretos.

export type DevErrorKind =
  | "unauthorized" // 401 -- sesión expirada/ausente
  | "forbidden" // 403 -- rol o workspace no autorizado
  | "not_found" // 404
  | "validation" // 400
  | "rate_limit" // 429 -- límite de tasa
  | "quota" // 429 -- cuota mensual agotada
  | "network" // fallo de red
  | "server" // 5xx
  | "unknown";

/** Clasificación PURA de un error de la Developer API (testeable sin red). Distingue rate limit de cuota mensual por el código estable del backend. */
export function clasificarError(status: number, code: string | null): DevErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400) return "validation";
  if (status === 429) return code === "monthly_message_limit_exceeded" ? "quota" : "rate_limit";
  if (status >= 500) return "server";
  return "unknown";
}

export class DevApiError extends Error {
  readonly kind: DevErrorKind;
  readonly status: number;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly detalle: string | null;
  constructor(params: { kind: DevErrorKind; status: number; code: string | null; requestId: string | null; detalle?: string | null }) {
    super(params.code ?? params.kind);
    this.name = "DevApiError";
    this.kind = params.kind;
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.detalle = params.detalle ?? null;
  }
}

export type FetchImpl = typeof fetch;

export type DevClientDeps = {
  getToken: () => string | null;
  getWorkspaceId: () => string | null;
  fetchImpl?: FetchImpl;
  basePath?: string;
};

type Opciones = { method?: string; body?: unknown; workspace?: boolean; query?: Record<string, string | number | undefined> };

async function solicitar<T>(deps: DevClientDeps, path: string, opciones: Opciones = {}): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.basePath ?? "/api/developer";
  const token = deps.getToken();
  if (!token) throw new DevApiError({ kind: "unauthorized", status: 401, code: "missing_session", requestId: null });

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  // X-Dulabs-Workspace: por defecto se envía en todas las rutas salvo que se
  // pida explícitamente omitirlo (el endpoint de lista de workspaces no lo
  // necesita para poder poblar el selector).
  if (opciones.workspace !== false) {
    const ws = deps.getWorkspaceId();
    if (ws) headers["X-Dulabs-Workspace"] = ws;
  }
  if (opciones.body !== undefined) headers["Content-Type"] = "application/json";

  let query = "";
  if (opciones.query) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(opciones.query)) if (v !== undefined) usp.set(k, String(v));
    const s = usp.toString();
    if (s) query = `?${s}`;
  }

  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}${query}`, {
      method: opciones.method ?? "GET",
      headers,
      body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
    });
  } catch {
    throw new DevApiError({ kind: "network", status: 0, code: null, requestId: null });
  }

  const requestId = res.headers.get("X-Request-Id");
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  let code: string | null = null;
  let detalle: string | null = null;
  let bodyRequestId: string | null = null;
  try {
    const data = (await res.json()) as { error?: { code?: string; request_id?: string; detalle?: string } };
    code = data.error?.code ?? null;
    detalle = data.error?.detalle ?? null;
    bodyRequestId = data.error?.request_id ?? null;
  } catch {
    // respuesta de error sin JSON -- se mantiene code null
  }
  throw new DevApiError({ kind: clasificarError(res.status, code), status: res.status, code, requestId: requestId ?? bodyRequestId, detalle });
}

// ---- Tipos de respuesta (proyecciones seguras del backend) ----
export type WorkspaceInfo = { workspaceId: string; rol: "OWNER" | "ADMIN" | "MEMBER" };
export type WorkspaceResp = { workspaces: WorkspaceInfo[]; selected: WorkspaceInfo | null };
export type UsageResp = {
  plan: string;
  period: string;
  messages: { included: number | null; reserved: number; confirmed: number; available: number | null };
  numbers: { included: number | null; used: number; available: number | null };
  limits: { messagesPerSecondPerNumber: number | null };
};
export type ApiKeyMeta = { id: string; workspace_id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
export type ApiKeySecret = { id: string; name: string; prefix: string; createdAt: string; apiKey: string };
export type NumberMeta = { id: string; phoneNumberId: string; displayName: string | null; status: string; wabaId?: string | null; createdAt: string };
export type WebhookMeta = { id: string; whatsappNumberId: string; url: string; status: string; createdAt: string; rotatedAt: string | null };
export type WebhookSecret = { id: string; whatsappNumberId: string; url: string; status: string; createdAt: string; secret: string };
export type MemberMeta = { id: string; userId: string; rol: "OWNER" | "ADMIN" | "MEMBER"; estado: string; createdAt: string };
export type JobResumen = {
  id: string;
  status: string;
  physical_outcome: string;
  network_attempts: number;
  delivery_status: string | null;
  wamid: string | null;
  whatsapp_number_id: string;
  created_at: string;
  updated_at: string;
};
export type JobsResp = { jobs: JobResumen[]; nextCursor: string | null };

/** Cliente Developer con métodos por recurso. Un solo punto de fetch -- nunca fetch manual disperso en componentes. */
export function createDevClient(deps: DevClientDeps) {
  return {
    workspace: () => solicitar<WorkspaceResp>(deps, "/workspace", { workspace: false }),
    usage: () => solicitar<UsageResp>(deps, "/usage"),
    apiKeys: {
      list: () => solicitar<{ apiKeys: ApiKeyMeta[] }>(deps, "/api-keys"),
      create: (name: string) => solicitar<ApiKeySecret>(deps, "/api-keys", { method: "POST", body: { name } }),
      revoke: (id: string) => solicitar<{ revoked: boolean }>(deps, `/api-keys/${id}`, { method: "DELETE" }),
      rotate: (id: string) => solicitar<ApiKeySecret>(deps, `/api-keys/${id}/rotate`, { method: "POST" }),
    },
    numbers: {
      list: () => solicitar<{ numbers: NumberMeta[] }>(deps, "/numbers"),
      create: (body: { phoneNumberId: string; wabaId?: string; displayName?: string; metaToken?: string }) => solicitar<NumberMeta>(deps, "/numbers", { method: "POST", body }),
    },
    webhooks: {
      list: () => solicitar<{ webhooks: WebhookMeta[] }>(deps, "/webhooks"),
      create: (body: { whatsappNumberId: string; url: string }) => solicitar<WebhookSecret>(deps, "/webhooks", { method: "POST", body }),
    },
    members: {
      list: () => solicitar<{ members: MemberMeta[] }>(deps, "/members"),
      create: (body: { userId: string; rol: "OWNER" | "ADMIN" | "MEMBER" }) => solicitar<{ member: MemberMeta }>(deps, "/members", { method: "POST", body }),
      updateRole: (id: string, rol: "OWNER" | "ADMIN" | "MEMBER") => solicitar<{ member: { id: string; rol: string } }>(deps, `/members/${id}`, { method: "PATCH", body: { rol } }),
      remove: (id: string) => solicitar<{ eliminado: boolean }>(deps, `/members/${id}`, { method: "DELETE" }),
    },
    jobs: (opts?: { limit?: number; cursor?: string }) => solicitar<JobsResp>(deps, "/jobs", { query: { limit: opts?.limit, cursor: opts?.cursor } }),
  };
}

export type DevClient = ReturnType<typeof createDevClient>;
