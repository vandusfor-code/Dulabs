import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { extraerTexto, TAMANO_MAXIMO_BYTES } from "@/lib/archivo-texto";

export const runtime = "nodejs";
export const maxDuration = 60;

const LIMITE_CARACTERES = 100_000; // mismo límite que /api/dashboard/base-conocimiento

// Espejo cross-tenant de /api/dashboard/base-conocimiento -- misma
// extracción de texto (lib/archivo-texto.ts), mismo límite, misma columna
// (dulabs_agentes.base_conocimiento). El agente SIEMPRE se valida contra
// idTenant antes de escribir, nunca se confía en que el id venga "limpio".
export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const { supabase } = acceso;

  const form = await request.formData();
  const agenteId = form.get("agente_id");
  const archivo = form.get("archivo");
  if (typeof agenteId !== "string" || !agenteId) {
    return Response.json({ error: "Falta 'agente_id'" }, { status: 400 });
  }
  if (!(archivo instanceof File) || archivo.size === 0) {
    return Response.json({ error: "Falta el archivo" }, { status: 400 });
  }
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    return Response.json({ error: "El archivo supera el límite de 4 MB" }, { status: 400 });
  }

  const { data: agente, error: agenteError } = await supabase
    .from("dulabs_agentes")
    .select("id")
    .eq("id", agenteId)
    .eq("id_tenant", idTenant)
    .maybeSingle();
  if (agenteError) return Response.json({ error: agenteError.message }, { status: 500 });
  if (!agente) return Response.json({ error: "Agente no encontrado" }, { status: 404 });

  let texto: string;
  try {
    const buffer = Buffer.from(await archivo.arrayBuffer());
    texto = await extraerTexto(archivo, buffer);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "No se pudo leer el archivo" }, { status: 400 });
  }

  const truncado = texto.length > LIMITE_CARACTERES;
  if (truncado) texto = texto.slice(0, LIMITE_CARACTERES);

  const { error } = await supabase
    .from("dulabs_agentes")
    .update({
      base_conocimiento: texto,
      base_conocimiento_nombre_archivo: archivo.name,
      base_conocimiento_actualizado_at: new Date().toISOString(),
    })
    .eq("id", agenteId)
    .eq("id_tenant", idTenant);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true, nombre_archivo: archivo.name, caracteres: texto.length, truncado });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const { supabase } = acceso;

  let body: { agente_id?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.agente_id) return Response.json({ error: "Falta 'agente_id'" }, { status: 400 });

  const { data, error } = await supabase
    .from("dulabs_agentes")
    .update({ base_conocimiento: null, base_conocimiento_nombre_archivo: null, base_conocimiento_actualizado_at: null })
    .eq("id", body.agente_id)
    .eq("id_tenant", idTenant)
    .select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return Response.json({ error: "Agente no encontrado" }, { status: 404 });

  return Response.json({ success: true });
}
