import { supabaseAdmin } from "@/lib/supabase";
import { depsProduccionMiCita } from "@/lib/mi-cita/gestion";
import { atenderReprogramarMiCita, entornoProduccionMiCita } from "@/lib/mi-cita/rutas";

export const runtime = "nodejs";

// AMORE «Mi cita»: mueve la cita del enlace a otra fecha/hora (revalidación real + UPDATE atómico). El id de la cita sale del token, nunca del cuerpo.
const entorno = () => entornoProduccionMiCita(() => depsProduccionMiCita(supabaseAdmin()));

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let cuerpo: unknown = null;
  try {
    cuerpo = await request.json();
  } catch {
    cuerpo = null;
  }
  return atenderReprogramarMiCita(token, cuerpo, entorno());
}
