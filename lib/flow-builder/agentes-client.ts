/**
 * Fase 6 (IA configurable, autorizado) — wrapper delgado sobre
 * GET /api/dashboard/agentes, YA EXISTENTE (pantalla "Agentes de IA" del
 * bot legado). Reutilizado tal cual para el picker de agentId del nodo IA
 * del Flow Builder -- NUNCA se crea una API paralela.
 */

export type FetchLike = typeof fetch;

export interface AgenteResumen {
  id: number;
  nombre: string;
  prompt_sistema: string | null;
  base_conocimiento_nombre_archivo: string | null;
  base_conocimiento_actualizado_at: string | null;
  created_at: string;
}

export type ListAgentesResult =
  | { ok: true; agentes: AgenteResumen[] }
  | { ok: false; error: string };

export async function listAgentesDelTenant(params: { accessToken: string; fetchImpl?: FetchLike }): Promise<ListAgentesResult> {
  const doFetch = params.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch("/api/dashboard/agentes", { headers: { Authorization: `Bearer ${params.accessToken}` } });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error de red" };
  }

  let json: { agentes?: AgenteResumen[]; error?: string } = {};
  try {
    json = await response.json();
  } catch {
    // sin cuerpo JSON válido -- se trata como error genérico abajo
  }

  if (response.ok && json.agentes) return { ok: true, agentes: json.agentes };
  return { ok: false, error: json.error ?? "Error cargando los agentes" };
}
