import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { obtenerGithubConfig } from "@/lib/developer/github/github-config";
import { verificarFirmaGithub } from "@/lib/developer/github/github-webhook-signature";
import { registrarDeliveryGithub } from "@/lib/developer/github/github-webhook-idempotency";
import { desconectarPorInstallationId, marcarInstalacionesPorInstallationId, marcarReposRemovidos } from "@/lib/developer/github/github-installations-store";

// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// Webhook de la GitHub App (superficie pública, sin sesión). Verifica la firma
// HMAC (X-Hub-Signature-256) sobre el cuerpo CRUDO, deduplica por
// X-GitHub-Delivery (idempotente), y sincroniza el estado local cuando GitHub
// avisa de cambios de acceso: instalación eliminada/suspendida, repos removidos.
// Nunca procesa nada antes de validar la firma. Nunca loguea el secreto.

export const runtime = "nodejs";

function ack(requestId: string, body: Record<string, unknown> = {}): Response {
  return Response.json({ ok: true, ...body }, { status: 200, headers: { "X-Request-Id": requestId } });
}

export async function POST(request: NextRequest) {
  const requestId = `ghwh_${randomUUID()}`;
  const config = obtenerGithubConfig();
  // Sin config no podemos verificar la firma: rechazamos (GitHub reintentará;
  // una vez configurado el secreto, la entrega se procesará).
  if (!config) return Response.json({ error: "github_not_configured" }, { status: 503 });

  const rawBody = await request.text();
  const firma = request.headers.get("x-hub-signature-256");
  if (!verificarFirmaGithub(rawBody, firma, config.webhookSecret)) {
    return Response.json({ error: "invalid_signature" }, { status: 401, headers: { "X-Request-Id": requestId } });
  }

  const evento = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery");

  const supabase = supabaseAdmin();

  // Idempotencia: una entrega ya vista se ACK-ea sin re-procesar.
  let esNuevo: boolean;
  try {
    esNuevo = await registrarDeliveryGithub(supabase, { deliveryId, evento });
  } catch (err) {
    console.error(`[github-webhook] error idempotencia (request_id=${requestId}):`, err instanceof Error ? err.message : String(err));
    return Response.json({ error: "internal_error" }, { status: 500, headers: { "X-Request-Id": requestId } });
  }
  if (!esNuevo) return ack(requestId, { duplicate: true });

  let payload: {
    action?: string;
    installation?: { id?: number };
    repositories_removed?: Array<{ id?: number }>;
  };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return ack(requestId, { ignored: "bad_json" });
  }

  const installationId = payload.installation?.id;
  if (!installationId || !Number.isInteger(installationId)) return ack(requestId, { ignored: "no_installation" });

  try {
    if (evento === "installation") {
      if (payload.action === "deleted") {
        const n = await desconectarPorInstallationId(supabase, installationId);
        return ack(requestId, { handled: "installation.deleted", filas: n });
      }
      if (payload.action === "suspend") {
        const n = await marcarInstalacionesPorInstallationId(supabase, { installationId, estado: "sin_acceso" });
        return ack(requestId, { handled: "installation.suspend", filas: n });
      }
      if (payload.action === "unsuspend") {
        const n = await marcarInstalacionesPorInstallationId(supabase, { installationId, estado: "activo" });
        return ack(requestId, { handled: "installation.unsuspend", filas: n });
      }
      return ack(requestId, { ignored: `installation.${payload.action ?? "?"}` });
    }

    if (evento === "installation_repositories" && payload.action === "removed") {
      const removidos = (payload.repositories_removed ?? []).map((r) => r.id).filter((id): id is number => Number.isInteger(id));
      const n = await marcarReposRemovidos(supabase, { installationId, repoIdsRemovidos: removidos });
      return ack(requestId, { handled: "installation_repositories.removed", filas: n });
    }

    return ack(requestId, { ignored: evento ?? "unknown" });
  } catch (err) {
    console.error(`[github-webhook] error procesando (request_id=${requestId}):`, err instanceof Error ? err.message : String(err));
    return Response.json({ error: "internal_error" }, { status: 500, headers: { "X-Request-Id": requestId } });
  }
}
