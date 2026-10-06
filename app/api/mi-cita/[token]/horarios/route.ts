import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { depsProduccionMiCita } from "@/lib/mi-cita/gestion";
import { atenderHorariosMiCita, entornoProduccionMiCita } from "@/lib/mi-cita/rutas";

export const runtime = "nodejs";

// AMORE «Mi cita»: horarios REALES (con Google Calendar) para mover la cita del enlace, con la MISMA profesional y la duración de la cita.
const entorno = () => entornoProduccionMiCita(() => depsProduccionMiCita(supabaseAdmin()));

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return atenderHorariosMiCita(token, request.nextUrl.searchParams.get("fecha")?.trim(), entorno());
}
