import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { reencolarEntregaParaReplay } from "@/lib/developer/events-store";
import { obtenerAccountIdDeWorkspace } from "@/lib/developer/accounts-store";

// DuLabs Developer V1 -- Fase 13 (autorizado, 13.3). Re-entrega manual de una
// entrega en DLQ/fallido. OWNER/ADMIN. NO crea otra cola ni toca el worker:
// re-encola (estado -> pendiente) para que el loop de reintento EXISTENTE
// (services/reconciliation -> worker-inbound) la vuelva a entregar, reusando su
// lease/idempotencia/backoff. Tenant isolation: reencolarEntregaParaReplay
// filtra por workspace_id en el WHERE (además del gate de sesión). Anti-abuso:
// rate-limit + solo desde dlq/fallido (una vez pendiente, un 2º replay devuelve
// no_replayable). Auditado.

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const limite = await respuestaSiLimiteTasaExcedido(ctx.supabase, { recurso: "dev-event-replay", tenantId: ctx.workspaceId, categoria: "costosa" });
    if (limite) return limite;

    const { id } = await params;
    const eventoId = Number(id);
    if (!Number.isInteger(eventoId) || eventoId <= 0) return jsonError(400, "invalid_request", ctx.requestId, "id de evento inválido");

    const r = await reencolarEntregaParaReplay(ctx.supabase, { workspaceId: ctx.workspaceId, id: eventoId });
    if (!r.ok) {
      if (r.motivo === "no_encontrado") return jsonError(404, "event_not_found", ctx.requestId);
      return jsonError(409, "not_replayable", ctx.requestId, "Solo se pueden reintentar entregas en DLQ o fallidas.");
    }

    // Auditoría del replay (append-only). account_id puede ser null (workspace legacy sin cuenta).
    const accountId = await obtenerAccountIdDeWorkspace(ctx.supabase, ctx.workspaceId);
    await ctx.supabase
      .from("dulabs_dev_account_audit")
      .insert({ account_id: accountId, actor_user_id: ctx.userId, accion: "EVENT_REPLAY", despues: { event_id: eventoId, workspace_id: ctx.workspaceId, estado_previo: r.estadoPrevio } })
      .then(() => {}, (e: unknown) => console.error("[dev-events-replay] no se pudo auditar:", e instanceof Error ? e.message : String(e)));

    return jsonOk({ ok: true, reencolado: true, estadoPrevio: r.estadoPrevio }, ctx.requestId);
  });
}
