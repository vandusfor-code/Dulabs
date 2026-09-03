import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { createFlow, ensureInitialFlowVersion, listFlows } from "@/lib/flow/flow-store";
import type { FlowRow } from "@/lib/flow/flow-store-types";

export const runtime = "nodejs";

const ESTADOS_VALIDOS: FlowRow["status"][] = ["draft", "published", "archived"];

// El único constraint único que puede violar este INSERT es (tenant_id,slug)
// -- el PK (tenant_id,id) usa gen_random_uuid(), no colisiona en la práctica.
function esConflictoDeSlug(error: unknown): boolean {
  return (error as { code?: string })?.code === "23505";
}

// Lista los Flows del tenant autenticado. Filtro opcional ?status=draft|published|archived.
export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  const statusParam = request.nextUrl.searchParams.get("status");
  if (statusParam && !ESTADOS_VALIDOS.includes(statusParam as FlowRow["status"])) {
    return Response.json(
      { error: `status inválido -- valores permitidos: ${ESTADOS_VALIDOS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const flows = await listFlows(supabase, {
      tenantId: miembro.tenantId,
      status: (statusParam as FlowRow["status"]) || undefined,
    });
    return Response.json({ flows });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}

// Crea un Flow nuevo Y su primera versión Draft (v1, un nodo Start) en el
// mismo request -- ensureInitialFlowVersion() es la misma función idempotente
// que usa POST /api/flows/[id]/initial-version para recuperar Flows viejos
// sin versión, así que nunca hay una segunda lógica de "primera versión" en
// paralelo. El frontend nunca necesita encadenar un segundo POST a
// /versions para poder abrir el editor.
export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  let body: { slug?: string; name?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const slug = body.slug?.trim();
  const name = body.name?.trim();
  if (!slug) return Response.json({ error: "Falta 'slug'" }, { status: 400 });
  if (!name) return Response.json({ error: "Falta 'name'" }, { status: 400 });

  try {
    const flow = await createFlow(supabase, {
      tenantId: miembro.tenantId,
      slug,
      name,
      description: body.description,
      createdBy: miembro.userId,
    });
    const { version } = await ensureInitialFlowVersion(supabase, {
      tenantId: miembro.tenantId,
      flowId: flow.id,
      flowName: flow.name,
      createdBy: miembro.userId,
    });
    return Response.json({ flow, version }, { status: 201 });
  } catch (error) {
    if (esConflictoDeSlug(error)) {
      return Response.json({ error: `Ya existe un Flow con el slug "${slug}"` }, { status: 409 });
    }
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
