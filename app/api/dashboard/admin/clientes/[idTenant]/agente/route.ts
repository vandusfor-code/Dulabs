import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { obtenerNumerosAdmin } from "@/lib/admin-clientes";
import { planDelTenant, contarAgentesEnUso } from "@/lib/plan-limits";
import { esSinPlan, MENSAJE_SIN_PLAN } from "@/lib/planes";

export const runtime = "nodejs";

const MAX_NOMBRE_LENGTH = 60;
const MAX_PROMPT_LENGTH = 4000;

// Espejo cross-tenant de /api/dashboard/agentes (GET): mismos datos, misma
// tabla dulabs_agentes -- la única diferencia es la autorización
// (verificarAccesoAdminDulabs en vez de membresía del propio tenant) y que
// el idTenant viene de la URL, nunca del cuerpo/query del navegador.
// Incluye los números del tenant (obtenerNumerosAdmin) para poder mostrar
// "Números que atiende" y el selector de WhatsApp en la misma pantalla.
export async function GET(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const { supabase } = acceso;

  let numeros;
  try {
    numeros = await obtenerNumerosAdmin(supabase, idTenant);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Error cargando números" }, { status: 500 });
  }

  const [{ data: agentes, error }, plan, enUso] = await Promise.all([
    supabase
      .from("dulabs_agentes")
      .select("id, nombre, prompt_sistema, base_conocimiento_nombre_archivo, base_conocimiento_actualizado_at, created_at")
      .eq("id_tenant", idTenant)
      .order("created_at", { ascending: true }),
    planDelTenant(supabase, idTenant),
    contarAgentesEnUso(supabase, idTenant),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ agentes: agentes ?? [], numeros, limite: plan.limites.agentesIA, enUso, plan: plan.nombre });
}

// Crea un agente nuevo directamente en el tenant objetivo. Mismo respeto del
// cupo del plan que la ruta del propio cliente -- una activación desde Admin
// no debe dejar al tenant silenciosamente por encima de lo que su plan paga.
export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const { supabase } = acceso;

  let body: { nombre?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const plan = await planDelTenant(supabase, idTenant);
  const enUso = await contarAgentesEnUso(supabase, idTenant);
  if (plan.limites.agentesIA !== null && enUso >= plan.limites.agentesIA) {
    return Response.json(
      {
        error: esSinPlan(plan)
          ? MENSAJE_SIN_PLAN
          : `El plan ${plan.nombre} de este cliente permite máximo ${plan.limites.agentesIA} agente${plan.limites.agentesIA === 1 ? "" : "s"} de IA.`,
      },
      { status: 400 }
    );
  }

  const nombre = body.nombre?.trim() || "Nuevo agente";
  if (nombre.length > MAX_NOMBRE_LENGTH) {
    return Response.json({ error: `El nombre no puede superar ${MAX_NOMBRE_LENGTH} caracteres` }, { status: 400 });
  }

  const { data: agente, error: insertError } = await supabase
    .from("dulabs_agentes")
    .insert({ id_tenant: idTenant, nombre })
    .select("id, nombre, prompt_sistema, base_conocimiento_nombre_archivo, base_conocimiento_actualizado_at, created_at")
    .single();
  if (insertError) return Response.json({ error: insertError.message }, { status: 500 });

  return Response.json({ agente });
}

// Edita nombre y/o prompt de un agente del tenant objetivo. El `id` del
// agente se valida SIEMPRE contra `id_tenant = idTenant` (de la URL, ya
// autorizado arriba) -- nunca contra un tenant que el navegador diga.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const { supabase } = acceso;

  let body: { id?: number; nombre?: string; prompt_sistema?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const { id } = body;
  if (!id) return Response.json({ error: "Falta 'id'" }, { status: 400 });

  const nombre = body.nombre?.trim();
  if (nombre !== undefined && nombre.length > MAX_NOMBRE_LENGTH) {
    return Response.json({ error: `El nombre no puede superar ${MAX_NOMBRE_LENGTH} caracteres` }, { status: 400 });
  }
  if (body.prompt_sistema !== undefined && body.prompt_sistema.length > MAX_PROMPT_LENGTH) {
    return Response.json({ error: `El prompt no puede superar ${MAX_PROMPT_LENGTH} caracteres` }, { status: 400 });
  }

  const cambios: Record<string, string> = { updated_at: new Date().toISOString() };
  if (nombre) cambios.nombre = nombre;
  if (body.prompt_sistema !== undefined) cambios.prompt_sistema = body.prompt_sistema;

  const { data, error } = await supabase
    .from("dulabs_agentes")
    .update(cambios)
    .eq("id", id)
    .eq("id_tenant", idTenant)
    .select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return Response.json({ error: "Agente no encontrado" }, { status: 404 });

  return Response.json({ success: true });
}
