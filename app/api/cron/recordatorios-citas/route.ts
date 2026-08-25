import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { solicitudAutorizadaCron } from "@/lib/cron-auth";
import { clienteDeEspecialista, notificarRecordatorioCita } from "@/lib/especialistas-notificar";
import type { ClienteConfig } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

type CitaPendienteRecordatorio = {
  id: number;
  phone_number_id: string;
  telefono_cliente: string | null;
  nombre_cliente: string;
  servicio: string;
  inicio: string;
};

// Disparado periódicamente por QStash (mismo mecanismo que
// /api/cron/encuestas-seguimiento -- ver lib/cron-auth.ts: los crons
// nativos de Vercel en plan Hobby solo corren 1 vez al día, insuficiente
// para avisar "1 hora antes"). Pensado para correr cada ~10 minutos.
//
// Busca citas confirmadas cuyo inicio cae en la ventana de 55 a 65 minutos
// desde ahora y les manda el recordatorio por WhatsApp una sola vez
// (columna recordatorio_enviado evita reenviarlo en la siguiente pasada).
//
// Acepta GET y POST -- QStash crea sus Schedules en POST por defecto, y no
// vale la pena obligar a cambiarlo a mano en su panel cuando aceptar ambos
// es gratis.
async function manejar(request: NextRequest) {
  const cuerpo = await request.text();
  if (!(await solicitudAutorizadaCron(request, cuerpo))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = supabaseAdmin();
  const ahora = new Date();
  const desde = new Date(ahora.getTime() + 55 * 60_000);
  const hasta = new Date(ahora.getTime() + 65 * 60_000);

  const { data: citas, error } = await supabase
    .from("dulabs_citas_especialista")
    .select("id, phone_number_id, telefono_cliente, nombre_cliente, servicio, inicio")
    .eq("estado", "confirmada")
    .eq("recordatorio_enviado", false)
    .not("telefono_cliente", "is", null)
    .gte("inicio", desde.toISOString())
    .lt("inicio", hasta.toISOString());

  if (error) {
    // Migración de recordatorio_enviado todavía no aplicada: no-op
    // seguro, igual que hace encuestas-seguimiento con sus propias tablas.
    return Response.json({ enviados: 0, nota: "no se pudo consultar dulabs_citas_especialista (¿falta correr la migración de recordatorio_enviado?)" });
  }

  let enviados = 0;
  const errores: string[] = [];
  const clientesCache = new Map<string, ClienteConfig | null>();

  for (const cita of (citas ?? []) as CitaPendienteRecordatorio[]) {
    try {
      if (!clientesCache.has(cita.phone_number_id)) {
        clientesCache.set(cita.phone_number_id, await clienteDeEspecialista(supabase, cita.phone_number_id));
      }
      const cliente = clientesCache.get(cita.phone_number_id) ?? null;
      if (!cliente) {
        errores.push(`${cita.id}: sin configuración de cliente para ${cita.phone_number_id}`);
        continue;
      }

      const ok = await notificarRecordatorioCita(cliente, cita);
      if (!ok) {
        errores.push(`${cita.id}: no se pudo enviar el recordatorio`);
        continue;
      }
      await supabase.from("dulabs_citas_especialista").update({ recordatorio_enviado: true }).eq("id", cita.id);
      enviados++;
    } catch (err) {
      errores.push(`${cita.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return Response.json({ enviados, errores });
}

export async function GET(request: NextRequest) {
  return manejar(request);
}

export async function POST(request: NextRequest) {
  return manejar(request);
}
