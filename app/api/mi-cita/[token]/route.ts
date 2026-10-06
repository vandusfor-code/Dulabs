import { supabaseAdmin } from "@/lib/supabase";
import { depsProduccionMiCita } from "@/lib/mi-cita/gestion";
import { atenderVerMiCita, entornoProduccionMiCita } from "@/lib/mi-cita/rutas";

export const runtime = "nodejs";

// AMORE «Mi cita»: los datos de la cita del enlace personal. El id de la cita sale del token (nunca del cliente); ver lib/mi-cita/.
const entorno = () => entornoProduccionMiCita(() => depsProduccionMiCita(supabaseAdmin()));

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return atenderVerMiCita(token, entorno());
}
