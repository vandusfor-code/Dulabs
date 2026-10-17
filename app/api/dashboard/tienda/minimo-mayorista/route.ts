/**
 * /api/dashboard/tienda/minimo-mayorista — el mínimo de la compra inicial mayorista del negocio.
 *
 *   GET  cómo está hoy (el monto, si se puede cambiar y en qué textos del asistente está escrito a mano). Admin, agente y lectura.
 *   PUT  cambiarlo ({ minimo, esperado }). SOLO admin. Se aplica de inmediato: el asistente exige el monto nuevo en la primera compra mayorista y los textos que escriben {{minimo_mayorista}} lo
 *        muestran; el monto escrito a mano en los textos del asistente se actualiza en la misma transacción (ver la migración 20261214000000). Deja una fila de auditoría.
 *
 * El negocio y quién cambia salen de la sesión, jamás de la petición. Sin la migración, GET responde con el monto pero con `disponible: false` y PUT responde 503: nada más se afecta.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { isCmsError } from "@/lib/cms-comercial/errores";
import { leerCuerpo, withCms } from "@/lib/cms-comercial/http";
import { minimoMayoristaSchema } from "@/lib/cms-comercial/minimo-mayorista";
import { crearPuertoMinimoMayoristaSupabase } from "@/lib/cms-comercial/minimo-mayorista-supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCms(request, "read", async ({ supabase, variables, actor }) => {
    try {
      return apiOk({ ...(await crearPuertoMinimoMayoristaSupabase(supabase).ver(actor.tenantId)), disponible: true });
    } catch (err) {
      // Sin la migración se puede VER el monto (el que ya usan los textos) pero no cambiarlo. Cualquier otra falla se responde como siempre.
      if (!isCmsError(err) || err.code !== "FEATURE_UNAVAILABLE") throw err;
      const { minimoMayorista } = await variables.valores(actor.tenantId);
      return apiOk({ configurado: minimoMayorista !== null, minimo: minimoMayorista, uniforme: true, filas: 0, lugares: [], disponible: false });
    }
  });
}

export async function PUT(request: NextRequest) {
  return withCms(request, "write", async ({ supabase, actor }) => {
    const cuerpo = await leerCuerpo(request, minimoMayoristaSchema);
    if (!cuerpo.ok) return cuerpo.response;
    const resultado = await crearPuertoMinimoMayoristaSupabase(supabase).fijar(actor.tenantId, actor.userId, cuerpo.data.minimo, cuerpo.data.esperado);
    return apiOk(resultado);
  });
}
