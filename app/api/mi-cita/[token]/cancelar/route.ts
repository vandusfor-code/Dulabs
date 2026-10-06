import { supabaseAdmin } from "@/lib/supabase";
import { depsProduccionMiCita } from "@/lib/mi-cita/gestion";
import { atenderCancelarMiCita, entornoProduccionMiCita } from "@/lib/mi-cita/rutas";

export const runtime = "nodejs";

// AMORE «Mi cita»: cancela la cita del enlace personal (idempotente). El id de la cita sale del token.
const entorno = () => entornoProduccionMiCita(() => depsProduccionMiCita(supabaseAdmin()));

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return atenderCancelarMiCita(token, entorno());
}
