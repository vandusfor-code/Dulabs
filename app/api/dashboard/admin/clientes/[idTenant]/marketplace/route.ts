import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { obtenerNumerosAdmin } from "@/lib/admin-clientes";
import { AGENTES_MARKETPLACE } from "@/lib/marketplace";
import { activarMarketplaceCortesia } from "@/lib/marketplace-store";

export const runtime = "nodejs";

const MAX_MOTIVO_LENGTH = 200;

// Estado del Marketplace para UN cliente específico, visto desde el Panel de
// Operaciones (Fase 1). Mismo catálogo fijo (lib/marketplace.ts) que ve el
// propio cliente en /dashboard/marketplace, pero cross-tenant y con el
// estado de cortesía visible -- no duplica esa ruta porque esa lee el tenant
// del token de sesión (siempre "a sí mismo"); esta necesita leer el tenant
// objetivo autorizando por rol de plataforma, no por membresía.
export async function GET(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  let numeros;
  try {
    numeros = await obtenerNumerosAdmin(supabase, idTenant);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Error cargando números" }, { status: 500 });
  }

  const { data: activaciones, error } = await supabase
    .from("dulabs_marketplace_activaciones")
    .select("id, agente_slug, phone_number_id, tipo_plan, estado, es_cortesia, cortesia_activada_por, cortesia_motivo, created_at")
    .eq("id_tenant", idTenant)
    .eq("estado", "activa");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const activas = activaciones ?? [];
  const idsAdmins = [...new Set(activas.map((a) => a.cortesia_activada_por).filter((id): id is string => Boolean(id)))];
  const emailPorAdminId = new Map<string, string | null>();
  await Promise.all(
    idsAdmins.map(async (id) => {
      const { data } = await supabase.auth.admin.getUserById(id);
      emailPorAdminId.set(id, data?.user?.email ?? null);
    })
  );

  const nombrePorNumero = new Map(numeros.map((n) => [n.phoneNumberId, n.nombreNegocio]));

  const agentes = AGENTES_MARKETPLACE.map((a) => {
    const act = activas.find((x) => x.agente_slug === a.slug) ?? null;
    return {
      slug: a.slug,
      nombre: a.nombre,
      categoria: a.categoria,
      icono: a.icono,
      descripcion: a.descripcion,
      usaAgenda: a.usaAgenda,
      activacion: act
        ? {
            phoneNumberId: act.phone_number_id,
            nombreNegocio: nombrePorNumero.get(act.phone_number_id) ?? act.phone_number_id,
            tipoPlan: act.tipo_plan,
            esCortesia: act.es_cortesia,
            cortesiaActivadaPorEmail: act.cortesia_activada_por ? emailPorAdminId.get(act.cortesia_activada_por) ?? null : null,
            cortesiaMotivo: act.cortesia_motivo,
            createdAt: act.created_at,
          }
        : null,
    };
  });

  return Response.json({ numeros, agentes });
}

// Activa un agente del Marketplace SIN COBRAR (ver lib/marketplace-store.ts
// `activarMarketplaceCortesia`) -- la única acción nueva de esta fase. No
// toca el flujo de compra normal ni ninguna de sus rutas.
export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const { supabase, miembro } = acceso;

  let body: { slug?: string; phone_number_id?: string; motivo?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const slug = body.slug?.trim();
  const phoneNumberId = body.phone_number_id?.trim();
  const motivo = body.motivo?.trim();
  if (!slug || !phoneNumberId) {
    return Response.json({ error: "Faltan 'slug' o 'phone_number_id'" }, { status: 400 });
  }
  if (!motivo) {
    return Response.json({ error: "El motivo es obligatorio" }, { status: 400 });
  }
  if (motivo.length > MAX_MOTIVO_LENGTH) {
    return Response.json({ error: `El motivo no puede superar ${MAX_MOTIVO_LENGTH} caracteres` }, { status: 400 });
  }

  // La base de conocimiento del agente de cortesía se siembra con lo que el
  // cliente ya contó en el onboarding (si existe) -- así el agente no queda
  // en blanco de entrada. El especialista puede reemplazarla después desde
  // la propia pantalla de Administrar del cliente (fuera del alcance de
  // esta fase, que solo activa).
  const { data: sesion } = await supabase
    .from("dulabs_onboarding_sesiones")
    .select("business_description, implementation_idea, additional_information")
    .eq("id_tenant", idTenant)
    .maybeSingle();
  const configTexto = [sesion?.business_description, sesion?.implementation_idea, sesion?.additional_information]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join("\n\n");

  const resultado = await activarMarketplaceCortesia(supabase, {
    idTenant,
    phoneNumberId,
    slug,
    configTexto,
    activadaPorUserId: miembro.userId,
    motivo,
  });

  if (!resultado.ok) {
    if (resultado.motivo === "numero_no_encontrado") {
      return Response.json({ error: "Ese número no pertenece a este cliente" }, { status: 404 });
    }
    if (resultado.motivo === "agente_no_encontrado") {
      return Response.json({ error: "Producto de Marketplace no encontrado" }, { status: 404 });
    }
    if (resultado.motivo === "otro_producto_activo") {
      const agenteActivo = AGENTES_MARKETPLACE.find((a) => a.slug === resultado.activacionExistente.agente_slug);
      return Response.json(
        { error: `Este número ya tiene "${agenteActivo?.nombre ?? resultado.activacionExistente.agente_slug}" activo. Desactívalo antes de activar otro.` },
        { status: 409 }
      );
    }
    return Response.json({ error: resultado.detalle }, { status: 503 });
  }

  if (resultado.yaEstabaActivo) {
    return Response.json({ success: true, yaEstabaActivo: true, mensaje: "El producto ya está activo." });
  }
  return Response.json({ success: true, yaEstabaActivo: false, mensaje: "Solución activada correctamente." });
}
