import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";

export const runtime = "nodejs";

// Espejo cross-tenant de la asignación agente_id que ya existe en
// PATCH /api/dashboard/negocio -- misma columna, misma tabla, sin lógica
// nueva. `agente_id: null` desasigna. Tanto el agente como el número se
// validan SIEMPRE contra idTenant (de la URL, ya autorizado), nunca contra
// lo que mande el navegador.
export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const { supabase } = acceso;

  let body: { phone_number_id?: string; agente_id?: number | null };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { phone_number_id: phoneNumberId } = body;
  if (!phoneNumberId) return Response.json({ error: "Falta 'phone_number_id'" }, { status: 400 });

  if (body.agente_id !== null && body.agente_id !== undefined) {
    const { data: agente, error: agenteError } = await supabase
      .from("dulabs_agentes")
      .select("id")
      .eq("id", body.agente_id)
      .eq("id_tenant", idTenant)
      .maybeSingle();
    if (agenteError) return Response.json({ error: agenteError.message }, { status: 500 });
    if (!agente) return Response.json({ error: "Agente no encontrado" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .update({ agente_id: body.agente_id ?? null, updated_at: new Date().toISOString() })
    .eq("phone_number_id", phoneNumberId)
    .eq("id_tenant", idTenant)
    .select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  return Response.json({ success: true });
}
