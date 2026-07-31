import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { planDelTenant, contarAgentesEnUso } from "@/lib/plan-limits";

export const runtime = "nodejs";

const MAX_NOMBRE_LENGTH = 60;
const MAX_PROMPT_LENGTH = 4000;

async function autenticar(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return { error: Response.json({ error: "Falta el token de sesión" }, { status: 401 }) } as const;
  const supabase = supabaseAdmin();
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) return { error: Response.json({ error: "Sesión inválida" }, { status: 401 }) } as const;
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin"])) {
    return { error: Response.json({ error: "No tienes permiso para esta acción" }, { status: 403 }) } as const;
  }
  return { supabase, miembro } as const;
}

// Lista los agentes de IA del tenant (perfiles reutilizables, tabla
// dulabs_agentes) junto con el cupo de su plan.
export async function GET(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  const [{ data: agentes, error }, plan, enUso] = await Promise.all([
    supabase
      .from("dulabs_agentes")
      .select("id, nombre, prompt_sistema, base_conocimiento_nombre_archivo, base_conocimiento_actualizado_at, created_at")
      .eq("id_tenant", miembro.tenantId)
      .order("created_at", { ascending: true }),
    planDelTenant(supabase, miembro.tenantId),
    contarAgentesEnUso(supabase, miembro.tenantId),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ agentes: agentes ?? [], limite: plan.limites.agentesIA, enUso, plan: plan.nombre });
}

// Crea un agente nuevo, o (con migrar_desde_phone_number_id) convierte el
// prompt/base de conocimiento LEGADO de un número existente en un agente
// real y lo deja asignado a ese mismo número — migración manual, nunca
// automática, controlada por el usuario desde la pantalla de Agentes de IA.
export async function POST(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  let body: { nombre?: string; migrar_desde_phone_number_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const plan = await planDelTenant(supabase, miembro.tenantId);
  const enUso = await contarAgentesEnUso(supabase, miembro.tenantId);
  if (plan.limites.agentesIA !== null && enUso >= plan.limites.agentesIA) {
    return Response.json(
      {
        error: `Tu plan ${plan.nombre} permite máximo ${plan.limites.agentesIA} agente${plan.limites.agentesIA === 1 ? "" : "s"} de IA. Mejora tu plan para crear otro.`,
      },
      { status: 400 }
    );
  }

  if (body.migrar_desde_phone_number_id) {
    const { data: cliente, error: clienteError } = await supabase
      .from("dulabs_clientes_config")
      .select("id, phone_number_id, agente_id, nombre_agente, nombre_negocio, prompt_sistema, base_conocimiento, base_conocimiento_nombre_archivo, base_conocimiento_actualizado_at, api_key_ia")
      .eq("phone_number_id", body.migrar_desde_phone_number_id)
      .eq("id_tenant", miembro.tenantId)
      .maybeSingle();
    if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
    if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });
    if (cliente.agente_id) {
      return Response.json({ error: "Este número ya tiene un agente asignado" }, { status: 400 });
    }

    const { data: nuevoAgente, error: insertError } = await supabase
      .from("dulabs_agentes")
      .insert({
        id_tenant: miembro.tenantId,
        nombre: cliente.nombre_agente || `Asistente de ${cliente.nombre_negocio}`,
        prompt_sistema: cliente.prompt_sistema,
        base_conocimiento: cliente.base_conocimiento,
        base_conocimiento_nombre_archivo: cliente.base_conocimiento_nombre_archivo,
        base_conocimiento_actualizado_at: cliente.base_conocimiento_actualizado_at,
        api_key_ia: cliente.api_key_ia,
      })
      .select("id, nombre")
      .single();
    if (insertError) return Response.json({ error: insertError.message }, { status: 500 });

    const { error: updateError } = await supabase
      .from("dulabs_clientes_config")
      .update({
        agente_id: nuevoAgente.id,
        prompt_sistema: null,
        base_conocimiento: null,
        base_conocimiento_nombre_archivo: null,
        base_conocimiento_actualizado_at: null,
        api_key_ia: null,
      })
      .eq("id", cliente.id);
    if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

    return Response.json({ agente: nuevoAgente });
  }

  const nombre = body.nombre?.trim() || "Nuevo agente";
  if (nombre.length > MAX_NOMBRE_LENGTH) {
    return Response.json({ error: `El nombre no puede superar ${MAX_NOMBRE_LENGTH} caracteres` }, { status: 400 });
  }

  const { data: agente, error: insertError } = await supabase
    .from("dulabs_agentes")
    .insert({ id_tenant: miembro.tenantId, nombre })
    .select("id, nombre, prompt_sistema, base_conocimiento_nombre_archivo, base_conocimiento_actualizado_at, created_at")
    .single();
  if (insertError) return Response.json({ error: insertError.message }, { status: 500 });

  return Response.json({ agente });
}

// Edita nombre y/o prompt de un agente existente.
export async function PATCH(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

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

  const { error } = await supabase.from("dulabs_agentes").update(cambios).eq("id", id).eq("id_tenant", miembro.tenantId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}

// Elimina un agente. Los números que lo tenían asignado vuelven
// automáticamente a "sin agente" (agente_id -> null vía ON DELETE SET NULL,
// no requiere limpieza manual aquí) y siguen respondiendo con su prompt
// legado si todavía lo conservan, o sin instrucciones si no.
export async function DELETE(request: NextRequest) {
  const ctx = await autenticar(request);
  if ("error" in ctx) return ctx.error;
  const { supabase, miembro } = ctx;

  let body: { id?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.id) return Response.json({ error: "Falta 'id'" }, { status: 400 });

  const { error } = await supabase.from("dulabs_agentes").delete().eq("id", body.id).eq("id_tenant", miembro.tenantId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
